/**
 * Checks that an answer comes on time and into the room kept for it: the
 * part an input opens shows within a few frames, and content that loads
 * into a reserved box leaves the box's size alone. The other checks are in
 * `checks.ts`.
 */
import { fail, framesIn, isRect, markFrame, markTime, pass, shot, shotOfFrame, shotsOf, type Check, type Window } from './checks'
import type { ProbeValue, Rect } from './recorder'

/**
 * The answer to an input shows within `frames` animation frames of it: the
 * probe reaches a value `ready` accepts by then. Within one frame is "in the
 * next frame"; a part that loads its code or data first may take a few.
 * `eventType` "mark" counts from the `from` mark instead of an event.
 */
export function answersWithin(probe: string, eventType: string, label: string, options: Window & { readonly frames?: number; readonly ready?: (value: ProbeValue | undefined) => boolean } = {}): Check {
  const frames = options.frames ?? 1
  const name = `${label} answers within ${frames} frame${frames === 1 ? '' : 's'}`
  const ready = options.ready ?? ((value) => value !== null && value !== undefined && value !== 0 && value !== '')
  return (evidence) => {
    const { recording } = evidence
    const from = markTime(recording, options.from, -Infinity)
    const events = recording.events.filter((e) => e.type === eventType && e.t >= from)
    // `mark`: an input the page gets no event for, such as an app menu item; counted from the `from` mark.
    const event = eventType === 'mark' ? { nextFrame: markFrame(recording, options.from, 0) } : (events.find((e) => e.within.includes(probe)) ?? events[0])
    if (event === undefined) return fail(name, `no ${eventType} event`, [])
    const shown = recording.frames.slice(event.nextFrame).find((frame) => ready(frame.values[probe]))
    if (shown === undefined) return fail(name, `never answered after the ${eventType}`, [shotOfFrame(evidence, event.nextFrame)])
    const late = shown.index - event.nextFrame + 1
    const shots = [...new Set([shotOfFrame(evidence, event.nextFrame), shot(evidence, shown)])]
    return late <= frames ? pass(name, `answered in frame ${late} after the ${eventType}`, shots) : fail(name, `answered in frame ${late} after the ${eventType}: a late answer`, shots)
  }
}

/** Once the probe has a box, its width and height never change, wherever it moves: content that loads into a reserved box. */
export function keepsSize(probe: string, label: string, options: Window = {}): Check {
  const name = `${label} keeps its size`
  return (evidence) => {
    const frames = framesIn(evidence.recording, options).filter((frame) => isRect(frame.values[probe] ?? null))
    const first = frames[0]
    if (first === undefined) return fail(name, `${label} never appeared`, [])
    const box = first.values[probe] as Rect
    const changed = frames.filter((frame) => {
      const now = frame.values[probe] as Rect
      return Math.abs(now.width - box.width) > 0.5 || Math.abs(now.height - box.height) > 0.5
    })
    if (changed.length === 0) return pass(name, `${Math.round(box.width)}x${Math.round(box.height)} from #${shot(evidence, first)}`, [shot(evidence, first)])
    const last = frames.at(-1)!.values[probe] as Rect
    return fail(name, `${Math.round(box.width)}x${Math.round(box.height)} at #${shot(evidence, first)}, changed in ${changed.length} frames (first at #${shot(evidence, changed[0]!)}), ends ${Math.round(last.width)}x${Math.round(last.height)}`, shotsOf(evidence, [first, ...changed]).slice(0, 12))
  }
}
