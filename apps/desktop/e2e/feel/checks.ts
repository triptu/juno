/**
 * What a recording must show to feel stable. Each check reads the frames
 * and returns a verdict with the filmstrip frames that prove it. They count
 * frames and compare geometry; none of them times anything except the long
 * animation frame check, which uses the browser's own entries.
 */
import type { EdgeValue, ProbeFrame, ProbeValue, Recording, Rect, ScrollValue, ShiftSource } from './recorder'

/** Per filmstrip frame and region: the share of pixels that changed since the frames before, and how uniform the region is. */
export interface ShotPixels {
  readonly number: number
  /** The animation frame stamped into the image; null when the stamp could not be read. */
  readonly frame: number | null
  readonly regions: Readonly<Record<string, { readonly changed: number; readonly changedSkip: number; readonly spread: number }>>
}

export interface Evidence {
  readonly recording: Recording
  readonly pixels: ReadonlyArray<ShotPixels>
}

export interface Verdict {
  readonly name: string
  /** `warn` is reported but does not fail the run. */
  readonly status: 'pass' | 'fail' | 'warn'
  readonly detail: string
  /** Filmstrip frame numbers to look at. */
  readonly shots: ReadonlyArray<number>
}

export type Check = (evidence: Evidence) => Verdict

interface Window {
  /** Look only at frames after this mark. */
  readonly from?: string
  /** And before this one. */
  readonly to?: string
  /** And only frames whose values pass this. */
  readonly where?: (values: ProbeFrame['values']) => boolean
}

const BOTTOM_SLACK = 2
/** A pixel counts as changed when its grey level moved by more than this. */
export const PIXEL_DELTA = 16
/** A region whose grey levels spread less than this is empty: one flat colour. */
const BLANK_SPREAD = 3
/** A flicker changes at least this share of a region and puts it back within two frames. */
const FLICKER_SHARE = 0.005

function markFrame(recording: Recording, label: string | undefined, fallback: number): number {
  if (label === undefined) return fallback
  const mark = recording.marks.find((m) => m.label === label)
  if (mark === undefined) throw new Error(`No mark "${label}" in the recording`)
  return mark.nextFrame
}

function markTime(recording: Recording, label: string | undefined, fallback: number): number {
  if (label === undefined) return fallback
  const mark = recording.marks.find((m) => m.label === label)
  if (mark === undefined) throw new Error(`No mark "${label}" in the recording`)
  return mark.t
}

function framesIn(recording: Recording, window: Window): ReadonlyArray<ProbeFrame> {
  const from = markFrame(recording, window.from, 0)
  const to = markFrame(recording, window.to, recording.frames.length)
  const frames = recording.frames.slice(from, to)
  return window.where === undefined ? frames : frames.filter((frame) => window.where!(frame.values))
}

/** The filmstrip frame that shows animation frame `index`: the first image stamped with it, or with a later frame. */
export function shotOfFrame(evidence: Evidence, index: number): number {
  const exact = evidence.pixels.find((p) => p.frame !== null && p.frame >= index)
  if (exact !== undefined) return exact.number
  return evidence.pixels.at(-1)?.number ?? 0
}

/** The filmstrip frame for something the page timed (a shift, a long frame, an event): the first animation frame at or after it. */
export function shotAtTime(evidence: Evidence, t: number): number {
  const frame = evidence.recording.frames.find((f) => f.t >= t - 1) ?? evidence.recording.frames.at(-1)
  return frame === undefined ? 0 : shotOfFrame(evidence, frame.index)
}

const shot = (evidence: Evidence, frame: ProbeFrame) => shotOfFrame(evidence, frame.index)
const shotsOf = (evidence: Evidence, frames: ReadonlyArray<ProbeFrame>) => [...new Set(frames.map((frame) => shot(evidence, frame)))]

/** The images between two marks, by their stamped frame. */
function pixelsIn(evidence: Evidence, window: Window): ReadonlyArray<ShotPixels> {
  const from = markFrame(evidence.recording, window.from, 0)
  const to = markFrame(evidence.recording, window.to, Infinity)
  return evidence.pixels.filter((p) => p.frame !== null && p.frame >= from && p.frame < to)
}

const pass = (name: string, detail: string, shots: ReadonlyArray<number> = []): Verdict => ({ name, status: 'pass', detail, shots })
const fail = (name: string, detail: string, shots: ReadonlyArray<number>): Verdict => ({ name, status: 'fail', detail, shots })

const isRect = (value: ProbeValue): value is Rect => typeof value === 'object' && value !== null && 'width' in value
const isScroll = (value: ProbeValue): value is ScrollValue => typeof value === 'object' && value !== null && 'fromBottom' in value
const isEdge = (value: ProbeValue): value is EdgeValue => typeof value === 'object' && value !== null && 'key' in value

const show = (value: ProbeValue): string => {
  if (isRect(value)) return `(${Math.round(value.x)}, ${Math.round(value.y)}) ${Math.round(value.width)}x${Math.round(value.height)}`
  return JSON.stringify(value)
}

function differs(a: ProbeValue, b: ProbeValue, tolerance: number): boolean {
  if (isRect(a) && isRect(b)) return Math.abs(a.x - b.x) > tolerance || Math.abs(a.y - b.y) > tolerance || Math.abs(a.width - b.width) > tolerance || Math.abs(a.height - b.height) > tolerance
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > tolerance
  return JSON.stringify(a) !== JSON.stringify(b)
}

/** Once the probe has a value, it keeps it: the element lands where it stays. */
export function landsAndStays(probe: string, label: string, options: Window & { readonly tolerance?: number } = {}): Check {
  const name = `${label} lands and stays`
  return (evidence) => {
    const { recording } = evidence
    const frames = framesIn(recording, options).filter((frame) => frame.values[probe] !== null && frame.values[probe] !== undefined)
    const first = frames[0]
    if (first === undefined) return fail(name, `${label} never appeared`, [])
    const moved = frames.filter((frame) => differs(frame.values[probe]!, first.values[probe]!, options.tolerance ?? 1))
    if (moved.length === 0) return pass(name, `at ${show(first.values[probe]!)} from frame #${shot(evidence, first)}`, [shot(evidence, first)])
    const last = moved.at(-1)!
    return fail(name, `first at ${show(first.values[probe]!)} (frame #${shot(evidence, first)}), then at ${show(moved[0]!.values[probe]!)} (frame #${shot(evidence, moved[0]!)}), ends at ${show(last.values[probe]!)}; moved in ${moved.length} animation frames`, shotsOf(evidence, [first, ...moved]).slice(0, 12))
  }
}

/** Every frame, once the scroller is there, sits at the bottom. */
export function staysAtBottom(probe: string, options: Window = {}): Check {
  const name = 'stays at the bottom'
  return (evidence) => {
    const { recording } = evidence
    const frames = framesIn(recording, options).filter((frame) => isScroll(frame.values[probe] ?? null))
    if (frames.length === 0) return fail(name, 'the list never appeared', [])
    const off = frames.filter((frame) => (frame.values[probe] as ScrollValue).fromBottom > BOTTOM_SLACK)
    if (off.length === 0) return pass(name, `within ${BOTTOM_SLACK}px of the bottom in all ${frames.length} animation frames`)
    const worst = Math.max(...off.map((frame) => (frame.values[probe] as ScrollValue).fromBottom))
    return fail(name, `${off.length} of ${frames.length} animation frames were off the bottom, by up to ${Math.round(worst)}px`, shotsOf(evidence, off).slice(0, 12))
  }
}

/** The row at the edge of the view does not move from one frame to the next. Only for windows where the user does not scroll. */
export function contentHoldsStill(probe: string, options: Window & { readonly tolerance?: number } = {}): Check {
  const name = 'what is on screen holds still'
  return (evidence) => {
    const { recording } = evidence
    const frames = framesIn(recording, options)
    const jumps: Array<{ frame: ProbeFrame; by: number }> = []
    for (let i = 1; i < frames.length; i++) {
      const before = frames[i - 1]!.values[probe] ?? null
      const now = frames[i]!.values[probe] ?? null
      if (!isEdge(before) || !isEdge(now) || now.previousAt === null || now.previousKey !== before.key) continue
      const by = now.previousAt - before.at
      if (Math.abs(by) > (options.tolerance ?? 1)) jumps.push({ frame: frames[i]!, by })
    }
    if (jumps.length === 0) return pass(name, `no row in view moved over ${frames.length} animation frames`)
    return fail(name, `content jumped in ${jumps.length} animation frames: ${jumps.slice(0, 6).map((j) => `${Math.round(j.by)}px at frame #${shot(evidence, j.frame)}`).join(', ')}`, shotsOf(evidence, jumps.map((j) => j.frame)).slice(0, 12))
  }
}

/** While scrolling one way, what is on screen never moves the other way. */
export function scrollsOneWay(probe: string, direction: 'down' | 'up', options: Window = {}): Check {
  const name = `scrolling ${direction} never jumps back`
  return (evidence) => {
    const { recording } = evidence
    const frames = framesIn(recording, options)
    const back: Array<{ frame: ProbeFrame; by: number }> = []
    for (let i = 1; i < frames.length; i++) {
      const before = frames[i - 1]!.values[probe] ?? null
      const now = frames[i]!.values[probe] ?? null
      if (!isEdge(before) || !isEdge(now) || now.previousAt === null || now.previousKey !== before.key) continue
      // Scrolling down moves content up (negative); up moves it down.
      const by = now.previousAt - before.at
      if (direction === 'down' ? by > 1 : by < -1) back.push({ frame: frames[i]!, by })
    }
    if (back.length === 0) return pass(name, `content moved only ${direction === 'down' ? 'up' : 'down'} over ${frames.length} animation frames`)
    return fail(name, `content moved against the scroll in ${back.length} animation frames: ${back.slice(0, 6).map((b) => `${Math.round(b.by)}px at frame #${shot(evidence, b.frame)}`).join(', ')}`, shotsOf(evidence, back.map((b) => b.frame)).slice(0, 12))
  }
}

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

const showSource = (source: ShiftSource) => `${source.node} ${show(source.before)} -> ${show(source.after)}`

/**
 * No layout-shift entry. With `region`, only shifts of elements inside that
 * region count. Shifts within 500 ms of a press are left out unless
 * `includeInput`, since a press may replace what is on screen. With
 * `warn`, a shift is reported but does not fail the run.
 */
export function noLayoutShift(options: Window & { readonly includeInput?: boolean; readonly region?: string; readonly label?: string; readonly warn?: boolean } = {}): Check {
  const name = options.label ?? 'no layout shift'
  return (evidence) => {
    const { recording } = evidence
    const from = markTime(recording, options.from, -Infinity)
    const to = markTime(recording, options.to, Infinity)
    const area = options.region === undefined ? undefined : recording.regions[options.region]
    if (options.region !== undefined && area === undefined) return fail(name, `no region ${options.region}`, [])
    const inArea = (source: ShiftSource) => area === undefined || intersects(source.before, area) || intersects(source.after, area)
    const counted = recording.shifts
      .filter((s) => s.t >= from && s.t < to && s.value > 0 && (options.includeInput === true || !s.hadRecentInput))
      .map((s) => ({ ...s, sources: s.sources.filter(inArea) }))
      .filter((s) => s.sources.length > 0 || area === undefined)
    if (counted.length === 0) return pass(name, `${recording.shifts.length} entries in the recording, none counted`)
    const sources = counted.flatMap((s) => s.sources).slice(0, 4).map(showSource)
    const detail = `${counted.length} shifts, score ${counted.reduce((sum, s) => sum + s.value, 0).toFixed(4)}: ${sources.join('; ')}`
    const shots = [...new Set(counted.map((s) => shotAtTime(evidence, s.t)))].slice(0, 12)
    return options.warn === true ? { name, status: 'warn', detail, shots } : fail(name, detail, shots)
  }
}

/** The look of `probe` changes in the first frame after the first `eventType` event that follows the mark. */
export function feedbackInOneFrame(probe: string, eventType: string, label: string, options: Window = {}): Check {
  const name = `${label} shows in the next frame`
  return (evidence) => {
    const { recording } = evidence
    const from = markTime(recording, options.from, -Infinity)
    const event = recording.events.find((e) => e.type === eventType && e.t >= from)
    if (event === undefined) return fail(name, `no ${eventType} event`, [])
    const before = recording.frames[event.nextFrame - 1]?.values[probe] ?? null
    const after = recording.frames.slice(event.nextFrame)
    const changed = after.find((frame) => frame.values[probe] !== before || String(frame.values[probe]).endsWith('animating'))
    if (changed === undefined) return fail(name, `the look never changed after the ${eventType}`, shotsOf(evidence, after.slice(0, 3)))
    const late = changed.index - event.nextFrame
    const shots = [...new Set([shotOfFrame(evidence, event.nextFrame), shot(evidence, changed)])]
    if (late === 0) return pass(name, `changed in the first frame after the ${eventType}`, shots)
    return fail(name, `changed ${late} frame${late === 1 ? '' : 's'} late`, shots)
  }
}

/** Once shown, the element stays, with content in its first frame. */
export function opensWhole(probe: string, textProbe: string, label: string, options: Window = {}): Check {
  const name = `${label} opens whole`
  return (evidence) => {
    const { recording } = evidence
    const frames = framesIn(recording, options)
    const first = frames.findIndex((frame) => frame.values[probe] !== null)
    if (first === -1) return fail(name, `${label} never opened`, [])
    const firstFrame = frames[first]!
    const text = firstFrame.values[textProbe]
    if (typeof text !== 'string' || text.length === 0) return fail(name, `${label} was empty in its first frame`, [shot(evidence, firstFrame)])
    const gone = frames.slice(first).filter((frame) => frame.values[probe] === null)
    if (gone.length > 0) return fail(name, `${label} disappeared in ${gone.length} animation frames after opening`, shotsOf(evidence, gone).slice(0, 12))
    return pass(name, `had content from its first frame, #${shot(evidence, firstFrame)}`, [shot(evidence, firstFrame)])
  }
}

/** In its first frame the element sits next to its anchor: overlapping it horizontally, its near edge within `gap` of the anchor's. */
export function opensAtAnchor(probe: string, anchorProbe: string, label: string, options: Window & { readonly gap?: number } = {}): Check {
  const name = `${label} opens at its anchor`
  return (evidence) => {
    const { recording } = evidence
    const frames = framesIn(recording, options)
    const firstFrame = frames.find((frame) => isRect(frame.values[probe] ?? null))
    if (firstFrame === undefined) return fail(name, `${label} never opened`, [])
    const box = firstFrame.values[probe] as Rect
    const anchor = frames.findLast((frame) => frame.t <= firstFrame.t && isRect(frame.values[anchorProbe] ?? null))?.values[anchorProbe] as Rect | undefined
    if (anchor === undefined) return fail(name, 'the anchor was not on screen', [shot(evidence, firstFrame)])
    const gap = options.gap ?? 24
    const overlaps = box.x < anchor.x + anchor.width && box.x + box.width > anchor.x
    const below = Math.abs(box.y - (anchor.y + anchor.height))
    const above = Math.abs(box.y + box.height - anchor.y)
    const ok = overlaps && Math.min(below, above) <= gap
    const detail = `${label} ${show(box)}, anchor ${show(anchor)}`
    return ok ? pass(name, detail, [shot(evidence, firstFrame)]) : fail(name, `${detail}: not next to the anchor`, [shot(evidence, firstFrame)])
  }
}

/**
 * Every frame shows either the state before or the state after: no blank,
 * no third state, and no going back once the new state showed. `read`
 * turns a frame's values into the state it shows.
 */
export function switchesOnce(label: string, read: (values: ProbeFrame['values']) => string, options: Window = {}): Check {
  const name = `${label} switches once`
  return (evidence) => {
    const { recording } = evidence
    const frames = framesIn(recording, options)
    const states = frames.map((frame) => read(frame.values))
    const first = states[0]
    const last = states.at(-1)
    if (first === undefined || last === undefined) return fail(name, 'no frames', [])
    const strange = frames.filter((_, i) => states[i] !== first && states[i] !== last)
    const lastAt = states.indexOf(last)
    const back = frames.slice(lastAt).filter((_, i) => states[lastAt + i] !== last)
    if (strange.length === 0 && back.length === 0) return pass(name, `${first} → ${last} at frame #${shot(evidence, frames[lastAt]!)}`, [shot(evidence, frames[lastAt]!)])
    const odd = strange[0] ?? back[0]!
    return fail(name, `${strange.length} frames showed another state (first: ${states[frames.indexOf(odd)]} at frame #${shot(evidence, odd)}), ${back.length} went back; expected ${first} → ${last}`, shotsOf(evidence, [...strange, ...back]).slice(0, 12))
  }
}

/** The first frame that `where` picks already shows the final state: `expected` returns null when it does, or what is wrong. */
export function firstFrameRight(label: string, where: (values: ProbeFrame['values']) => boolean, expected: (values: ProbeFrame['values']) => string | null, options: Window = {}): Check {
  return (evidence) => {
    const { recording } = evidence
    const first = framesIn(recording, { ...options, where })[0]
    if (first === undefined) return fail(label, 'never happened', [])
    const wrong = expected(first.values)
    const number = shot(evidence, first)
    return wrong === null ? pass(label, `right from frame #${number}`, [number]) : fail(label, `${wrong} in the first frame, #${number}`, [number])
  }
}

/** Long animation frames: over `failMs` fails, over 50 ms warns. */
export function noLongFrames(options: Window & { readonly failMs?: number } = {}): Check {
  const name = 'no long animation frames'
  return (evidence) => {
    const { recording } = evidence
    const from = markTime(recording, options.from, -Infinity)
    const to = markTime(recording, options.to, Infinity)
    const long = recording.longFrames.filter((f) => f.t >= from && f.t < to)
    const failMs = options.failMs ?? 100
    if (long.length === 0) return pass(name, 'none over 50 ms')
    const worst = long.reduce((max, f) => (f.duration > max.duration ? f : max))
    const detail = `${long.length} over 50 ms, longest ${Math.round(worst.duration)} ms (blocking ${Math.round(worst.blocking)} ms) ${worst.scripts.slice(0, 3).join('; ')}`
    const shots = [...new Set(long.map((f) => shotAtTime(evidence, f.t)))].slice(0, 12)
    return worst.duration > failMs ? fail(name, detail, shots) : { name, status: 'warn', detail, shots }
  }
}

/** The region is never one flat colour: no empty flash. */
export function neverBlank(region: string, label: string, options: Window = {}): Check {
  const name = `${label} never blank`
  return (evidence) => {
    const shots = pixelsIn(evidence, options)
    const blank = shots.filter((p) => (p.regions[region]?.spread ?? Infinity) < BLANK_SPREAD)
    if (blank.length === 0) return pass(name, `${shots.length} frames, none blank`)
    return fail(name, `${blank.length} frames were one flat colour`, blank.map((p) => p.number).slice(0, 12))
  }
}

/** No image changes the region and is undone by the next one, two animation frames or less later. */
export function noFlicker(region: string, label: string, options: Window = {}): Check {
  const name = `${label} does not flicker`
  return (evidence) => {
    const shots = pixelsIn(evidence, options)
    const flickers: number[] = []
    for (let i = 0; i < shots.length - 1; i++) {
      const here = shots[i]!
      const next = shots[i + 1]!
      if (next.number !== here.number + 1 || next.frame! - here.frame! > 2) continue
      const a = here.regions[region]
      const b = next.regions[region]
      if (a === undefined || b === undefined) continue
      if (a.changed > FLICKER_SHARE && b.changed > FLICKER_SHARE && b.changedSkip < Math.min(a.changed, b.changed) / 4) flickers.push(here.number)
    }
    if (flickers.length === 0) return pass(name, `${shots.length} frames compared`)
    return fail(name, `${flickers.length} frames changed and changed back in the next frame`, flickers.slice(0, 12))
  }
}

/** A precondition of the scenario: without it the other checks prove nothing. */
export function happened(label: string, test: (recording: Recording) => boolean): Check {
  const name = label
  return ({ recording }) => (test(recording) ? pass(name, 'yes') : fail(name, 'did not happen, so the other checks prove nothing', []))
}
