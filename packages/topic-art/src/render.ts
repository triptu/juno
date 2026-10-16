/**
 * From a checked recipe to SVG markup. Every tag and attribute name written
 * here is a literal from the whitelist, every colour is a CSS variable for
 * the recipe's hue, and attribute values are the ones `parseRecipe` matched
 * against a grammar (numbers, path data, token names), none of which can
 * contain a quote or an angle bracket.
 *
 * One recipe draws at every size. Below 20px the elements marked
 * `detail="1"` are dropped and the stroke goes 30% heavier, so a line in a
 * 16px tab stays at least 1.4px.
 */
import { artVar, type HueName, type Role } from './palette'
import type { Recipe, RecipeElement } from './recipe'

/** The shared line: ink at 2.75 units on the 40 grid, round caps and joins. */
export const STROKE = 2.75
/** Below this many pixels the drawing is a glyph: detail drops and the stroke thickens. */
export const SMALL_BELOW = 20
const SMALL_STROKE_SCALE = 1.3

/** The sizes the app draws art at: 40 in rows, 20 in peek, 16 in tabs. */
export type ArtSize = 40 | 20 | 16

const fixed = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))

function paint(hue: HueName, role: string): string {
  return role === 'none' ? 'none' : artVar(hue, role as Exclude<Role, 'none'>)
}

function renderElement(element: RecipeElement, hue: HueName, small: boolean): string {
  const attrs: Array<string> = []
  let detail = false
  for (const [name, value] of element.attrs) {
    if (name === 'detail') {
      detail = true
      continue
    }
    if (name === 'fill' || name === 'stroke') attrs.push(`${name}="${paint(hue, value)}"`)
    else if (name === 'stroke-width') attrs.push(`${name}="${fixed(Number(value) * (small ? SMALL_STROKE_SCALE : 1))}"`)
    else attrs.push(`${name}="${value}"`)
  }
  if (small && detail) return ''
  const joined = attrs.length === 0 ? '' : ` ${attrs.join(' ')}`
  if (element.tag === 'g') {
    const inner = (element.children ?? []).map((child) => renderElement(child, hue, small)).join('')
    return `<g${joined}>${inner}</g>`
  }
  return `<${element.tag}${joined}/>`
}

/**
 * The recipe as inline SVG for one size. The same string serves both themes.
 * `hue` paints the drawing in another hue than the one the recipe names; the
 * app passes the topic's `pebbleHue`.
 */
export function renderArt(recipe: Recipe, size: ArtSize, hue: HueName = recipe.hue): string {
  const small = size < SMALL_BELOW
  const stroke = small ? STROKE * SMALL_STROKE_SCALE : STROKE
  const body = recipe.elements.map((element) => renderElement(element, hue, small)).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<g fill="none" stroke="${artVar(hue, 'ink')}" stroke-width="${fixed(stroke)}" stroke-linecap="round" stroke-linejoin="round">${body}</g>` +
    `</svg>`
  )
}
