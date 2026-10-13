// Colour for topic art. Eight hue anchors (the channel-mark anchors, so the
// two systems agree) and four roles per hue per theme. The model never sees
// a hex value: it names a hue and uses role tokens, and the renderer maps
// them for the theme at hand.
//
//   tile    the 40px tile background
//   soft    a filled area inside the drawing, same hue, between tile and ink
//   ink     the line colour
//   accent  one small highlight in a second hue (warm by default)

export const HUES = { coral: 32, amber: 72, olive: 112, sage: 150, teal: 185, sky: 235, periwinkle: 275, plum: 320 }
export const HUE_NAMES = Object.keys(HUES)

// [L, C] per role. Light: pale tile, deep ink. Dark: deep tile, pale ink.
const RAMP = {
  light: { tile: [0.905, 0.04], soft: [0.80, 0.075], ink: [0.42, 0.105], accent: [0.66, 0.15] },
  dark: { tile: [0.33, 0.05], soft: [0.45, 0.07], ink: [0.88, 0.07], accent: [0.76, 0.13] },
}

// The accent hue is warm unless the main hue is already warm.
export function accentHueFor(hue) {
  if (hue === 'coral') return 'amber'
  if (hue === 'amber') return 'coral'
  return 'coral'
}

export function roles(hue, theme, accentHue = accentHueFor(hue)) {
  const r = RAMP[theme]
  return {
    tile: oklch(r.tile[0], r.tile[1], HUES[hue]),
    soft: oklch(r.soft[0], r.soft[1], HUES[hue]),
    ink: oklch(r.ink[0], r.ink[1], HUES[hue]),
    accent: oklch(r.accent[0], r.accent[1], HUES[accentHue]),
  }
}

// Neutral tile for the fallback and for approach A, which brings its own colours.
export const NEUTRAL = {
  light: { tile: '#F1EEE4', ink: '#605E52' },
  dark: { tile: '#302F2C', ink: '#C6C4BE' },
}

function oklchToRgb(L, C, h) {
  const hr = (h * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005)
const toSrgb = (v) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055 }
const hex = (rgb) => '#' + rgb.map((v) => Math.round(toSrgb(v) * 255).toString(16).padStart(2, '0')).join('')

export function oklch(L, C, h) {
  let c = C, rgb = oklchToRgb(L, c, h)
  while (!inGamut(rgb) && c > 0) { c -= 0.005; rgb = oklchToRgb(L, c, h) }
  return hex(rgb)
}
