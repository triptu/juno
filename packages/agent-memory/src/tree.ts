/** Aligned archive interval [a, a + w); w is a power of two. */
export interface Key { readonly a: number; readonly w: number }
export interface Ref extends Key { readonly v: number }
export const limits = {
  target: 512, attempts: 5, node: 16_384, context: 16_384, input: 32_768,
  pins: 4_096, pin: 280, tail: 24_576, active: 65_536, reserve: 16_384,
  framing: 64, toolResult: 2_048, wholeResult: 49_152, toolCall: 8_192, high: 128_000, low: 64_000, workers: 8,
} as const;

export function nodeKey(a: number, w: number): Key {
  if (!Number.isSafeInteger(a) || a < 0 || !Number.isSafeInteger(w) || w < 1 ||
      (BigInt(w) & (BigInt(w) - 1n)) !== 0n || a % w !== 0 || !Number.isSafeInteger(a + w)) {
    throw new RangeError('Invalid node interval');
  }
  return { a, w };
}
export function children(k: Key): readonly [Key, Key] | undefined {
  return k.w === 1 ? undefined : [nodeKey(k.a, k.w / 2), nodeKey(k.a + k.w / 2, k.w / 2)];
}
export function sameKey(a: Key, b: Key): boolean { return a.a === b.a && a.w === b.w; }
export function withinCutoff(k: Key, h: number | undefined): boolean { return h === undefined || k.a + k.w <= h; }

/** Greatest age / width first, using the pair's inclusive last source and exact products. */
export function dueBefore(p: Key, q: Key, t: number): boolean {
  const delta = (BigInt(t) - BigInt(p.a + p.w - 1)) * BigInt(q.w) -
    (BigInt(t) - BigInt(q.a + q.w - 1)) * BigInt(p.w);
  return delta > 0n || (delta === 0n && p.a <= q.a);
}

export function utf8Bytes(text: string): number { return new TextEncoder().encode(text).length; }
/** Cut only at a Unicode code point boundary; the suffix is inside the byte limit. */
export function cutText(text: string, max: number, suffix = '(cut)'): string {
  if (utf8Bytes(text) <= max) return text;
  const available = max - utf8Bytes(suffix);
  if (available < 0) throw new RangeError('Suffix exceeds the byte limit');
  let size = 0;
  let result = '';
  for (const char of text) {
    const bytes = utf8Bytes(char);
    if (size + bytes > available) break;
    result += char;
    size += bytes;
  }
  return result + suffix;
}
export interface Source {
  readonly id: number;
  readonly version: number;
  readonly text: string;
  readonly kind: 'user' | 'juno' | 'tool' | 'echo' | 'work' | 'wake' | 'card' | 'note';
  readonly removed: boolean;
}
/** Exact child versions and raw context IDs. No pins and no context-node edges. */
export interface Node {
  readonly ref: Ref;
  readonly sources: readonly number[];
  readonly inputs: readonly Ref[];
  readonly deps: ReadonlySet<number>;
  readonly context: readonly number[];
  readonly text: string;
  readonly cut: boolean;
}
export type Line = { readonly kind: 'node'; readonly node: Node } | { readonly kind: 'masked'; readonly key: Key };
export function lineKey(line: Line): Key { return line.kind === 'node' ? line.node.ref : line.key; }

/** Ascending archive candidates: the nearest 257 retained sources suffice. Removed sources cost nothing. */
export function context(k: Key, archive: readonly Source[]): readonly Source[] {
  const selected: Source[] = [];
  let cost = 0;
  for (let i = archive.length - 1; i >= 0; i--) {
    const source = archive[i];
    if (!source || source.id >= k.a || source.removed) continue;
    const next = utf8Bytes(renderSource(source)) + limits.framing;
    if (cost + next > limits.context) break;
    selected.push(source);
    cost += next;
  }
  return selected;
}
export function renderSource(source: Source): string { return `message ${source.id} (${source.kind}): ${source.removed ? '(removed)' : source.text}`; }

/** Conservative closure of recorded reads, independent of what the summary says. */
export function deps(nodes: readonly Node[]): ReadonlySet<number> {
  return new Set(nodes.flatMap(node => [...node.deps]));
}
export function taintClosure(nodes: readonly Node[], removed: ReadonlySet<number>): readonly Node[] {
  return nodes.filter(node => [...node.deps].some(id => removed.has(id)));
}
export function mask(lines: readonly Line[], removed: ReadonlySet<number>): readonly Line[] {
  return lines.map(line => line.kind === 'node' && taintClosure([line.node], removed).length
    ? { kind: 'masked', key: line.node.ref } : line);
}

/** Validates a partition and refuses any view beyond the live run's cutoff. */
export function renderView(lines: readonly Line[], covered: number, h: number): string {
  let end = 0;
  const rendered = lines.map(line => {
    const k = lineKey(line);
    nodeKey(k.a, k.w);
    if (k.a !== end || !withinCutoff(k, h)) throw new RangeError('View is not a partition within the cutoff');
    end += k.w;
    return `${k.a}+${k.w}|${line.kind === 'masked' ? '(being updated)' : line.node.text.replaceAll(/\r\n?|\n/g, ' ')}`;
  });
  if (end !== covered || covered > h) throw new RangeError('View coverage differs from its entries');
  return rendered.join('\n');
}

/** One batch step: only clean built sibling parents, with due order and oldest ties. */
export function merge(lines: readonly Line[], parents: readonly Node[], t: number): readonly Line[] | undefined {
  const choices: { index: number; parent: Node }[] = [];
  lines.forEach((left, index) => {
    const right = lines[index + 1];
    if (left.kind !== 'node' || right?.kind !== 'node') return;
    const p = left.node.ref;
    const q = right.node.ref;
    if (p.w !== q.w || p.a % (2 * p.w) !== 0 || p.a + p.w !== q.a) return;
    const parent = parents.find(n => n.ref.a === p.a && n.ref.w === 2 * p.w &&
      n.inputs.length === 2 && n.inputs.some(c => c.a === p.a && c.w === p.w && c.v === p.v) &&
      n.inputs.some(c => c.a === q.a && c.w === q.w && c.v === q.v));
    if (parent) choices.push({ index, parent });
  });
  const choice = choices.reduce<typeof choices[number] | undefined>((best, next) =>
    !best || dueBefore(next.parent.ref, best.parent.ref, t) ? next : best, undefined);
  return choice ? [...lines.slice(0, choice.index), { kind: 'node', node: choice.parent }, ...lines.slice(choice.index + 2)] : undefined;
}
export function batch(lines: readonly Line[], parents: readonly Node[], t: number, inBatch = false): {
  readonly lines: readonly Line[]; readonly pending: boolean;
} {
  const size = (xs: readonly Line[]) => utf8Bytes(renderView(xs, xs.reduce((n, x) => n + lineKey(x).w, 0), t));
  let result = lines;
  if (!inBatch && size(result) <= limits.high) return { lines, pending: false };
  while (size(result) > limits.low) {
    const next = merge(result, parents, t);
    if (!next) return { lines: result, pending: true };
    result = next;
  }
  return { lines: result, pending: false };
}
export interface QueueEntry { readonly key: Key; readonly dueAt: number }
const keyId = (k: Key) => `${k.a}:${k.w}`;
/** Caller passes all missing keys, including work waiting on a deadline. */
export function readyQueue(args: {
  readonly queue: readonly QueueEntry[]; readonly active: readonly Key[];
  readonly built: readonly Node[]; readonly now: number; readonly h: number | undefined;
}): readonly Key[] {
  const built = new Set(args.built.map(n => keyId(n.ref)));
  const active = new Set(args.active.map(keyId));
  const earlierLeaves = new Map<number, number>();
  const leaves = args.queue.filter(row => row.key.w === 1).toSorted((a, b) => a.key.a - b.key.a);
  leaves.forEach((row, index) => earlierLeaves.set(row.key.a, index));
  const ready = args.queue.filter(row => row.dueAt <= args.now && withinCutoff(row.key, args.h) &&
    !active.has(keyId(row.key)) && (row.key.w === 1
      ? (earlierLeaves.get(row.key.a) ?? 0) < limits.workers
      : children(row.key)?.every(k => built.has(keyId(k)))));
  return ready.toSorted((a, b) => a.dueAt - b.dueAt || a.key.a - b.key.a)
    .slice(0, Math.max(0, limits.workers - args.active.length)).map(row => row.key);

}
export function retryDelay(attempts: number): number {
  return attempts <= 1 ? 30_000 : attempts === 2 ? 120_000 : attempts === 3 ? 600_000 : 3_600_000;
}
