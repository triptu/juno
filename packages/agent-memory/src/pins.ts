import { limits, utf8Bytes } from './tree.ts';
import type { Source } from './tree.ts';

interface PinBase {
  readonly id: string; readonly version: number; readonly sourceId: number;
  readonly sourceVersion: number; readonly text: string;
}
export type Pin = (PinBase & { readonly kind: 'span'; readonly from: number; readonly to: number }) |
  (PinBase & { readonly kind: 'owner'; readonly supersedes: number });
export interface Pins { readonly revision: number; readonly active: readonly Pin[] }
export type PinChange = { readonly kind: 'changed'; readonly pins: Pins } |
  { readonly kind: 'refused'; readonly reason: 'source' | 'span' | 'conflict' | 'budget' };

function change(pins: Pins, active: readonly Pin[]): PinChange {
  if (active.reduce((n, p) => n + utf8Bytes(p.text), 0) > limits.pins) return { kind: 'refused', reason: 'budget' };
  return { kind: 'changed', pins: { revision: pins.revision + 1, active } };
}
/** Trusted byte slicing; rejects spans that split UTF-8 characters or leave this run. */
export function remember(args: {
  readonly pins: Pins; readonly id: string; readonly source: Source;
  readonly h: number; readonly cutoff: number; readonly from: number; readonly to: number;
}): PinChange {
  const { pins, source, from, to } = args;
  if (source.removed || source.kind !== 'user' || source.id < args.h || source.id >= args.cutoff) return { kind: 'refused', reason: 'source' };
  if (pins.active.some(p => p.id === args.id)) return { kind: 'refused', reason: 'conflict' };
  const bytes = new TextEncoder().encode(source.text);
  const boundary = (at: number) => at === bytes.length || (bytes[at] !== undefined && ((bytes[at] ?? 0) & 0xc0) !== 0x80);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > bytes.length ||
      to - from > limits.pin || !boundary(from) || !boundary(to)) return { kind: 'refused', reason: 'span' };
  const pin: Pin = { kind: 'span', id: args.id, version: 1, sourceId: source.id, sourceVersion: source.version,
    from, to, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.slice(from, to)) };
  return change(pins, [...pins.active, pin]);
}
/** CAS on the old version and source lineage, never on a model-supplied attribution. */
export function editPin(args: { readonly pins: Pins; readonly expected: Pin; readonly source: Source; readonly text: string }): PinChange {
  const { pins, expected, source, text } = args;
  const old = pins.active.find(p => p.id === expected.id);
  if (!old || old.version !== expected.version || old.sourceId !== expected.sourceId || old.sourceVersion !== expected.sourceVersion) return { kind: 'refused', reason: 'conflict' };
  if (source.removed || source.id !== old.sourceId || source.version !== old.sourceVersion) return { kind: 'refused', reason: 'source' };
  if (!text) return { kind: 'refused', reason: 'span' };
  const edited: Pin = { kind: 'owner', id: old.id, version: old.version + 1, sourceId: old.sourceId,
    sourceVersion: old.sourceVersion, supersedes: old.version, text };
  return change(pins, pins.active.map(p => p.id === old.id ? edited : p));
}
/** Undo and deactivation share the same version check. */
export function deactivatePin(pins: Pins, expected: Pin): PinChange {
  if (!pins.active.some(p => p.id === expected.id && p.version === expected.version &&
      p.sourceId === expected.sourceId && p.sourceVersion === expected.sourceVersion)) return { kind: 'refused', reason: 'conflict' };
  return change(pins, pins.active.filter(p => p.id !== expected.id));
}
export function redactPins(pins: Pins, removed: ReadonlySet<number>): Pins {
  const active = pins.active.filter(p => !removed.has(p.sourceId));
  return active.length === pins.active.length ? pins : { revision: pins.revision + 1, active };
}
/** Admission must check both values inside the caller's transaction. */
export function snapshotCurrent(expected: { readonly gen: number; readonly pinRev: number }, current: { readonly gen: number; readonly pinRev: number }): boolean {
  return expected.gen === current.gen && expected.pinRev === current.pinRev;
}
