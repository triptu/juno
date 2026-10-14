import { cutText, limits, merge, renderSource, renderView, utf8Bytes } from './tree.ts';
import type { Line, Node, Source } from './tree.ts';
import type { Pins } from './pins.ts';

export interface Range { readonly from: number; readonly to: number }
/** Half-open source ranges; placeholders retain coverage even when text is omitted. */
export function partition(covered: number, h: number, cutoff: number): { readonly view: Range; readonly tail: Range; readonly active: Range } {
  if (![covered, h, cutoff].every(n => Number.isSafeInteger(n) && n >= 0) || covered > h || h > cutoff) throw new RangeError('Invalid request cutoffs');
  return { view: { from: 0, to: covered }, tail: { from: covered, to: h }, active: { from: h, to: cutoff } };
}
/** Count the exact serialized text and metadata passed to the provider, plus framing. */
export function upper(messages: readonly string[], multiplier: 1 | 1.25 = 1): number {
  return Math.ceil(messages.reduce((n, text) => n + utf8Bytes(text) + limits.framing, 0) * multiplier);
}
export function admit(messages: readonly string[], contextWindow: number, multiplier: 1 | 1.25 = 1): boolean {
  return upper(messages, multiplier) + limits.reserve <= contextWindow;
}
export function requiredWindow(systemAndTools: readonly string[], path: 'chat' | 'compaction', multiplier: 1 | 1.25 = 1): number {
  // Caps include rendering/framing except raw pins and compaction children.
  // Nonempty one-byte pins can add up to 4 KB of separators in one message.
  const variable = path === 'chat' ? 2 * limits.pins + limits.high + limits.tail + limits.active + 4 * limits.framing
    : 2048 + limits.context + limits.input + 3 * limits.framing;
  return Math.ceil((upper(systemAndTools) + variable) * multiplier) + limits.reserve;
}
/** One provider entry can cover several contiguous archive chunks. */
interface EntryBase { readonly sourcePos: number; readonly sourceEnd: number; readonly text: string; readonly metadata: string }
export type ActiveEntry = (EntryBase & { readonly kind: 'user' | 'juno' | 'work' | 'wake' | 'card' | 'note' }) |
  (EntryBase & { readonly kind: 'tool-call' | 'tool-result'; readonly callId: string });
export interface RequestInput {
  readonly rev: number; readonly gen: number; readonly pins: Pins;
  readonly lines: readonly Line[]; readonly covered: number; readonly h: number; readonly cutoff: number;
  readonly tail: readonly Source[]; readonly active: readonly ActiveEntry[];
  readonly systemAndTools: readonly string[]; readonly parents: readonly Node[];
  readonly contextWindow: number; readonly multiplier?: 1 | 1.25;
}
export type Request = { readonly kind: 'admitted'; readonly messages: readonly string[];
  readonly rev: number; readonly gen: number; readonly pinRev: number;
  readonly partition: ReturnType<typeof partition>; readonly omitted: Range | undefined;
  readonly active: readonly ActiveEntry[]; readonly lines: readonly Line[]; readonly cost: number;
} | { readonly kind: 'blocked'; readonly reason: 'budget' | 'protocol' | 'input' };

function page(text: string, id: number, max: number): string {
  if (utf8Bytes(text) <= max) return text;
  const marker = `\n(paged: zoom ${id})\n`;
  const half = Math.floor((max - utf8Bytes(marker)) / 2);
  const reversed = [...text].toReversed().join('');
  return cutText(text, half, '') + marker + [...cutText(reversed, half, '')].toReversed().join('');
}
function renderActive(entry: ActiveEntry): string {
  return `${entry.sourcePos}–${entry.sourceEnd - 1} ${entry.kind}${'callId' in entry ? ` ${entry.callId}` : ''}\n${entry.metadata}\n${entry.text}`;
}
function protocol(entries: readonly ActiveEntry[], range: Range): boolean {
  let next = range.from;
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const e of entries) {
    if (e.sourcePos !== next || !Number.isSafeInteger(e.sourceEnd) || e.sourceEnd <= next || e.sourceEnd > range.to) return false;
    next = e.sourceEnd;
    if (e.kind === 'tool-call') { if (calls.has(e.callId)) return false; calls.add(e.callId); }
    if (e.kind === 'tool-result') { if (!calls.has(e.callId) || results.has(e.callId)) return false; results.add(e.callId); }
  }
  return next === range.to && calls.size === results.size;
}

/** Ordered fallbacks, ending in a local refusal. Hashing, stamps and spend belong to the provider guard. */
export function buildRequest(input: RequestInput): Request {
  const ranges = partition(input.covered, input.h, input.cutoff);
  renderView(input.lines, input.covered, input.h);
  if (!protocol(input.active, ranges.active) || input.tail.length !== input.h - input.covered ||
      input.tail.some((s, i) => s.id !== input.covered + i)) return { kind: 'blocked', reason: 'protocol' };
  if (input.active.some(e => (e.kind === 'user' && utf8Bytes(e.text) > limits.active) ||
      (e.kind === 'tool-call' && utf8Bytes(e.text) > limits.toolCall))) return { kind: 'blocked', reason: 'input' };
  if (input.pins.active.reduce((n, p) => n + utf8Bytes(p.text), 0) > limits.pins) return { kind: 'blocked', reason: 'input' };
  let active = input.active.map(e => e.kind === 'tool-result' ? { ...e, text: page(e.text, e.sourcePos, limits.toolResult) } : e);
  let tail = input.tail.map(renderSource);
  let omitted: Range | undefined;
  let lines = input.lines;
  const collapse = () => {
    if (input.covered < input.h) {
      tail = [`messages ${input.covered}–${input.h - 1} not summarized yet: zoom them`];
      omitted = ranges.tail;
    }
  };
  if (upper(tail) > limits.tail) collapse();
  const messages = () => [...input.systemAndTools, input.pins.active.map(p => p.text).join('\n'),
    renderView(lines, input.covered, input.h), ...tail, ...active.map(renderActive)];
  const fits = () => upper(active.map(renderActive)) <= limits.active && admit(messages(), input.contextWindow, input.multiplier);
  if (!fits() && !omitted) tail = input.tail.map(s => renderSource(s.kind === 'echo' ? { ...s, text: page(s.text, s.id, limits.toolResult) } : s));
  if (!fits()) collapse();
  if (!fits()) active = active.map((e, i) => e.kind === 'tool-result' && i < active.length - 1
    ? { ...e, text: `(paged: zoom ${e.sourcePos})` } : e);
  while (!fits()) {
    const next = merge(lines, input.parents, input.cutoff);
    if (!next) return { kind: 'blocked', reason: 'budget' };
    lines = next;
  }
  const rendered = messages();
  return { kind: 'admitted', messages: rendered, rev: input.rev, gen: input.gen, pinRev: input.pins.revision,
    partition: ranges, omitted, active, lines, cost: upper(rendered, input.multiplier) + limits.reserve };
}
