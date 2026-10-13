// Approach A: the model draws any SVG. This is the minimum needed to show
// its output on a page safely. It is a strip, not a parse: good enough for
// a study, and the README says why the app would not ship it.

const BAD_TAGS = /<\s*\/?\s*(script|foreignObject|iframe|object|embed|image|use|a|style|animate\w*|set|link|meta)\b[^>]*>/gi

export function sanitiseFree(text) {
  const m = /<svg\b[\s\S]*?<\/svg>/i.exec(text)
  if (!m) return { ok: false, reason: 'no <svg> element found' }
  let svg = m[0]
  svg = svg.replace(BAD_TAGS, '')
  svg = svg.replace(/\s(on\w+|xlink:href|href)\s*=\s*("[^"]*"|'[^']*')/gi, '')
  svg = svg.replace(/url\((?!#)[^)]*\)/gi, 'none')
  if (/<text\b/i.test(svg)) return { ok: false, reason: 'contains text' }
  if (!/viewBox/i.test(svg)) svg = svg.replace(/<svg\b/i, '<svg viewBox="0 0 40 40"')
  svg = svg.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')
  svg = svg.replace(/<svg\b/i, '<svg width="40" height="40" aria-hidden="true"')
  const count = (svg.match(/<(path|circle|rect|line|ellipse|polyline|polygon|g)\b/gi) ?? []).length
  return { ok: true, svg, elements: count, gradients: /gradient/i.test(svg) }
}
