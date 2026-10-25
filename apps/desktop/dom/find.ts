/**
 * Finding elements as Playwright's locators do, near enough for these tests
 * (README, "Queries"): roles, accessible names, text and what counts as
 * shown, without layout. `Query` (`query.ts`) builds on these.
 */
import { PropertySymbol } from 'happy-dom'

export type El = HTMLElement
export type TextMatch = string | RegExp

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Playwright's rule: a string matches a substring, ignoring case; `exact` asks for the whole text. A RegExp tests. */
export function matches(text: string, wanted: TextMatch, exact = false): boolean {
  const value = normalize(text)
  if (typeof wanted !== 'string') return wanted.test(value)
  return exact ? value === normalize(wanted) : value.toLowerCase().includes(normalize(wanted).toLowerCase())
}

/**
 * happy-dom's own child array and attribute map, which the walks below read
 * directly: `children` is a Proxy that costs more per element than the rest
 * of a walk, and each `hasAttribute` lowercases its name first.
 */
interface Internals {
  readonly [PropertySymbol.elementArray]: ReadonlyArray<Element>
  readonly [PropertySymbol.attributes]: { readonly [PropertySymbol.itemsByName]: ReadonlyMap<string, unknown> }
}
const childElements = (el: Element) => (el as unknown as Internals)[PropertySymbol.elementArray]
/** `hasAttribute` for a lowercase name. */
const hasAttribute = (el: Element, name: string) => (el as unknown as Internals)[PropertySymbol.attributes][PropertySymbol.itemsByName].has(name)

/** `hidden`, `inert`, `display: none` inline (React's Activity) or `aria-hidden` on the element itself. */
function hidesSubtree(el: Element): boolean {
  const html = el as El
  return Boolean(html.hidden) || el.hasAttribute('inert') || el.getAttribute('aria-hidden') === 'true' || html.style?.display === 'none'
}

/** Not in a subtree that is `hidden`, `inert`, `display: none` inline (React's Activity) or `aria-hidden`. */
export function shown(el: Element | null | undefined): el is El {
  if (el === null || el === undefined || !el.isConnected) return false
  for (let node: Element | null = el; node !== null; node = node.parentElement) if (hidesSubtree(node)) return false
  return true
}

/** The tags that can imply each role, for finding candidates (`byRole`). */
const IMPLICIT_TAGS: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(Object.entries({
  button: 'BUTTON INPUT SUMMARY', link: 'A', checkbox: 'INPUT', radio: 'INPUT', textbox: 'TEXTAREA INPUT', combobox: 'SELECT INPUT', spinbutton: 'INPUT', slider: 'INPUT',
  heading: 'H1 H2 H3 H4 H5 H6', img: 'IMG', list: 'UL OL', listitem: 'LI', navigation: 'NAV', complementary: 'ASIDE', main: 'MAIN', dialog: 'DIALOG', option: 'OPTION',
  group: 'FIELDSET DETAILS OPTGROUP', region: 'SECTION', separator: 'HR', table: 'TABLE', row: 'TR', columnheader: 'TH', rowheader: 'TH', cell: 'TD', form: 'FORM', progressbar: 'PROGRESS', status: 'OUTPUT',
}).map(([role, tags]) => [role, new Set(tags.split(' '))]))

const BY_TAG: Readonly<Record<string, string>> = {
  BUTTON: 'button', SUMMARY: 'button', TEXTAREA: 'textbox', SELECT: 'combobox', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
  UL: 'list', OL: 'list', LI: 'listitem', NAV: 'navigation', ASIDE: 'complementary', MAIN: 'main', DIALOG: 'dialog', OPTION: 'option', FIELDSET: 'group', DETAILS: 'group',
  OPTGROUP: 'group', HR: 'separator', TABLE: 'table', TR: 'row', TD: 'cell', PROGRESS: 'progressbar', OUTPUT: 'status',
}

const INPUT_ROLES: Readonly<Record<string, string>> = { button: 'button', submit: 'button', reset: 'button', checkbox: 'checkbox', radio: 'radio', number: 'spinbutton', range: 'slider' }
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel'])

/** The explicit role, or the one the element's tag and attributes imply (HTML-AAM, the part these tests meet). */
export function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0]
  if (explicit) return explicit
  const tag = el.tagName
  const byTag = BY_TAG[tag]
  if (byTag !== undefined) return byTag
  if (tag === 'INPUT') {
    const type = el.getAttribute('type')
    if (type === null || TEXT_INPUTS.has(type)) return el.hasAttribute('list') ? 'combobox' : 'textbox'
    return INPUT_ROLES[type]
  }
  if (tag === 'TH') {
    const scope = el.getAttribute('scope')
    return scope === 'col' || (scope !== 'row' && el.closest('thead') !== null) ? 'columnheader' : scope === 'row' ? 'rowheader' : undefined
  }
  if (tag === 'A') return el.hasAttribute('href') ? 'link' : undefined
  if (tag === 'IMG') return el.getAttribute('alt') === '' ? undefined : 'img'
  if (tag === 'SECTION' || tag === 'FORM') return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? (tag === 'SECTION' ? 'region' : 'form') : undefined
  return undefined
}

/** Roles whose name is taken from what they contain, as Playwright and Chromium have it; a list item or a region has none of its own. */
const NAME_FROM_CONTENT = new Set(['button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row', 'rowheader', 'switch', 'tab', 'tooltip', 'treeitem'])

/**
 * Text as a screen reader reads it (`name`) or as `innerText` gives it
 * (`text`), without layout: hidden subtrees left out; for a name, also
 * `aria-hidden` ones, an image by its alt and a labelled element by its
 * label. Children are joined with a space, as a browser separates boxes,
 * unless their parent runs text between them (`<mark>Ma</mark>ya` stays one
 * word).
 */
function readText(node: Node, mode: 'name' | 'text', top = true): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  const el = node as El
  if (el.hidden || el.style?.display === 'none' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return ''
  if (mode === 'name') {
    if (el.getAttribute('aria-hidden') === 'true') return ''
    if (el.tagName === 'IMG') return el.getAttribute('alt') ?? ''
    const label = el.getAttribute('aria-label')
    if (!top && label !== null && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return label
  }
  const children = [...el.childNodes]
  const inline = children.some((child) => child.nodeType === 3 && (child.textContent ?? '').trim() !== '')
  return children.map((child) => readText(child, mode, false)).join(inline ? '' : ' ')
}

/** Text as `innerText` gives it, near enough without layout (`readText`). */
export function innerText(el: Element): string {
  return normalize(readText(el, 'text'))
}

/** The accessible name, near enough: aria-labelledby, aria-label, a field's label, an image's alt, the content, then the title. */
export function nameOf(el: Element): string {
  const doc = el.ownerDocument
  const ids = el.getAttribute('aria-labelledby')
  if (ids !== null && ids.trim() !== '') return normalize(ids.split(/\s+/).map((id) => { const target = doc.getElementById(id); return target === null ? '' : readText(target, 'name', false) }).join(' '))
  const label = el.getAttribute('aria-label')
  if (label !== null && label.trim() !== '') return normalize(label)
  if (el.tagName === 'IMG') return normalize(el.getAttribute('alt') ?? '')
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
    const id = el.getAttribute('id')
    const labelled = (id === null ? null : doc.querySelector(`label[for="${id.replaceAll('"', '\\"')}"]`)) ?? el.closest('label')
    if (labelled !== null) return normalize(readText(labelled, 'name'))
    return normalize(el.getAttribute('title') ?? el.getAttribute('placeholder') ?? '')
  }
  const role = roleOf(el)
  if (role === undefined || NAME_FROM_CONTENT.has(role)) {
    const text = normalize(readText(el, 'name'))
    if (text !== '') return text
  }
  return normalize(el.getAttribute('title') ?? '')
}

export interface RoleOptions {
  readonly name?: TextMatch
  readonly exact?: boolean
  readonly selected?: boolean
  readonly checked?: boolean
  readonly pressed?: boolean
  readonly expanded?: boolean
  readonly disabled?: boolean
  /** A heading's level: `h2`, or `aria-level`. */
  readonly level?: number
  /** Hidden elements too, as Playwright's `includeHidden`. */
  readonly includeHidden?: boolean
}
export const disabled = (el: El) => (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true'
export const checked = (el: El) => (el as HTMLInputElement).checked === true || el.getAttribute('aria-checked') === 'true'

const NO_TAGS: ReadonlySet<string> = new Set()

export function byRole(root: El, role: string, options: RoleOptions): El[] {
  // A walk, not a selector: the page changes between most polls, so happy-dom's
  // query cache misses and its selector engine costs several times this. Each
  // element costs a tag and one attribute; only an element with the role has
  // its ancestors checked for hiding, each ancestor once per query.
  const tags = IMPLICIT_TAGS[role] ?? NO_TAGS
  const visibleOnly = options.includeHidden !== true
  if (visibleOnly && !shown(root)) return []
  const visible = new Map<Element, boolean>([[root, true]])
  const isVisible = (el: Element): boolean => {
    let answer = visible.get(el)
    if (answer === undefined) {
      answer = !hidesSubtree(el) && isVisible(el.parentElement!)
      visible.set(el, answer)
    }
    return answer
  }
  const found: El[] = []
  const walk = (parent: Element) => {
    for (const el of childElements(parent)) {
      if ((tags.has(el.tagName) || hasAttribute(el, 'role')) && roleOf(el) === role && (!visibleOnly || isVisible(el)) && fits(el as El, options)) found.push(el as El)
      walk(el)
    }
  }
  walk(root)
  return found
}

/** The name last: it reads the element's text. */
function fits(el: El, options: RoleOptions): boolean {
  if (options.selected !== undefined && (el.getAttribute('aria-selected') === 'true') !== options.selected) return false
  if (options.checked !== undefined && checked(el) !== options.checked) return false
  if (options.pressed !== undefined && (el.getAttribute('aria-pressed') === 'true') !== options.pressed) return false
  if (options.expanded !== undefined && (el.getAttribute('aria-expanded') === 'true') !== options.expanded) return false
  if (options.disabled !== undefined && disabled(el) !== options.disabled) return false
  if (options.level !== undefined && Number(el.getAttribute('aria-level') ?? /^H(\d)$/.exec(el.tagName)?.[1]) !== options.level) return false
  if (options.name !== undefined && !matches(nameOf(el), options.name, options.exact === true)) return false
  return true
}

/**
 * The smallest elements whose text matches: none of their children match on
 * their own. A substring cannot be in a child's text and not in its
 * parent's, so a parent that does not match is not walked into.
 */
export function byText(root: El, text: TextMatch, exact: boolean): El[] {
  const prune = typeof text === 'string' && !exact
  const found: El[] = []
  const walk = (parent: Element) => {
    for (const el of childElements(parent)) {
      const hit = el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && matches(el.textContent ?? '', text, exact)
      if (hit && ![...el.children].some((child) => matches(child.textContent ?? '', text, exact))) found.push(el as El)
      if (hit || !prune) walk(el)
    }
  }
  walk(root)
  return found
}
