// The constrained SVG vocabulary shared by approaches B, C and D, with its
// parser, validator and renderer.
//
// An icon is a small list of elements on a 40 x 40 grid. Colours are role
// tokens (`ink`, `soft`, `accent`, `tile`, `none`), never values; the hue
// is named once on the root. The model's text is parsed into this shape,
// checked, and then rendered from the checked shape, so no byte of model
// output reaches the page unparsed.
//
//   IconSpec = { hue, accent?, elements: Element[] }
//   Element  = { tag, attrs }   tag in TAGS; attrs only from ATTRS[tag]
//
// `motif` is the kit element (motifs.mjs): { name, x, y, scale }.

import { HUE_NAMES, accentHueFor, roles } from './palette.mjs'
import { motifs } from './motifs.mjs'

export const MAX_ELEMENTS = 12
export const STROKE = 3

const COLOUR_TOKENS = new Set(['ink', 'soft', 'accent', 'tile', 'none'])
const SHARED = ['fill', 'stroke', 'stroke-width', 'opacity', 'transform', 'detail', 'stroke-dasharray']
export const ATTRS = {
  path: ['d', ...SHARED],
  circle: ['cx', 'cy', 'r', ...SHARED],
  ellipse: ['cx', 'cy', 'rx', 'ry', ...SHARED],
  rect: ['x', 'y', 'width', 'height', 'rx', ...SHARED],
  line: ['x1', 'y1', 'x2', 'y2', ...SHARED],
  polyline: ['points', ...SHARED],
  polygon: ['points', ...SHARED],
  motif: ['name', 'x', 'y', 'scale', ...SHARED],
}
export const TAGS = Object.keys(ATTRS)

const NUM = /^-?\d+(\.\d+)?$/
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9\s,.\-]+$/
const POINTS = /^[0-9\s,.\-]+$/
const TRANSFORM = /^(\s*(rotate|translate|scale)\(\s*-?\d+(\.\d+)?(\s*[ ,]\s*-?\d+(\.\d+)?){0,2}\s*\)\s*)+$/
const DASH = /^\d+(\.\d+)?(\s*[ ,]\s*\d+(\.\d+)?)*$/
const RANGE = 60

export class VocabError extends Error {}

// Parse model text into an IconSpec or throw VocabError with a reason the
// retry prompt can quote.
export function parse(text, { allowMotif = false } = {}) {
  const m = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/i.exec(text)
  if (!m) throw new VocabError('no <svg> element found')
  const rootAttrs = attrsOf(m[1])
  const hue = rootAttrs['data-hue']
  if (!HUE_NAMES.includes(hue)) throw new VocabError(`data-hue must be one of ${HUE_NAMES.join(', ')}; got ${JSON.stringify(hue ?? null)}`)
  const accent = rootAttrs['data-accent']
  if (accent !== undefined && !HUE_NAMES.includes(accent)) throw new VocabError(`data-accent must be one of ${HUE_NAMES.join(', ')}`)

  const body = m[2].replace(/<!--[\s\S]*?-->/g, '')
  const elements = []
  const tagRe = /<\s*\/?\s*([A-Za-z][\w:-]*)([^>]*?)\/?\s*>/g
  let t
  let seen = 0
  while ((t = tagRe.exec(body))) {
    const raw = t[0]
    if (raw.startsWith('</')) continue
    const tag = t[1].toLowerCase()
    seen += 1
    if (seen > MAX_ELEMENTS) throw new VocabError(`more than ${MAX_ELEMENTS} elements`)
    if (!TAGS.includes(tag) || (tag === 'motif' && !allowMotif)) throw new VocabError(`element <${tag}> is not allowed`)
    const attrs = validateAttrs(tag, attrsOf(t[2]))
    elements.push({ tag, attrs })
  }
  const stray = body.replace(tagRe, '').trim()
  if (stray) throw new VocabError(`text content is not allowed (${JSON.stringify(stray.slice(0, 20))})`)
  if (elements.length === 0) throw new VocabError('empty drawing')
  return { hue, accent, elements }
}

function attrsOf(s) {
  const out = {}
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let a
  while ((a = re.exec(s))) out[a[1].toLowerCase()] = (a[3] ?? a[4]).trim()
  return out
}

function validateAttrs(tag, attrs) {
  const allowed = ATTRS[tag]
  const out = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (!allowed.includes(k)) throw new VocabError(`attribute ${k} is not allowed on <${tag}>`)
    switch (k) {
      case 'fill':
      case 'stroke':
        if (!COLOUR_TOKENS.has(v)) throw new VocabError(`${k} must be one of ink, soft, accent, tile, none; got ${JSON.stringify(v)}`)
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
        if (!DASH.test(v)) throw new VocabError('stroke-dasharray must be numbers')
        break
      case 'name':
        if (!motifs[v]) throw new VocabError(`unknown motif ${JSON.stringify(v)}`)
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
    out['stroke-width'] = String(Math.min(4, Math.max(2, w)))
  }
  if (out.opacity !== undefined) out.opacity = String(Math.min(1, Math.max(0, Number(out.opacity))))
  return out
}

function checkNumbers(s) {
  for (const n of s.match(/-?\d+(\.\d+)?/g) ?? []) {
    if (Math.abs(Number(n)) > RANGE) throw new VocabError(`coordinate ${n} is off the 40 x 40 grid`)
  }
}

// Render a checked IconSpec for one theme and size. Below 20px, elements
// marked detail="1" and the secondary motif are dropped, and the stroke
// goes a little heavier so a line stays at least 1.4px.
export function render(spec, { theme = 'light', size = 40, id = 'ta', background = true } = {}) {
  const c = roles(spec.hue, theme, spec.accent ?? accentHueFor(spec.hue))
  const small = size < 20
  const strokeW = small ? STROKE * 1.2 : STROKE
  const parts = []
  for (const el of spec.elements) {
    if (small && el.attrs.detail) continue
    parts.push(renderElement(el, c, strokeW, small))
  }
  const bg = background ? `<rect width="40" height="40" rx="16" fill="${c.tile}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">` +
    `<clipPath id="${id}"><rect width="40" height="40" rx="16"/></clipPath>` +
    `<g clip-path="url(#${id})">${bg}` +
    `<g fill="none" stroke="${c.ink}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</g>` +
    `</g></svg>`
}

function renderElement(el, c, strokeW, small) {
  if (el.tag === 'motif') return renderMotif(el, c, strokeW, small)
  const a = []
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k === 'detail') continue
    if (k === 'fill' || k === 'stroke') a.push(`${k}="${c[v] ?? 'none'}"`)
    else if (k === 'stroke-width') a.push(`${k}="${(Number(v) * (small ? 1.2 : 1)).toFixed(2)}"`)
    else a.push(`${k}="${v}"`)
  }
  return `<${el.tag} ${a.join(' ')}/>`
}

function renderMotif(el, c, strokeW, small) {
  const def = motifs[el.attrs.name]
  const scale = Number(el.attrs.scale ?? 1)
  const x = Number(el.attrs.x ?? 0)
  const y = Number(el.attrs.y ?? 0)
  // A scaled-down motif keeps its line weight: scale the stroke inversely.
  const w = (strokeW / scale).toFixed(2)
  const inner = def.elements
    .filter((e) => !(small && e.attrs.detail))
    .map((e) => renderElement(e, c, strokeW, small))
    .join('')
  return `<g transform="translate(${x} ${y}) scale(${scale})" stroke-width="${w}">${inner}</g>`
}

// Serialise a checked spec back to the vocabulary (the canonical text form).
export function serialise(spec) {
  const els = spec.elements.map((e) => `  <${e.tag} ${Object.entries(e.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
  const acc = spec.accent ? ` data-accent="${spec.accent}"` : ''
  return `<svg viewBox="0 0 40 40" data-hue="${spec.hue}"${acc}>\n${els.join('\n')}\n</svg>`
}
