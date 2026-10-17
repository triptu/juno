import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { checkEntry, DOCS, docLimits, looksSecret, outline, renderDocs, searchDocs, utf8Bytes } from '../src/index.ts';
import type { Doc, DocEntry } from '../src/index.ts';

const entry = (id: string, doc: Doc, text: string): DocEntry => ({ id, doc, text });
const doc = fc.constantFrom(...DOCS);
const note = fc.string({ minLength: 1, maxLength: 400 }).filter((s) => s.trim() !== '');
const entries = fc.array(fc.tuple(doc, note), { maxLength: 120 }).map((rows) => rows.map(([d, t], i) => entry(`e${i}`, d, t)));

describe('the outline', () => {
  test('stays within its budget and names every doc, whatever the docs hold', () => {
    fc.assert(fc.property(entries, fc.nat({ max: 10_000 }), (all, rev) => {
      const text = outline(all, rev);
      expect(utf8Bytes(text)).toBeLessThanOrEqual(docLimits.outline);
      for (const title of ['About you', 'People', 'Projects', 'Preferences', 'Writing style']) expect(text).toContain(`${title}:`);
    }));
  });

  test('is the same for the same docs, so an unchanged memory keeps the cached prefix', () => {
    fc.assert(fc.property(entries, (all) => { expect(outline(all, 3)).toBe(outline([...all], 3)) }));
  });

  test('says how many entries the full doc has beyond the ones it shows', () => {
    const people = Array.from({ length: 30 }, (_, i) => entry(`p${i}`, 'people', `Person ${i} leads a team that works on a long list of things in the platform group`));
    const text = outline(people, 1);
    const shown = (text.match(/Person \d+/g) ?? []).length;
    expect(shown).toBeGreaterThan(0);
    expect(text).toContain(`(+${30 - shown} more)`);
    // The newest come first.
    expect(text).toContain('Person 29');
  });

  test('marks an empty doc', () => {
    expect(outline([entry('a', 'you', 'Staff engineer on the sync team')], 1)).toContain('People: (empty)');
  });
});

describe('an entry', () => {
  test('is refused when it holds a key or a password', () => {
    for (const secret of ['my key is sk-or-v1-abcdef0123456789abcdef', 'xoxc-1234567890-abcdefghij', 'password: hunter2', 'ghp_abcdefghijklmnopqrstuvwx123456', 'token=Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb']) {
      expect(checkEntry('you', secret, [])).toBe('secret');
      expect(looksSecret(secret)).toBe(true);
    }
  });

  test('is kept when it only reads like ordinary notes', () => {
    for (const plain of ['Prefers short replies before 10am', 'Maya Chen leads design for the sync project', 'Writes "thanks!" and signs off without a name', 'See https://example.com/docs/getting-started-with-the-new-sync-engine']) {
      expect(checkEntry('you', plain, [])).toBeUndefined();
    }
  });

  test('is refused when empty, too long, or when the doc or the memory is full', () => {
    expect(checkEntry('you', '   ', [])).toBe('empty');
    expect(checkEntry('you', 'x '.repeat(400), [])).toBe('tooLong');
    const full = Array.from({ length: docLimits.entries }, (_, i) => entry(`p${i}`, 'people', `Person ${i}`));
    expect(checkEntry('people', 'One more', full)).toBe('docFull');
    expect(checkEntry('projects', 'One more', full)).toBeUndefined();
    const big = Array.from({ length: 70 }, (_, i) => entry(`b${i}`, DOCS[i % 5]!, 'word '.repeat(100)));
    expect(checkEntry('you', 'One more line that does not fit', big)).toBe('full');
  });
});

describe('the docs', () => {
  test('render as markdown with each entry\'s id', () => {
    const all = [entry('e1', 'people', 'Maya Chen: design lead'), entry('e2', 'style', 'Short sentences')];
    expect(renderDocs(all, 'people')).toBe('# People (people)\n- [e1] Maya Chen: design lead');
    expect(renderDocs(all)).toContain('# Writing style (style)\n- [e2] Short sentences');
    expect(renderDocs(all)).toContain('# Projects (projects)\n(empty)');
  });

  test('search finds entries by their words, best match first', () => {
    const all = [entry('e1', 'people', 'Maya Chen leads design'), entry('e2', 'projects', 'Sync engine rewrite with Maya'), entry('e3', 'style', 'Short sentences')];
    expect(searchDocs(all, 'maya design').map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(searchDocs(all, 'writing').map((e) => e.id)).toEqual(['e3']);
    expect(searchDocs(all, '?')).toEqual([]);
  });
});
