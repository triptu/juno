import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { buildRequest, children, complete, compactionTask, context, deps, limits, mask, merge,
  nodeKey, partition, renderSource, renderView, requiredWindow, start, taintClosure, upper, utf8Bytes, withinCutoff } from '../src/index.ts';
import type { ActiveEntry, Completion, Key, Line, Node, Source } from '../src/index.ts';

const source = (id: number, text: string, removed = false): Source => ({ id, text, removed, version: 1, kind: 'user' });
function finish(work: Completion, answers: readonly string[]): Node {
  let next = work;
  for (const answer of answers) if (next.kind === 'retry') next = complete(next.state, answer);
  if (next.kind !== 'ready') throw new Error('Expected a completed node');
  return next.node;
}
function history(sizes: readonly number[], removed: ReadonlySet<number> = new Set()): { archive: Source[]; nodes: Node[]; leaves: Line[] } {
  const archive = sizes.map((n, id) => source(id, 'x'.repeat(n), removed.has(id)));
  const nodes: Node[] = [];
  const leaves: Line[] = [];
  for (const message of archive) {
    const key = nodeKey(message.id, 1);
    const node = finish(start({ ...key, v: 1 }, { kind: 'leaf', source: message }, context(key, archive)), ['summary']);
    nodes.push(node);
    leaves.push({ kind: 'node', node });
  }
  for (let w = 2; w <= sizes.length; w *= 2) for (let a = 0; a + w <= sizes.length; a += w) {
    const left = nodes.find(n => n.ref.a === a && n.ref.w === w / 2);
    const right = nodes.find(n => n.ref.a === a + w / 2 && n.ref.w === w / 2);
    if (!left || !right) throw new Error('Missing fixture child');
    const key = nodeKey(a, w);
    nodes.push(finish(start({ ...key, v: 1 }, { kind: 'parent', children: [left, right] }, context(key, archive)), ['summary']));
  }
  return { archive, nodes, leaves };
}
const reaches = (n: Node, id: number, nodes: readonly Node[]): boolean => n.sources.includes(id) || n.context.includes(id) || n.inputs.some(ref => {
  const child = nodes.find(c => c.ref.a === ref.a && c.ref.w === ref.w && c.ref.v === ref.v);
  if (!child) throw new Error('Missing recorded child');
  return reaches(child, id, nodes);
});
const keyId = (k: Key) => `${k.a}:${k.w}`;
const sizes = fc.array(fc.integer({ min: 0, max: 16_384 }), { minLength: 1, maxLength: 24 });
const unicode = fc.array(fc.constantFrom('a', 'é', '中', '😀', '\n'), { maxLength: 80 }).map(xs => xs.join(''));

describe('pure safety properties', () => {
  test('closure is exactly the recorded source reachability and masking is exact', () => {
    fc.assert(fc.property(sizes, fc.nat(), (lengths, seed) => {
      const { archive, nodes, leaves } = history(lengths);
      const removed = new Set([seed % lengths.length]);
      for (const n of nodes) {
        expect(n.sources).toEqual(n.ref.w === 1 ? [n.ref.a] : []);
        expect(n.context).toEqual(context(n.ref, archive).map(s => s.id));
        expect(n.inputs).toEqual((children(n.ref) ?? []).map(k => ({ ...k, v: 1 })));
        expect([...deps([n])].toSorted((a, b) => a - b)).toEqual(lengths.flatMap((_, id) => reaches(n, id, nodes) ? [id] : []));
      }
      const expected = nodes.filter(n => [...removed].some(id => reaches(n, id, nodes)));
      expect(taintClosure(nodes, removed)).toEqual(expected);
      expect(mask(leaves, removed).map(l => l.kind)).toEqual(leaves.map(l => l.kind === 'node' && expected.includes(l.node) ? 'masked' : 'node'));
    }));
  });
  test('raw context stops at the first non-fitting source and taint stays local, including ancestors', () => {
    fc.assert(fc.property(sizes, fc.array(fc.boolean(), { maxLength: 24 }), fc.nat(), (lengths, flags, seed) => {
      const removed = new Set(lengths.flatMap((_, i) => flags[i] ? [i] : []));
      const { archive, nodes } = history(lengths, removed);
      for (let a = 0; a <= lengths.length; a++) {
        const chosen = context(nodeKey(a, 1), archive);
        const prior = archive.slice(0, a).filter(s => !s.removed).toReversed();
        let sum = 0;
        let count = 0;
        for (const s of prior) { sum += utf8Bytes(renderSource(s)) + 64; if (sum > limits.context) break; count++; }
        expect(chosen).toEqual(prior.slice(0, count));
        expect(context(nodeKey(a, 1), prior.slice(0, 257).toReversed())).toEqual(chosen);
      }
      const m = seed % lengths.length;
      if (removed.has(m)) return;
      for (const n of taintClosure(nodes, new Set([m]))) {
        const contains = n.ref.a <= m && m < n.ref.a + n.ref.w;
        const distance = archive.slice(m, n.ref.a).filter(s => !s.removed).reduce((sum, s) => sum + utf8Bytes(s.text), 0);
        expect(contains || (n.ref.a > m && distance <= limits.context)).toBe(true);
      }
    }));
  });
  test('view publication and rendering remain within the cutoff, without an empty fallback', () => {
    fc.assert(fc.property(sizes, fc.nat(), (lengths, seed) => {
      const { leaves } = history(lengths);
      const h = seed % (lengths.length + 1);
      expect(renderView(leaves.slice(0, h), h, h)).toContain(h ? '0+1|' : '');
      if (h < lengths.length) {
        expect(() => renderView(leaves, lengths.length, h)).toThrow();
        const key = nodeKey(h, 1);
        expect(withinCutoff(key, h)).toBe(false);
        expect(() => start({ ...key, v: 1 }, { kind: 'leaf', source: source(h, 'x') }, [], h)).toThrow();
      }
    }));
  });
  test('five attempts always yield a bounded node, copying leaves and cutting parents at Unicode boundaries', () => {
    fc.assert(fc.property(fc.constantFrom('x', 'é', '中', '😀'), fc.integer({ min: 513, max: 5000 }), fc.array(fc.integer({ min: 513, max: 21000 }), { minLength: 5, maxLength: 5 }), (char, size, outputs) => {
      const original = char.repeat(Math.min(size, Math.floor(limits.node / utf8Bytes(char))));
      const answers = outputs.map(n => char.repeat(n));
      const left = finish(start({ a: 0, w: 1, v: 1 }, { kind: 'leaf', source: source(0, original) }, []), answers);
      const right = finish(start({ a: 1, w: 1, v: 1 }, { kind: 'leaf', source: source(1, original) }, []), answers);
      const parent = finish(start({ a: 0, w: 2, v: 1 }, { kind: 'parent', children: [left, right] }, []), answers);
      for (const n of [left, right, parent]) {
        expect(utf8Bytes(n.text)).toBeLessThanOrEqual(limits.node);
        expect(new TextDecoder().decode(new TextEncoder().encode(n.text))).toBe(n.text);
      }
      if (answers.every(s => utf8Bytes(s) > limits.node)) {
        expect(left.text).toBe(original);
        expect(left.cut).toBe(false);
        expect(parent.cut).toBe(true);
        expect(parent.text.endsWith('(cut)')).toBe(true);
      } else {
        const shortest = answers.reduce((best, answer) => utf8Bytes(answer) < utf8Bytes(best) ? answer : best, answers[0] ?? '');
        expect(left.text).toBe(shortest);
        expect(parent.text).toBe(shortest);
        expect(parent.cut).toBe(false);
      }
    }));
  });
  test('every bounded pair fits a parent input and the compatible compaction window', () => {
    fc.assert(fc.property(fc.integer({ min: 513, max: 16384 }), fc.integer({ min: 513, max: 16384 }), (a, b) => {
      const make = (id: number, bytes: number) => finish(start({ a: id, w: 1, v: 1 }, { kind: 'leaf', source: source(id, 's'.repeat(bytes)) }, []), Array<string>(5).fill('x'.repeat(20000)));
      const l = make(2, a); const r = make(3, b);
      // Aligned siblings 2 and 3, preceded by a full raw source.
      const ctx = context(nodeKey(2, 2), [source(0, ''), source(1, 'z'.repeat(16000))]);
      const work = start({ a: 2, w: 2, v: 1 }, { kind: 'parent', children: [l, r] }, ctx);
      expect(utf8Bytes(l.text) + utf8Bytes(r.text)).toBeLessThanOrEqual(limits.input);
      if (work.kind !== 'retry') throw new Error('Parent must compact');
      expect(upper(compactionTask(work.state)) + limits.reserve).toBeLessThanOrEqual(requiredWindow(['f'.repeat(2048)], 'compaction'));
    }));
  });
  test('budget arithmetic and declared partitions cover each source once; admitted payloads fit exactly', () => {
    fc.assert(fc.property(unicode, fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 300000 }), fc.constantFrom<1 | 1.25>(1, 1.25), fc.nat(), (text, h, activeCount, window, multiplier, seed) => {
      const covered = seed % (h + 1);
      const extraChunks = activeCount > 0 && seed % 2 === 0 ? 2 : 0;
      const cutoff = h + activeCount + extraChunks;
      const p = partition(covered, h, cutoff);
      expect([p.view, p.tail, p.active].flatMap(r => Array.from({ length: r.to - r.from }, (_, i) => r.from + i))).toEqual(Array.from({ length: cutoff }, (_, i) => i));
      expect(upper([text, text], multiplier)).toBe(Math.ceil((2 * new TextEncoder().encode(text).length + 128) * multiplier));
      const tree = history(Array<number>(h).fill(utf8Bytes(text)));
      const tail = Array.from({ length: h - covered }, (_, i) => source(covered + i, text.repeat(40)));
      const active: ActiveEntry[] = Array.from({ length: activeCount }, (_, i) => ({ kind: 'user', sourcePos: h + i, sourceEnd: h + i + 1 + (i === activeCount - 1 ? extraChunks : 0), text, metadata: 'provider metadata' }));
      if (activeCount >= 2) {
        active[0] = { kind: 'tool-call', callId: 'call-1', sourcePos: h, sourceEnd: h + 1, text: '{}', metadata: 'call provider fields' };
        active[1] = { kind: 'tool-result', callId: 'call-1', sourcePos: h + 1, sourceEnd: h + 2 + (activeCount === 2 ? extraChunks : 0), text: text.repeat(100), metadata: 'result provider fields' };
      }
      const result = buildRequest({ rev: 4, gen: 2, pins: { revision: 3, active: [{ kind: 'owner', id: 'pin', version: 2,
          sourceId: 0, sourceVersion: 1, supersedes: 1, text }] }, lines: tree.leaves.slice(0, covered), covered, h, cutoff,
        tail, active, systemAndTools: ['system', 'tools'], parents: tree.nodes.filter(n => n.ref.a + n.ref.w <= covered), contextWindow: window, multiplier });
      if (result.kind === 'admitted') {
        expect(result.cost).toBe(upper(result.messages, multiplier) + limits.reserve);
        expect(result.cost).toBeLessThanOrEqual(window);
        expect(result.partition).toEqual(p);
        expect(result.messages[2]).toBe(text);
        expect(result.pinRev).toBe(3);
        expect(result.active.map(e => ({ ...e, text: '' }))).toEqual(active.map(e => ({ ...e, text: '' })));
        for (const e of result.active) if (e.kind === 'tool-result') expect(utf8Bytes(e.text)).toBeLessThanOrEqual(e.whole ? limits.wholeResult : limits.toolResult);
        if (result.omitted) expect(result.omitted).toEqual(p.tail);
      } else expect(result.reason).toBe('budget');
    }));
  });
});

// Independent rollback push from the referenced algorithm; no due arithmetic.
interface Push { readonly keep: boolean; readonly at: number; readonly older: Push | undefined }
function push(at: number, states: Push | undefined): Push {
  if (!states) return { keep: false, at, older: undefined };
  if (!states.keep) return { ...states, keep: true };
  return { keep: false, at, older: push(states.at, states.older) };
}
test('due order agrees with rollback push at every t from 0 through 20,000', () => {
  let states: Push | undefined;
  let lines: readonly Line[] = [];
  const built = new Map<string, Node>();
  for (let t = 0; t <= 20000; t++) {
    states = push(t, states);
    const leaf = finish(start({ a: t, w: 1, v: 1 }, { kind: 'leaf', source: source(t, 'x') }, []), []);
    built.set(keyId(leaf.ref), leaf);
    lines = [...lines, { kind: 'node', node: leaf }];
    for (let w = 2; (t + 1) % w === 0; w *= 2) {
      const key = nodeKey(t + 1 - w, w);
      const pair = children(key);
      if (!pair) throw new Error('Expected parent');
      const left = built.get(keyId(pair[0])); const right = built.get(keyId(pair[1]));
      if (!left || !right) throw new Error('Expected built children');
      built.set(keyId(key), finish(start({ ...key, v: 1 }, { kind: 'parent', children: [left, right] }, []), ['x']));
    }
    const starts: number[] = [];
    for (let current: Push | undefined = states; current; current = current.older) starts.unshift(current.at);
    while (lines.length > starts.length) {
      const parents = lines.flatMap(line => {
        const k = line.kind === 'node' ? line.node.ref : line.key;
        const parent = built.get(keyId({ a: Math.floor(k.a / (2 * k.w)) * 2 * k.w, w: 2 * k.w }));
        return parent ? [parent] : [];
      });
      const next = merge(lines, parents, t + 1);
      if (!next) throw new Error(`No merge at t=${t}`);
      lines = next;
    }
    expect(lines.map(l => l.kind === 'node' ? l.node.ref.a : l.key.a), `t=${t}`).toEqual(starts);
  }
}, 30000);

test('a whole tool result is sent in full up to its own limit, and paged past it', () => {
  const at = (text: string, whole?: boolean) => buildRequest({ rev: 1, gen: 1, pins: { revision: 0, active: [] }, lines: [], covered: 0, h: 0, cutoff: 2,
    tail: [], systemAndTools: ['system'], parents: [], contextWindow: 1_000_000,
    active: [{ kind: 'tool-call', callId: 'c', sourcePos: 0, sourceEnd: 1, text: '{}', metadata: '' },
      { kind: 'tool-result', callId: 'c', sourcePos: 1, sourceEnd: 2, text, metadata: '', ...(whole === undefined ? {} : { whole }) }] });
  const result = (text: string, whole?: boolean) => {
    const built = at(text, whole);
    if (built.kind !== 'admitted') throw new Error('Expected admitted');
    return built.active[1]!.text;
  };
  const schema = 's'.repeat(30_000);
  expect(result(schema, true)).toBe(schema);
  expect(utf8Bytes(result(schema))).toBeLessThanOrEqual(limits.toolResult);
  expect(result(schema)).toContain('(paged: zoom 1)');
  const huge = 's'.repeat(limits.wholeResult + 1);
  expect(utf8Bytes(result(huge, true))).toBeLessThanOrEqual(limits.wholeResult);
  expect(result(huge, true)).toContain('(paged: zoom 1)');
  // The active run's cap still holds a whole result.
  expect(limits.wholeResult).toBeLessThan(limits.active);
});

describe('compaction task text', () => {
  test('leaf task contains a byte ruler, the bounded original and raw context', () => {
    const original = 'leaf input '.repeat(80);
    const work = start({ a: 1, w: 1, v: 1 }, { kind: 'leaf', source: source(1, original) }, [source(0, 'earlier raw text')]);
    if (work.kind !== 'retry') throw new Error('Expected task');
    const text = compactionTask(work.state).join('\n');
    expect(text).toContain('-'.repeat(512));
    expect(text).toContain('earlier raw text');
    expect(text).toContain(original);
    expect(text).toContain('Do not call tools');
  });
  test('retry uses the same input without accumulating previous model output', () => {
    const work = start({ a: 0, w: 1, v: 1 }, { kind: 'leaf', source: source(0, 'original '.repeat(100)) }, []);
    if (work.kind !== 'retry') throw new Error('Expected task');
    const retry = complete(work.state, 'untrusted answer '.repeat(100));
    if (retry.kind !== 'retry') throw new Error('Expected retry');
    const text = compactionTask(retry.state).join('\n');
    expect(text).toContain('Too long');
    expect(text).toContain('original '.repeat(100));
    expect(text).not.toContain('untrusted answer');
  });
  test('parent task has both child texts and its interval', () => {
    const left = finish(start({ a: 0, w: 1, v: 1 }, { kind: 'leaf', source: source(0, 'left child') }, []), []);
    const right = finish(start({ a: 1, w: 1, v: 1 }, { kind: 'leaf', source: source(1, 'right child') }, []), []);
    const work = start({ a: 0, w: 2, v: 1 }, { kind: 'parent', children: [left, right] }, []);
    if (work.kind !== 'retry') throw new Error('Expected task');
    const text = compactionTask(work.state).join('\n');
    expect(text).toContain('messages 0–1');
    expect(text).toContain('left child\nright child');
  });
});
