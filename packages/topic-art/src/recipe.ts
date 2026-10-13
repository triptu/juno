/**
 * The recipe: what the model sends, parsed against a whitelist.
 *
 * An icon is a short list of shapes on a 40 by 40 grid. Colours are role
 * tokens, never values; the hue is named once on the root. `parseRecipe`
 * walks the model's text tag by tag and fails the whole drawing on anything
 * outside the vocabulary (`docs/design/topic-art/v2/vocabulary.md`). The
 * typed `Recipe` is all that survives: `renderArt` rebuilds the SVG from it
 * and `serialiseRecipe` gives the canonical text that is stored, so no byte
 * of model output reaches a page.
 *
 * The rules are the art-directed level of the design study: safety (tags,
 * attributes, numbers on the grid, role tokens), the size limit, and a nest
 * depth for groups. Composition is the prompt's business.
 */
import { HUE_NAMES, isHueName, ROLES, type HueName } from './palette'

export interface RecipeElement {
  readonly tag: ElementTag
  /** Checked attributes, in the order the model wrote them. Values are verbatim but matched a grammar. */
  readonly attrs: ReadonlyArray<readonly [name: string, value: string]>
  /** Only on `g`. */
  readonly children?: ReadonlyArray<RecipeElement>
}

export interface Recipe {
  readonly hue: HueName
  /** False when the model said the topic gave it nothing to draw. The app then keeps the placeholder. */
  readonly confident: boolean
  readonly elements: ReadonlyArray<RecipeElement>
}

export type ParseResult = { readonly ok: true; readonly recipe: Recipe } | { readonly ok: false; readonly reason: string }

export const MAX_ELEMENTS = 40
export const MAX_GROUP_DEPTH = 2
export const STROKE_MIN = 1
export const STROKE_MAX = 5
/** Numbers outside this are off the grid. A shape may bleed a little for a rounded end. */
const RANGE = 60

const SHARED = [
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'transform',
  'detail',
  'stroke-dasharray',
  'fill-opacity',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
] as const

export const ATTRS = {
  path: ['d', ...SHARED],
  circle: ['cx', 'cy', 'r', ...SHARED],
  ellipse: ['cx', 'cy', 'rx', 'ry', ...SHARED],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...SHARED],
  line: ['x1', 'y1', 'x2', 'y2', ...SHARED],
  polyline: ['points', ...SHARED],
  polygon: ['points', ...SHARED],
  g: ['fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
} as const satisfies Record<string, ReadonlyArray<string>>

export type ElementTag = keyof typeof ATTRS
export const TAGS = Object.keys(ATTRS) as ReadonlyArray<ElementTag>
const isTag = (value: string): value is ElementTag => Object.hasOwn(ATTRS, value)

const NUM = /^-?\d+(\.\d+)?$/
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9\s,.-]+$/
const POINTS = /^[0-9\s,.-]+$/
const TRANSFORM = /^(\s*(rotate|translate|scale)\(\s*-?\d+(\.\d+)?(\s*[ ,]\s*-?\d+(\.\d+)?){0,2}\s*\)\s*)+$/
const DASH = /^\d+(\.\d+)?(\s*[ ,]\s*\d+(\.\d+)?)*$/
const LINECAP = new Set(['round', 'butt'])
const LINEJOIN = new Set(['round', 'bevel', 'miter'])

class RecipeError extends Error {}

/** `name="value"` or `name='value'` pairs. Unquoted attributes are not part of the vocabulary and are dropped. */
function attrsOf(source: string): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = []
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) out.push([match[1]!.toLowerCase(), (match[3] ?? match[4] ?? '').trim()])
  return out
}

function checkNumbers(value: string): void {
  for (const n of value.match(/-?\d+(\.\d+)?/g) ?? []) {
    if (Math.abs(Number(n)) > RANGE) throw new RecipeError(`coordinate ${n} is off the 40 x 40 grid`)
  }
}

function checkAttr(tag: ElementTag, name: string, value: string): string {
  const allowed: ReadonlyArray<string> = ATTRS[tag]
  if (!allowed.includes(name)) throw new RecipeError(`attribute ${name} is not allowed on <${tag}>`)
  switch (name) {
    case 'fill':
    case 'stroke':
      if (!(ROLES as ReadonlyArray<string>).includes(value)) throw new RecipeError(`${name} must be one of ${ROLES.join(', ')}; got ${JSON.stringify(value)}`)
      return value
    case 'd':
      if (!PATH_D.test(value)) throw new RecipeError('path d has characters outside the path grammar')
      checkNumbers(value)
      return value
    case 'points':
      if (!POINTS.test(value)) throw new RecipeError('points must be numbers')
      checkNumbers(value)
      return value
    case 'transform':
      if (!TRANSFORM.test(value)) throw new RecipeError('transform may only be rotate(), translate() or scale()')
      checkNumbers(value)
      return value
    case 'stroke-dasharray':
      if (!DASH.test(value)) throw new RecipeError('stroke-dasharray must be numbers')
      return value
    case 'stroke-linecap':
      if (!LINECAP.has(value)) throw new RecipeError('stroke-linecap must be round or butt')
      return value
    case 'stroke-linejoin':
      if (!LINEJOIN.has(value)) throw new RecipeError('stroke-linejoin must be round, bevel or miter')
      return value
    case 'detail':
      if (value !== '1') throw new RecipeError('detail must be "1"')
      return value
    case 'stroke-width': {
      if (!NUM.test(value)) throw new RecipeError(`stroke-width must be a number; got ${JSON.stringify(value)}`)
      const width = Number(value)
      if (width < STROKE_MIN || width > STROKE_MAX) throw new RecipeError(`stroke-width must be between ${STROKE_MIN} and ${STROKE_MAX}`)
      return value
    }
    case 'opacity':
    case 'fill-opacity':
    case 'stroke-opacity':
      if (!NUM.test(value)) throw new RecipeError(`${name} must be a number; got ${JSON.stringify(value)}`)
      return String(Math.min(1, Math.max(0, Number(value))))
    default:
      if (!NUM.test(value)) throw new RecipeError(`${name} must be a number; got ${JSON.stringify(value)}`)
      if (Math.abs(Number(value)) > RANGE) throw new RecipeError(`${name}=${value} is off the 40 x 40 grid`)
      return value
  }
}

function checkAttrs(tag: ElementTag, attrs: ReadonlyArray<readonly [string, string]>): Array<readonly [string, string]> {
  const seen = new Set<string>()
  const out: Array<readonly [string, string]> = []
  for (const [name, value] of attrs) {
    if (seen.has(name)) throw new RecipeError(`attribute ${name} is repeated on <${tag}>`)
    seen.add(name)
    out.push([name, checkAttr(tag, name, value)])
  }
  return out
}

interface OpenGroup {
  readonly tag: 'g'
  readonly attrs: ReadonlyArray<readonly [string, string]>
  readonly children: Array<RecipeElement>
}

function parseUnsafe(text: string): Recipe {
  const svg = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/i.exec(text)
  if (!svg) throw new RecipeError('no <svg> element found')
  const root = new Map(attrsOf(svg[1]!))
  const hue = root.get('data-hue')
  if (hue === undefined || !isHueName(hue)) throw new RecipeError(`data-hue must be one of ${HUE_NAMES.join(', ')}; got ${JSON.stringify(hue ?? null)}`)
  const confidentRaw = root.get('data-confident')
  if (confidentRaw !== undefined && confidentRaw !== 'true' && confidentRaw !== 'false') throw new RecipeError('data-confident must be true or false')

  const body = svg[2]!.replace(/<!--[\s\S]*?-->/g, '')
  const tagRe = /<\s*(\/?)\s*([A-Za-z][\w:-]*)([^>]*?)(\/?)\s*>/g
  const top: Array<RecipeElement> = []
  const stack: Array<OpenGroup> = []
  let count = 0
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(body))) {
    const closing = match[1] === '/'
    const tag = match[2]!.toLowerCase()
    const selfClosing = match[4] === '/'
    if (closing) {
      if (tag !== 'g') continue
      const open = stack.pop()
      if (open === undefined) throw new RecipeError('stray </g>')
      const into = stack.at(-1)?.children ?? top
      into.push({ tag: 'g', attrs: open.attrs, children: open.children })
      continue
    }
    if (!isTag(tag)) throw new RecipeError(`element <${tag}> is not allowed`)
    const attrs = checkAttrs(tag, attrsOf(match[3]!))
    const into = stack.at(-1)?.children ?? top
    if (tag === 'g') {
      if (stack.length >= MAX_GROUP_DEPTH) throw new RecipeError(`groups nest deeper than ${MAX_GROUP_DEPTH}`)
      if (selfClosing) into.push({ tag, attrs, children: [] })
      else stack.push({ tag, attrs, children: [] })
      continue
    }
    count += 1
    if (count > MAX_ELEMENTS) throw new RecipeError(`more than ${MAX_ELEMENTS} elements`)
    into.push({ tag, attrs })
  }
  if (stack.length > 0) throw new RecipeError('unclosed <g>')
  const stray = body.replace(tagRe, '').trim()
  if (stray !== '') throw new RecipeError(`text content is not allowed (${JSON.stringify(stray.slice(0, 20))})`)
  if (count === 0) throw new RecipeError('empty drawing')
  return { hue, confident: confidentRaw !== 'false', elements: top }
}

/** The model's reply as a checked recipe, or the one-line reason the retry prompt quotes. */
export function parseRecipe(text: string): ParseResult {
  try {
    return { ok: true, recipe: parseUnsafe(text) }
  } catch (error) {
    if (error instanceof RecipeError) return { ok: false, reason: error.message }
    throw error
  }
}

const serialiseElement = (element: RecipeElement, depth: number): string => {
  const pad = '  '.repeat(depth + 1)
  const attrs = element.attrs.map(([name, value]) => ` ${name}="${value}"`).join('')
  if (element.tag === 'g') {
    const inner = (element.children ?? []).map((child) => serialiseElement(child, depth + 1)).join('\n')
    return `${pad}<g${attrs}>\n${inner}\n${pad}</g>`
  }
  return `${pad}<${element.tag}${attrs}/>`
}

/** The canonical text of a checked recipe: what is stored, and what `parseRecipe` reads back unchanged. */
export function serialiseRecipe(recipe: Recipe): string {
  const confident = recipe.confident ? '' : ' data-confident="false"'
  return `<svg viewBox="0 0 40 40" data-hue="${recipe.hue}"${confident}>\n${recipe.elements.map((element) => serialiseElement(element, 0)).join('\n')}\n</svg>`
}

/** Shapes in the recipe, groups not counted. */
export function countElements(recipe: Recipe): number {
  const walk = (elements: ReadonlyArray<RecipeElement>): number => elements.reduce((n, element) => n + (element.tag === 'g' ? walk(element.children ?? []) : 1), 0)
  return walk(recipe.elements)
}

