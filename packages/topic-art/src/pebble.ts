/**
 * The Tide pebble: the placeholder every topic shows until it has art,
 * ported from `docs/design/channel-marks/generator.js` (the random stream
 * and the wave bands) and `docs/design/topic-art/v2/tide.mjs` (the pebble
 * clip and the analogous hue step).
 *
 * The topic id is the only input, so the same topic draws the same pebble on
 * every client and at every size. Colours are the Tide tone variables of
 * `@juno/tokens`, tuned per theme. The bands are clipped to a smooth closed
 * curve through six or seven points around a circle with seeded jitter,
 * about 30px across at 40px, so the placeholder weighs the same as a line
 * drawing beside it and is a shape among shapes, not a box.
 */
import { HUE_NAMES, tideVar, type HueName } from './palette'
import type { ArtSize } from './render'
import { SMALL_BELOW } from './render'

/** FNV-1a, as `hueForId` in `@juno/ui` and the design study use. */
export function hashId(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

interface Rng {
  readonly next: () => number
  readonly range: (lo: number, hi: number) => number
  readonly int: (lo: number, hi: number) => number
  readonly pick: <A>(items: ReadonlyArray<A>) => A
  readonly chance: (p: number) => boolean
}

/** Mulberry32 over the seed: the channel-marks stream, kept so the pebbles match the design renders. */
function rng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
  }
}

const f = (n: number): string => String(Math.round(n * 100) / 100)

function wavePath(y: number, amp: number, phase: number, wavelength: number): string {
  let d = `M-10 ${f(y)}`
  const seg = wavelength / 2
  for (let x = -10; x < 50; x += wavelength) {
    const up = Math.sin(phase) >= 0 ? -amp : amp
    d += ` q ${f(seg / 2)} ${f(up * 2)} ${f(seg)} 0 q ${f(seg / 2)} ${f(-up * 2)} ${f(seg)} 0`
  }
  return `${d} L50 60 L-10 60 Z`
}

/** A closed Catmull-Rom curve through six or seven jittered points around a circle. Never leaves the 40 box. */
function pebblePath(r: Rng): string {
  const n = r.pick([6, 6, 7])
  const rot = r.range(0, Math.PI * 2)
  const pts: Array<readonly [number, number]> = []
  for (let k = 0; k < n; k++) {
    const angle = rot + (k / n) * Math.PI * 2 + r.range(-0.12, 0.12)
    const radius = r.range(13.5, 16.5)
    pts.push([20 + Math.cos(angle) * radius, 20 + Math.sin(angle) * radius])
  }
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`
  for (let k = 0; k < n; k++) {
    const p0 = pts[(k - 1 + n) % n]!
    const p1 = pts[k]!
    const p2 = pts[(k + 1) % n]!
    const p3 = pts[(k + 2) % n]!
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${f(c1[0]!)} ${f(c1[1]!)} ${f(c2[0]!)} ${f(c2[1]!)} ${f(p2[0])} ${f(p2[1])}`
  }
  return `${d} Z`
}

/**
 * The hue a topic is drawn in: the pebble's main hue, the first draw of its
 * seeded stream. The art takes it too, in place of the hue the model named,
 * so neighbouring topics spread over all eight hues and the art keeps the
 * colour of the pebble it replaces (docs/design/topic-art/v3).
 */
export function pebbleHue(topicId: string): HueName {
  return HUE_NAMES[rng(hashId(topicId)).int(0, HUE_NAMES.length - 1)]!
}

/** One wave band of a pebble: path data on the 40 grid and its fill. */
export interface PebbleBand {
  readonly d: string
  readonly fill: string
}

/**
 * A pebble as parts, for a renderer that draws it in its own markup (the
 * sign-in page's large pebbles). `renderPebble` draws the same parts.
 * Bands are listed top to bottom; they sit in a group rotated by `tilt`
 * degrees about the centre and clipped to `clip`.
 */
export interface PebbleShape {
  readonly clipId: string
  readonly clip: string
  readonly base: string
  readonly tilt: number
  readonly bands: ReadonlyArray<PebbleBand>
  /** The small highlight dot, on about two pebbles in five. */
  readonly dot?: { readonly cx: number; readonly cy: number; readonly r: number; readonly fill: string }
  /** Three-band pebbles draw their first band only at 20px and up. */
  readonly firstBandIsDetail: boolean
}

/**
 * The parts of the pebble seeded by `seed`, in the order the random stream
 * draws them, so a renderer of the parts and `renderPebble` agree.
 */
export function pebbleShape(seed: string): PebbleShape {
  const hash = hashId(seed)
  const r = rng(hash)
  const i = r.int(0, HUE_NAMES.length - 1)
  const main = HUE_NAMES[i]!
  const partner = HUE_NAMES[(i + r.pick([1, 7])) % HUE_NAMES.length]!
  const tilt = r.pick([0, 0, -18, 18])
  const amp = r.range(1.5, 4)
  const wavelength = r.pick([20, 26, 32, 40])
  const two = r.chance(0.4)
  const layers = two
    ? [
        { y: r.range(16, 22), fill: tideVar(main, 'mid') },
        { y: r.range(28, 34), fill: tideVar(partner, 'mid') },
      ]
    : [
        { y: r.range(11, 16), fill: tideVar(partner, 'soft') },
        { y: r.range(22, 27), fill: tideVar(main, 'mid') },
        { y: r.range(31, 35), fill: tideVar(main, 'deep') },
      ]
  const clip = pebblePath(r)
  // The dot reads as a highlight in light and a shadow in dark; the token carries that difference.
  const dot = r.chance(0.4) ? { cx: r.pick([13, 27]), cy: 12, r: 3.2, fill: tideVar(main, 'pale') } : undefined
  return {
    clipId: `ta${hash.toString(36)}`,
    clip,
    base: tideVar(main, 'base'),
    tilt,
    bands: layers.map((layer, k) => ({ d: wavePath(layer.y, amp, k * Math.PI, wavelength), fill: layer.fill })),
    ...(dot === undefined ? {} : { dot }),
    firstBandIsDetail: !two,
  }
}

/**
 * The placeholder for a topic as inline SVG. The clip path's id is derived
 * from the topic id, so two pebbles of one topic on the same page share one
 * identical definition and two topics never collide.
 */
export function renderPebble(topicId: string, size: ArtSize): string {
  const shape = pebbleShape(topicId)
  const small = size < SMALL_BELOW
  let inner = `<rect width="40" height="40" fill="${shape.base}"/>`
  inner += `<g transform="rotate(${shape.tilt} 20 20)">`
  shape.bands.forEach((band, k) => {
    if (small && shape.firstBandIsDetail && k === 0) return
    inner += `<path d="${band.d}" fill="${band.fill}"/>`
  })
  inner += '</g>'
  if (!small && shape.dot !== undefined) inner += `<circle cx="${shape.dot.cx}" cy="${shape.dot.cy}" r="${shape.dot.r}" fill="${shape.dot.fill}"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<defs><clipPath id="${shape.clipId}"><path d="${shape.clip}"/></clipPath></defs>` +
    `<g clip-path="url(#${shape.clipId})">${inner}</g></svg>`
  )
}
