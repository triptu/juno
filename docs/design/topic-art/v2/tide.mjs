// The placeholder: the Tide family from docs/design/channel-marks, seeded
// per topic id and retuned to the round 2 palette. Shown while art is
// generating, when the model is not confident, and when AI assist is off.
// Same for a thread topic and a channel Main: everything is a topic.
//
// The random stream, wave path and composition are the channel-marks ones;
// what changed is the palette (TIDE_RAMP in palette.mjs), the hue step
// (always analogous, so a list of placeholders stays calm) and the frame.
// With no container (the owner's decision) the bands are clipped to a
// free-form shape picked per topic, not a box: a soft pebble about 32px
// across, so it weighs the same as a line drawing beside it. Inside a
// container the frame is the container's box, as before.

import { HUES, HUE_NAMES, tideTones, SURFACES } from './palette.mjs'
import { CONTAINERS } from './vocab.mjs'

function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, range: (lo, hi) => lo + (hi - lo) * next(), int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p }
}
const f = (n) => Math.round(n * 100) / 100

function wavePath(y, amp, phase, wavelength) {
  let d = `M-10 ${f(y)}`
  const seg = wavelength / 2
  for (let x = -10; x < 50; x += wavelength) {
    const up = Math.sin(phase) >= 0 ? -amp : amp
    d += ` q ${f(seg / 2)} ${f(up * 2)} ${f(seg)} 0 q ${f(seg / 2)} ${f(-up * 2)} ${f(seg)} 0`
  }
  d += ' L50 60 L-10 60 Z'
  return d
}

// A closed smooth shape through six to seven points around a circle with
// seeded radius jitter, as cubic beziers (Catmull-Rom). The shape stays
// convex enough to read as one pebble and never leaves the 40 box.
function pebblePath(r) {
  const n = r.pick([6, 6, 7])
  const rot = r.range(0, Math.PI * 2)
  const pts = []
  for (let k = 0; k < n; k++) {
    const ang = rot + (k / n) * Math.PI * 2 + r.range(-0.12, 0.12)
    const rad = r.range(13.5, 16.5)
    pts.push([20 + Math.cos(ang) * rad, 20 + Math.sin(ang) * rad])
  }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let k = 0; k < n; k++) {
    const p0 = pts[(k - 1 + n) % n], p1 = pts[k], p2 = pts[(k + 1) % n], p3 = pts[(k + 2) % n]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`
  }
  return d + ' Z'
}

// `topicId` is the only input the drawing depends on. For the study it is
// the topic's id in topics.mjs; in the app it is the topic id (thread ts
// or channel id), so every client of one workspace draws the same thing.
export function tide(topicId, { theme = 'light', size = 40, container = 'none', id } = {}) {
  const h = hash(String(topicId))
  const r = rng(h)
  const i = r.int(0, HUE_NAMES.length - 1)
  const main = HUES[HUE_NAMES[i]]
  const partner = HUES[HUE_NAMES[(i + r.pick([1, 7])) % HUE_NAMES.length]]
  const a = tideTones(main, theme)
  const b = tideTones(partner, theme)
  const small = size < 20
  const tilt = r.pick([0, 0, -18, 18])
  const amp = r.range(1.5, 4)
  const wavelength = r.pick([20, 26, 32, 40])
  const two = r.chance(0.4)
  const layers = two
    ? [{ y: r.range(16, 22), fill: a.mid }, { y: r.range(28, 34), fill: b.mid }]
    : [{ y: r.range(11, 16), fill: b.soft }, { y: r.range(22, 27), fill: a.mid }, { y: r.range(31, 35), fill: a.deep }]
  const uid = id ?? `t${h.toString(36)}${theme[0]}${small ? 's' : ''}`
  // No container: a free-form pebble per topic, at every size, so the
  // placeholder is a shape among shapes and not a box among drawings.
  // In a container: the container's box, so placeholder and art share it.
  const bare = container === 'none'
  const radius = bare ? 0 : CONTAINERS[container].radius
  const clip = bare ? `<path d="${pebblePath(r)}"/>` : `<rect width="40" height="40" rx="${radius}"/>`
  let inner = `<rect width="40" height="40" fill="${a.base}"/>`
  inner += `<g transform="rotate(${tilt} 20 20)">`
  layers.forEach((l, k) => {
    if (small && !two && k === 0) return
    inner += `<path d="${wavePath(l.y, amp, k * Math.PI, wavelength)}" fill="${l.fill}"/>`
  })
  inner += '</g>'
  if (!small && r.chance(0.4)) inner += `<circle cx="${r.pick([13, 27])}" cy="${bare ? 12 : 8}" r="${bare ? 3.2 : 4}" fill="${theme === 'dark' ? a.deep : a.pale}"/>`
  const edge = container === 'subtle' ? `<rect x="0.5" y="0.5" width="39" height="39" rx="${radius - 0.5}" fill="none" stroke="${SURFACES[theme].edge}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">` +
    `<defs><clipPath id="${uid}c">${clip}</clipPath></defs>` +
    `<g clip-path="url(#${uid}c)">${inner}</g>${edge}</svg>`
}
