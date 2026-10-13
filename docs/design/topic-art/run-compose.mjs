// Approach C's deterministic composition: one main motif, an optional small
// secondary at the bottom-right corner behind a tile-coloured knock-out.
export function compose({ main, secondary, hue }) {
  const elements = []
  if (secondary) {
    elements.push({ tag: 'motif', attrs: { name: main, x: '-2', y: '-2', scale: '0.9' } })
    elements.push({ tag: 'circle', attrs: { cx: '30', cy: '30', r: '9.5', fill: 'tile', stroke: 'none', detail: '1' } })
    elements.push({ tag: 'motif', attrs: { name: secondary, x: '21', y: '21', scale: '0.45', detail: '1' } })
  } else {
    elements.push({ tag: 'motif', attrs: { name: main, x: '0', y: '0', scale: '1' } })
  }
  return { hue, elements }
}
