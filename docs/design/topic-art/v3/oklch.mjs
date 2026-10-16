// OKLCH to sRGB, the sRGB gamut edge and WCAG contrast, with no dependencies.
// Formulas from Björn Ottosson's OKLab reference and WCAG 2.2.

export function oklchToLinear(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** The most chroma sRGB holds at this lightness and hue. */
export function maxChroma(L, h) {
  let lo = 0
  let hi = 0.4
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(oklchToLinear(L, mid, h))) lo = mid
    else hi = mid
  }
  return lo
}

const encode = (v) => {
  const c = Math.min(1, Math.max(0, v))
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

export function toHex(L, C, h) {
  const rgb = oklchToLinear(L, Math.min(C, maxChroma(L, h)), h).map(encode)
  return '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
}

function luminanceOfLinear(rgb) {
  const [r, g, b] = rgb.map((v) => Math.min(1, Math.max(0, v)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function luminanceOfHex(hex) {
  const n = hex.replace('#', '')
  const lin = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return luminanceOfLinear(lin)
}

export const luminance = (L, C, h) => luminanceOfLinear(oklchToLinear(L, Math.min(C, maxChroma(L, h)), h))

export function contrast(y1, y2) {
  const [hi, lo] = y1 > y2 ? [y1, y2] : [y2, y1]
  return (hi + 0.05) / (lo + 0.05)
}

export const oklch = (L, C, h) => `oklch(${+L.toFixed(3)} ${+C.toFixed(3)} ${h})`
