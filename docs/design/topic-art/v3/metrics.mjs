// Contrast of every art role against the sidebar, beside the row title and the unread count.
import { contrast, luminance, luminanceOfHex, maxChroma } from './oklch.mjs'
import { directions, HUES, values } from './directions.mjs'

const ground = { light: { sidebar: luminance(0.98, 0.006, 90), title: luminance(0.2, 0.01, 90), countFg: luminanceOfHex('#B3371B') }, dark: { sidebar: luminanceOfHex('#151411'), title: luminanceOfHex('#EEEBE2'), countFg: luminanceOfHex('#F8846D'), preview: luminanceOfHex('#C0BEB8') } }
// The light sidebar is hsla(48, 35%, 97%): measure it as hex.
ground.light.sidebar = luminanceOfHex('#FAF8F3')
ground.light.title = luminanceOfHex('#24221A')
ground.light.preview = luminanceOfHex('#4D4A42')

const lines = []
for (const theme of ['light', 'dark']) {
  const g = ground[theme]
  lines.push(`\n### ${theme}: title ${contrast(g.title, g.sidebar).toFixed(1)}:1, unread preview ${contrast(g.preview, g.sidebar).toFixed(1)}:1, unread count text ${contrast(g.countFg, g.sidebar).toFixed(1)}:1 on the sidebar\n`)
  lines.push('| Direction | Ink contrast (min to max) | Ink chroma | Accent contrast | Accent chroma | Soft chroma |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const d of directions) {
    const v = values(d, theme)
    const pick = (role, f) => Object.keys(HUES).map((hue) => f(v[`--art-${hue}-${role}`]))
    const con = (role) => pick(role, ({ L, C, h }) => contrast(luminance(L, C, h), g.sidebar))
    const range = (xs, n = 1) => `${Math.min(...xs).toFixed(n)} to ${Math.max(...xs).toFixed(n)}`
    lines.push(`| ${d.name} | ${range(con('ink'))} | ${range(pick('ink', (x) => x.C), 3)} | ${range(con('accent'))} | ${range(pick('accent', (x) => x.C), 3)} | ${range(pick('soft', (x) => x.C), 3)} |`)
  }
}
console.log(lines.join('\n'))
