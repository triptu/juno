// The colour directions of round 3, as exact token values per theme, hue and
// role. `node metrics.mjs` measures them; `node render.mjs` screenshots the
// gallery's all-art sidebar with each one applied as CSS variables.
import { maxChroma, oklch } from './oklch.mjs'

export const HUES = { coral: 32, amber: 72, olive: 112, sage: 150, teal: 185, sky: 235, periwinkle: 275, plum: 320 }
export const ROLES = ['ink', 'soft', 'accent', 'accent2']

/** Real palettes vary lightness by hue: yellows sit high, blues and violets low. Shared by directions 2 to 5. */
export const LIFT = { coral: 0, amber: 0.05, olive: 0.04, sage: 0.02, teal: 0.01, sky: -0.02, periwinkle: -0.04, plum: -0.03 }

const flat = (L, C) => () => ({ L, C })
/** One chroma for every hue, as round 2 had, with lightness stepped by `LIFT` times `lift`. */
const lifted = (L, C, lift) => (hue) => ({ L: L + LIFT[hue] * lift, C })
/** Chroma as a share of what this hue reaches at this lightness, capped so blue-violets do not run away. */
const share = (L, p, cap, lift = 1) => (hue) => {
  const l = L + LIFT[hue] * lift
  return { L: l, C: Math.min(p * maxChroma(l, HUES[hue]), cap) }
}

// Each direction: per theme, per role, a function of the hue name giving { L, C }.
// `tile` adds a ground role; `hueOf` changes which hue a drawing gets.
export const directions = [
  {
    id: '0-now',
    name: 'Round 2',
    note: 'Round 2\'s tokens, in the hue the model picked: one lightness for every hue, ink chroma 0.022 and 0.028.',
    hueOf: 'recipe',
    light: { ink: flat(0.43, 0.022), soft: flat(0.885, 0.038), accent: flat(0.6, 0.1), accent2: flat(0.76, 0.06) },
    dark: { ink: flat(0.78, 0.028), soft: flat(0.36, 0.032), accent: flat(0.72, 0.085), accent2: flat(0.56, 0.05) },
  },
  {
    id: '1-chroma',
    name: 'More chroma',
    note: 'Same lightness. Ink, soft and accent carry about three, one and a half and one and a third times the chroma; dark gets more ink chroma than light, since a thin pale line needs it to read as a colour on near-black.',
    light: { ink: flat(0.43, 0.06), soft: flat(0.885, 0.06), accent: flat(0.6, 0.13), accent2: flat(0.76, 0.08) },
    dark: { ink: flat(0.78, 0.075), soft: flat(0.36, 0.055), accent: flat(0.72, 0.11), accent2: flat(0.56, 0.07) },
  },
  {
    id: '2-lightness',
    name: 'Per-hue lightness',
    note: 'Direction 1, with lightness lifted for amber and olive and lowered for periwinkle and plum, and chroma as a share of each hue\'s own maximum.',
    light: { ink: share(0.445, 0.6, 0.075, 0.5), soft: share(0.885, 0.4, 0.07, 0.5), accent: share(0.6, 0.75, 0.14), accent2: share(0.76, 0.5, 0.09, 0.5) },
    dark: { ink: share(0.775, 0.55, 0.085, 0.5), soft: share(0.37, 0.55, 0.06, 0.5), accent: share(0.73, 0.7, 0.115), accent2: share(0.56, 0.55, 0.08, 0.5) },
  },
  {
    id: '3-tile',
    name: 'Tinted ground',
    note: 'Direction 2 on a soft rounded square in the hue, radius 10 at 40px, the drawing at 80%. No tile below 20px.',
    light: { ink: share(0.445, 0.6, 0.075, 0.5), soft: share(0.86, 0.45, 0.075, 0.5), accent: share(0.6, 0.75, 0.14), accent2: share(0.76, 0.5, 0.09, 0.5), tile: share(0.935, 0.3, 0.035, 0.3) },
    dark: { ink: share(0.775, 0.55, 0.085, 0.5), soft: share(0.42, 0.55, 0.065, 0.5), accent: share(0.75, 0.7, 0.115), accent2: share(0.58, 0.55, 0.08, 0.5), tile: share(0.285, 0.45, 0.04, 0.3) },
  },
  {
    id: '4-two-tone',
    name: 'Two-tone',
    note: 'Direction 2 with the colour moved into the mass: the soft fill becomes a real mid-tone in the hue (dark L 0.50, light L 0.83) and the ink line takes the hue too. In dark the fills stop reading as holes.',
    light: { ink: share(0.445, 0.65, 0.08, 0.5), soft: share(0.83, 0.5, 0.085, 0.6), accent: share(0.58, 0.8, 0.14), accent2: share(0.72, 0.55, 0.1, 0.6) },
    dark: { ink: share(0.775, 0.5, 0.08, 0.5), soft: share(0.5, 0.6, 0.085, 0.6), accent: share(0.76, 0.65, 0.115, 0.5), accent2: share(0.64, 0.55, 0.09, 0.6) },
  },
  {
    id: '5-spread',
    name: 'Two-tone, hues spread',
    note: 'Direction 4 with the hue taken from the topic id, as the Tide pebble already does, instead of the model\'s mood guide. Shows what spreading hues buys on top of colour.',
    hueOf: 'topic',
    light: null,
    dark: null,
  },
]
directions[5].light = directions[4].light
directions[5].dark = directions[4].dark

// Round 3b, after the owner chose direction 5 but found it too bright: the
// spread hues stay, the colour goes back near round 2 with a small lift.
directions.push(
  {
    id: '6-v2-spread',
    name: 'Round 2, hues spread',
    note: 'Round 2\'s values exactly, in the topic\'s pebble hue.',
    light: directions[0].light,
    dark: directions[0].dark,
  },
  {
    id: '7a-calm',
    name: 'Calm a',
    note: 'A small lift over round 2: ink chroma 0.032 and 0.035, soft and accent a little above round 2, dark ink (0.79), accent (0.75) and fill (0.40) a little lighter. One lightness for every hue.',
    light: { ink: flat(0.43, 0.032), soft: flat(0.88, 0.045), accent: flat(0.6, 0.11), accent2: flat(0.76, 0.065) },
    dark: { ink: flat(0.79, 0.035), soft: flat(0.4, 0.04), accent: flat(0.75, 0.095), accent2: flat(0.6, 0.055) },
  },
  {
    id: '7b-calm-lift',
    name: 'Calm b',
    note: 'Calm a with half of round 3\'s per-hue lightness steps on soft and accent, a quarter on ink.',
    light: { ink: lifted(0.43, 0.032, 0.25), soft: lifted(0.88, 0.045, 0.5), accent: lifted(0.6, 0.11, 0.5), accent2: lifted(0.76, 0.065, 0.5) },
    dark: { ink: lifted(0.785, 0.035, 0.25), soft: lifted(0.4, 0.04, 0.5), accent: lifted(0.75, 0.095, 0.5), accent2: lifted(0.6, 0.055, 0.5) },
  },
  {
    id: '7c-calm-bright',
    privacy: true,
    name: 'Calm c',
    note: 'Calm b with a lighter dark fill (0.43) and accent (0.76), and a little more chroma on the light fill.',
    light: { ink: lifted(0.43, 0.035, 0.25), soft: lifted(0.875, 0.05, 0.5), accent: lifted(0.6, 0.115, 0.5), accent2: lifted(0.76, 0.07, 0.5) },
    dark: { ink: lifted(0.785, 0.035, 0.25), soft: lifted(0.43, 0.042, 0.5), accent: lifted(0.76, 0.1, 0.5), accent2: lifted(0.62, 0.06, 0.5) },
  },
)

export function values(direction, theme) {
  const out = {}
  const roles = direction[theme]
  for (const [hue, h] of Object.entries(HUES)) {
    for (const [role, f] of Object.entries(roles)) {
      const { L, C } = f(hue)
      out[`--art-${hue}-${role}`] = { L, C: Math.min(C, maxChroma(L, h)), h }
    }
  }
  return out
}

/** The CSS a render injects for one direction and theme. */
export function css(direction, theme) {
  const vars = values(direction, theme)
  const decls = Object.entries(vars).map(([name, { L, C, h }]) => `${name}:${oklch(L, C, h)}!important`).join(';')
  let out = `:root,html,body{${decls}}`
  if (direction[theme].tile) {
    out += Object.keys(HUES)
      .map((hue) => `[data-topic-art="art"]:has(g[stroke="var(--art-${hue}-ink)"]){background:var(--art-${hue}-tile);border-radius:10px}`)
      .join('')
    out += '[data-topic-art="art"]>span:last-child svg{transform:scale(0.8)}'
  }
  return out
}
