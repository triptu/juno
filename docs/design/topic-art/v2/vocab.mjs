// The round 2 vocabulary: three freedom levels, one validator, one renderer.
//
// An icon is a small list of elements on a 40 x 40 grid. Colours are role
// tokens, never values; the hue is named once on the root. The model's text
// is parsed into this shape, checked against the level's rules, and the SVG
// is rebuilt from the checked shape. No byte of model output reaches a page.
//
//   IconSpec = { hue, elements: Element[] }
//   Element  = { tag, attrs, children? }   (children only inside <g>)
//
// Levels (see vocabulary.md for the plain-English version):
//   strict   round 1's rules with the new tokens: seven shapes, 12 elements,
//            one accent, no groups.
//   relaxed  adds <g> (one level deep), 20 elements, a second accent token,
//            dashes, thinner strokes and translucent layers.
//   art      the model composes freely; the validator keeps only safety
//            (whitelisted tags and attributes, numbers on the grid, tokens
//            for colour), the palette tokens and the size (40 elements).

import { HUE_NAMES, roles, SURFACES } from './palette.mjs'

export const LEVELS = {
  strict: { maxElements: 12, maxDepth: 0, accents: 1, tokens: ['ink', 'soft', 'accent', 'none'], strokeMin: 2, strokeMax: 4, dash: false, label: 'a · strict' },
  relaxed: { maxElements: 20, maxDepth: 1, accents: 2, tokens: ['ink', 'soft', 'accent', 'accent2', 'none'], strokeMin: 1.5, strokeMax: 4, dash: true, label: 'b · relaxed' },
  art: { maxElements: 40, maxDepth: 2, accents: Infinity, tokens: ['ink', 'soft', 'accent', 'accent2', 'none'], strokeMin: 1, strokeMax: 5, dash: true, label: 'c · art-directed' },
}
export const LEVEL_NAMES = Object.keys(LEVELS)

export const STROKE = 2.75
const INSET_SCALE = 0.8
const INSET = (40 * (1 - INSET_SCALE)) / 2
const SMALL_STROKE_SCALE = 1.3

const SHARED = ['fill', 'stroke', 'stroke-width', 'opacity', 'transform', 'detail', 'stroke-dasharray', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin']
export const ATTRS = {
  path: ['d', ...SHARED],
  circle: ['cx', 'cy', 'r', ...SHARED],
  ellipse: ['cx', 'cy', 'rx', 'ry', ...SHARED],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...SHARED],
  line: ['x1', 'y1', 'x2', 'y2', ...SHARED],
  polyline: ['points', ...SHARED],
  polygon: ['points', ...SHARED],
  g: ['fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
}
export const TAGS = Object.keys(ATTRS)

const NUM = /^-?\d+(\.\d+)?$/
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9\s,.\-]+$/
const POINTS = /^[0-9\s,.\-]+$/
const TRANSFORM = /^(\s*(rotate|translate|scale)\(\s*-?\d+(\.\d+)?(\s*[ ,]\s*-?\d+(\.\d+)?){0,2}\s*\)\s*)+$/
const DASH = /^\d+(\.\d+)?(\s*[ ,]\s*\d+(\.\d+)?)*$/
const RANGE = 60

export class VocabError extends Error {}

// Parse model text into an IconSpec for the level, or throw VocabError with
// a reason the retry prompt can quote.
export function parse(text, level = 'strict') {
  const L = LEVELS[level]
  if (!L) throw new Error(`unknown level ${level}`)
  const m = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/i.exec(text)
  if (!m) throw new VocabError('no <svg> element found')
  const rootAttrs = attrsOf(m[1])
  const hue = rootAttrs['data-hue']
  if (!HUE_NAMES.includes(hue)) throw new VocabError(`data-hue must be one of ${HUE_NAMES.join(', ')}; got ${JSON.stringify(hue ?? null)}`)

  const confRaw = rootAttrs['data-confident']
  if (confRaw !== undefined && confRaw !== 'true' && confRaw !== 'false') throw new VocabError('data-confident must be true or false')
  const confident = confRaw !== 'false'

  const body = m[2].replace(/<!--[\s\S]*?-->/g, '')
  const tagRe = /<\s*(\/?)\s*([A-Za-z][\w:-]*)([^>]*?)(\/?)\s*>/g
  const root = { children: [] }
  const stack = [root]
  const counters = { elements: 0, accents: 0 }
  let t
  while ((t = tagRe.exec(body))) {
    const closing = t[1] === '/'
    const tag = t[2].toLowerCase()
    const selfClosing = t[4] === '/'
    if (closing) {
      if (tag !== 'g') continue
      if (stack.length === 1) throw new VocabError('stray </g>')
      stack.pop()
      continue
    }
    if (!TAGS.includes(tag)) throw new VocabError(`element <${tag}> is not allowed`)
    if (tag === 'g' && stack.length - 1 >= L.maxDepth) throw new VocabError(L.maxDepth === 0 ? 'element <g> is not allowed' : `groups nest deeper than ${L.maxDepth}`)
    counters.elements += tag === 'g' ? 0 : 1
    if (counters.elements > L.maxElements) throw new VocabError(`more than ${L.maxElements} elements`)
    const attrs = validateAttrs(tag, attrsOf(t[3]), L)
    if (attrs.fill?.startsWith('accent') || attrs.stroke?.startsWith('accent')) {
      counters.accents += 1
      if (counters.accents > L.accents) throw new VocabError(L.accents === 1 ? 'only one element may use accent' : `more than ${L.accents} accent elements`)
    }
    const el = { tag, attrs }
    stack[stack.length - 1].children.push(el)
    if (tag === 'g') {
      el.children = []
      if (!selfClosing) stack.push(el)
    }
  }
  if (stack.length > 1) throw new VocabError('unclosed <g>')
  const stray = body.replace(tagRe, '').trim()
  if (stray) throw new VocabError(`text content is not allowed (${JSON.stringify(stray.slice(0, 20))})`)
  if (counters.elements === 0) throw new VocabError('empty drawing')
  return { hue, confident, elements: root.children }
}

function attrsOf(s) {
  const out = {}
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let a
  while ((a = re.exec(s))) out[a[1].toLowerCase()] = (a[3] ?? a[4]).trim()
  return out
}

function validateAttrs(tag, attrs, L) {
  const allowed = ATTRS[tag]
  const out = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (!allowed.includes(k)) throw new VocabError(`attribute ${k} is not allowed on <${tag}>`)
    switch (k) {
      case 'fill':
      case 'stroke':
        if (!L.tokens.includes(v)) throw new VocabError(`${k} must be one of ${L.tokens.join(', ')}; got ${JSON.stringify(v)}`)
        break
      case 'd':
        if (!PATH_D.test(v)) throw new VocabError('path d has characters outside the path grammar')
        checkNumbers(v)
        break
      case 'points':
        if (!POINTS.test(v)) throw new VocabError('points must be numbers')
        checkNumbers(v)
        break
      case 'transform':
        if (!TRANSFORM.test(v)) throw new VocabError('transform may only be rotate(), translate() or scale()')
        checkNumbers(v)
        break
      case 'stroke-dasharray':
        if (!L.dash) throw new VocabError('stroke-dasharray is not allowed at this level')
        if (!DASH.test(v)) throw new VocabError('stroke-dasharray must be numbers')
        break
      case 'stroke-linecap':
        if (!['round', 'butt'].includes(v)) throw new VocabError('stroke-linecap must be round or butt')
        break
      case 'stroke-linejoin':
        if (!['round', 'bevel', 'miter'].includes(v)) throw new VocabError('stroke-linejoin must be round, bevel or miter')
        break
      case 'detail':
        break
      default:
        if (!NUM.test(v)) throw new VocabError(`${k} must be a number; got ${JSON.stringify(v)}`)
        if (Math.abs(Number(v)) > RANGE) throw new VocabError(`${k}=${v} is off the 40 x 40 grid`)
    }
    out[k] = v
  }
  if (out['stroke-width'] !== undefined) {
    const w = Number(out['stroke-width'])
    if (w < L.strokeMin || w > L.strokeMax) throw new VocabError(`stroke-width must be between ${L.strokeMin} and ${L.strokeMax}`)
  }
  for (const k of ['opacity', 'fill-opacity', 'stroke-opacity']) {
    if (out[k] !== undefined) out[k] = String(Math.min(1, Math.max(0, Number(out[k]))))
  }
  return out
}

function checkNumbers(s) {
  for (const n of s.match(/-?\d+(\.\d+)?/g) ?? []) {
    if (Math.abs(Number(n)) > RANGE) throw new VocabError(`coordinate ${n} is off the 40 x 40 grid`)
  }
}

// Containers the art can sit in. The drawing is the same in all three; only
// what is painted behind it changes, so switching is free.
export const CONTAINERS = {
  none: { radius: 0, label: 'no container' },
  subtle: { radius: 10, label: 'subtle' },
  tile: { radius: 16, label: 'round 1 tile' },
}

// Render a checked IconSpec for one theme, size and container. Below 20px,
// elements marked detail="1" are dropped and the stroke goes heavier so a
// line stays at least 1.4px.
export function render(spec, { theme = 'light', size = 40, id = 'ta', container = 'none' } = {}) {
  const c = roles(spec.hue, theme)
  const small = size < 20
  const strokeW = small ? STROKE * SMALL_STROKE_SCALE : STROKE
  const body = spec.elements.map((el) => renderElement(el, c, small)).join('')
  // The drawing is composed to fill the 40 box with no container. Inside a
  // container it is scaled to 80% so it does not touch the edge. Below 20px
  // the container is dropped: a box around a 16px glyph in a tab is noise.
  const boxed = container !== 'none' && !small
  const bg = boxed ? containerRect(container, c, theme, id) : ''
  const inset = boxed ? ` transform="translate(${INSET} ${INSET}) scale(${INSET_SCALE})"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">` +
    bg +
    `<g${inset} fill="none" stroke="${c.ink}" stroke-width="${(boxed ? strokeW / INSET_SCALE : strokeW).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${body}</g>` +
    `</svg>`
}

export function containerRect(container, c, theme, id) {
  if (container === 'none') return ''
  const k = CONTAINERS[container]
  if (container === 'subtle') {
    return `<rect width="40" height="40" rx="${k.radius}" fill="${c.subtle}"/>` +
      `<rect x="0.5" y="0.5" width="39" height="39" rx="${k.radius - 0.5}" fill="none" stroke="${SURFACES[theme].edge}"/>`
  }
  return `<rect width="40" height="40" rx="${k.radius}" fill="${c.tile}"/>`
}

function renderElement(el, c, small) {
  if (small && el.attrs.detail) return ''
  const a = []
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k === 'detail') continue
    if (k === 'fill' || k === 'stroke') a.push(`${k}="${c[v] ?? 'none'}"`)
    else if (k === 'stroke-width') a.push(`${k}="${(Number(v) * (small ? SMALL_STROKE_SCALE : 1)).toFixed(2)}"`)
    else a.push(`${k}="${v}"`)
  }
  if (el.tag === 'g') {
    const inner = (el.children ?? []).map((ch) => renderElement(ch, c, small)).join('')
    return `<g ${a.join(' ')}>${inner}</g>`
  }
  return `<${el.tag} ${a.join(' ')}/>`
}

// Serialise a checked spec back to the vocabulary (the canonical text form).
export function serialise(spec) {
  const one = (e, depth) => {
    const pad = '  '.repeat(depth + 1)
    const attrs = Object.entries(e.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')
    if (e.tag === 'g') return `${pad}<g ${attrs}>\n${(e.children ?? []).map((ch) => one(ch, depth + 1)).join('\n')}\n${pad}</g>`
    return `${pad}<${e.tag} ${attrs}/>`
  }
  const conf = spec.confident === false ? ' data-confident="false"' : ''
  return `<svg viewBox="0 0 40 40" data-hue="${spec.hue}"${conf}>\n${spec.elements.map((e) => one(e, 0)).join('\n')}\n</svg>`
}

export function countElements(spec) {
  const walk = (els) => els.reduce((n, e) => n + (e.tag === 'g' ? walk(e.children ?? []) : 1), 0)
  return walk(spec.elements)
}
