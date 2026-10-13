// Round 2 colour. The owner asked for noticeably more muted colour that sits
// with the warm paper and the warm near-black, tuned per theme.
//
// The idea: one hue per icon, used sparingly. Lines are a warm near-neutral
// with a trace of the hue; one flat area ("soft") carries the hue at low
// chroma; one small highlight ("accent") carries it at moderate chroma.
// Everything is OKLCH so light and dark are tuned separately in L and C and
// the hue angle is the only shared value.
//
// Roles the drawing may name (the model never sees a hex):
//   ink      line colour
//   soft     one flat area inside the drawing
//   accent   one small highlight in the icon's hue
//   accent2  a second, quieter highlight (relaxed and art-directed only)
// Roles the renderer uses for containers:
//   subtle   near-invisible fill for the subtle container
//   tile     round 1's pastel tile, kept for the comparison

export const HUES = { coral: 32, amber: 72, olive: 112, sage: 150, teal: 185, sky: 235, periwinkle: 275, plum: 320 }
export const HUE_NAMES = Object.keys(HUES)

// [L, C] per role per theme. The ink hue is the icon's own hue at very low
// chroma, so a sage icon's lines are a hair greener than a plum icon's, and
// a list still reads as one grey-brown line family.
export const RAMP = {
  light: {
    ink: [0.43, 0.022],
    soft: [0.885, 0.038],
    accent: [0.60, 0.10],
    accent2: [0.76, 0.06],
    subtle: [0.952, 0.008],
    tile: [0.905, 0.04],
  },
  dark: {
    ink: [0.78, 0.028],
    soft: [0.36, 0.032],
    accent: [0.72, 0.085],
    accent2: [0.56, 0.05],
    subtle: [0.235, 0.008],
    tile: [0.33, 0.05],
  },
}

export function roles(hue, theme) {
  const r = RAMP[theme]
  const h = HUES[hue]
  const out = {}
  for (const k of Object.keys(r)) out[k] = oklch(r[k][0], r[k][1], h)
  out.none = 'none'
  return out
}

// Surfaces the art sits on, from tokens.md 1.1 and 1.2.
export const SURFACES = {
  light: { sidebar: '#FAF9F5', page: '#FCFBF7', selected: '#F1EEE4', hover: '#F4F2EB', edge: 'rgba(0,0,0,0.06)' },
  dark: { sidebar: '#151411', page: '#1B1916', selected: '#302F2C', hover: '#2D2B28', edge: 'rgba(255,255,255,0.07)' },
}

// Tide tones for the placeholder, muted to sit under the art. Lower chroma
// and a narrower lightness span than channel-marks' RAMP, so a placeholder
// is quieter than any finished drawing next to it.
export const TIDE_RAMP = {
  light: { base: [0.925, 0.018], soft: [0.885, 0.026], mid: [0.835, 0.034], deep: [0.77, 0.04], pale: [0.955, 0.012] },
  // Dark sits closer to neutral: at low lightness, amber, olive and coral
  // turn to mud at any real chroma, so chroma stays near 0.02 and the bands
  // step in lightness instead.
  dark: { base: [0.285, 0.012], soft: [0.325, 0.017], mid: [0.37, 0.022], deep: [0.435, 0.026], pale: [0.255, 0.008] },
}
export function tideTones(hueAngle, theme) {
  const r = TIDE_RAMP[theme]
  const t = {}
  for (const k of Object.keys(r)) t[k] = oklch(r[k][0], r[k][1], hueAngle)
  return t
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

// WCAG contrast between two hex colours, for the palette table.
export function contrast(a, b) {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
