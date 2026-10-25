/**
 * Queries for the DOM lane (README). `Query` is a small, Locator-shaped
 * finder over a happy-dom window: it finds again on every use, waits for
 * what it acts on, and matches roles and names as Playwright does near
 * enough for these tests. Its actions go through `Dom` (`input.ts`). There
 * is no layout, so nothing here knows a box, a coordinate or a scroll
 * position.
 */
import type { Dom } from './input'

export type El = HTMLElement
export type TextMatch = string | RegExp

const DEFAULT_TIMEOUT = 5_000

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Playwright's rule: a string matches a substring, ignoring case; `exact` asks for the whole text. A RegExp tests. */
export function matches(text: string, wanted: TextMatch, exact = false): boolean {
  const value = normalize(text)
  if (typeof wanted !== 'string') return wanted.test(value)
  return exact ? value === normalize(wanted) : value.toLowerCase().includes(normalize(wanted).toLowerCase())
}

/** Not in a subtree that is `hidden`, `inert`, `display: none` inline (React's Activity) or `aria-hidden`. */
export function shown(el: Element | null | undefined): el is El {
  if (el === null || el === undefined || !el.isConnected) return false
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    const html = node as El
    if (html.hidden || html.hasAttribute?.('inert') || html.style?.display === 'none' || node.getAttribute('aria-hidden') === 'true') return false
  }
  return true
}

const IMPLICIT: ReadonlyArray<readonly [string, string]> = [
  ['button', 'button, input[type="button"], input[type="submit"], input[type="reset"], summary'],
  ['link', 'a[href]'],
  ['checkbox', 'input[type="checkbox"]'],
  ['radio', 'input[type="radio"]'],
  ['textbox', 'textarea, input:not([type]):not([list]), input[type="text"]:not([list]), input[type="search"]:not([list]), input[type="email"]:not([list]), input[type="url"]:not([list]), input[type="tel"]:not([list])'],
  ['combobox', 'select, input[list]'],
  ['spinbutton', 'input[type="number"]'],
  ['slider', 'input[type="range"]'],
  ['heading', 'h1, h2, h3, h4, h5, h6'],
  ['img', 'img:not([alt=""])'],
  ['list', 'ul, ol'],
  ['listitem', 'li'],
  ['navigation', 'nav'],
  ['complementary', 'aside'],
  ['main', 'main'],
  ['dialog', 'dialog'],
  ['option', 'option'],
  ['group', 'fieldset, details, optgroup'],
  ['region', 'section[aria-label], section[aria-labelledby]'],
  ['separator', 'hr'],
  ['table', 'table'],
  ['row', 'tr'],
  ['cell', 'td'],
  ['form', 'form[aria-label], form[aria-labelledby]'],
  ['progressbar', 'progress'],
  ['status', 'output'],
]

export function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0]
  if (explicit) return explicit
  for (const [role, selector] of IMPLICIT) if (el.matches(selector)) return role
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
  /** Hidden elements too, as Playwright's `includeHidden`. */
  readonly includeHidden?: boolean
}

export interface FilterOptions {
  readonly hasText?: TextMatch
  readonly hasNotText?: TextMatch
  readonly has?: Query
  readonly hasNot?: Query
  readonly visible?: boolean
}

export interface ClickOptions {
  readonly modifiers?: ReadonlyArray<'Meta' | 'Shift' | 'Alt' | 'Control'>
  readonly button?: 'left' | 'right'
  readonly clickCount?: number
  readonly timeout?: number
}

/**
 * A lazy finder, as Playwright's Locator: it finds again each time it is used.
 * Actions wait until it matches a shown element; `expect` (./expect.ts) polls.
 */
export class Query {
  constructor(
    readonly dom: Dom,
    readonly find: () => El[],
    readonly description: string,
  ) {}

  all(): El[] {
    return this.find()
  }

  count(): number {
    return this.find().length
  }

  /** The first match, if any. */
  el(): El | undefined {
    return this.find()[0]
  }

  #within(next: (root: El) => El[], description: string): Query {
    return new Query(this.dom, () => [...new Set(this.find().flatMap(next))], `${this.description} ${description}`)
  }

  locator(selector: string): Query {
    return this.#within((root) => [...root.querySelectorAll<El>(selector)], `>> ${selector}`)
  }

  getByRole(role: string, options: RoleOptions = {}): Query {
    return this.#within((root) => byRole(root, role, options), `>> role=${role}${options.name === undefined ? '' : `[name=${String(options.name)}]`}`)
  }

  getByText(text: TextMatch, options: { readonly exact?: boolean } = {}): Query {
    return this.#within((root) => byText(root, text, options.exact === true), `>> text=${String(text)}`)
  }

  getByLabel(text: TextMatch, options: { readonly exact?: boolean } = {}): Query {
    // Fields by their name, and, as in Playwright, any other element by its `aria-label`.
    const fields = 'input, textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"], [role="switch"], [role="checkbox"]'
    return this.#within((root) => [...root.querySelectorAll<El>(`${fields}, [aria-label]`)].filter((el) => matches(el.matches(fields) ? nameOf(el) : el.getAttribute('aria-label') ?? '', text, options.exact === true)), `>> label=${String(text)}`)
  }

  getByTitle(text: TextMatch, options: { readonly exact?: boolean } = {}): Query {
    return this.#within((root) => [...root.querySelectorAll<El>('[title]')].filter((el) => matches(el.getAttribute('title') ?? '', text, options.exact === true)), `>> title=${String(text)}`)
  }

  getByPlaceholder(text: TextMatch, options: { readonly exact?: boolean } = {}): Query {
    return this.#within((root) => [...root.querySelectorAll<El>('[placeholder]')].filter((el) => matches(el.getAttribute('placeholder') ?? '', text, options.exact === true)), `>> placeholder=${String(text)}`)
  }

  filter(options: FilterOptions): Query {
    return new Query(this.dom, () => this.find().filter((el) => {
      const text = el.textContent ?? ''
      if (options.hasText !== undefined && !matches(text, options.hasText)) return false
      if (options.hasNotText !== undefined && matches(text, options.hasNotText)) return false
      if (options.has !== undefined && !options.has.all().some((inner) => el.contains(inner))) return false
      if (options.hasNot !== undefined && options.hasNot.all().some((inner) => el.contains(inner))) return false
      if (options.visible !== undefined && shown(el) !== options.visible) return false
      return true
    }), `${this.description} >> filter`)
  }

  /** Elements both queries match. */
  and(other: Query): Query {
    return new Query(this.dom, () => { const theirs = new Set(other.find()); return this.find().filter((el) => theirs.has(el)) }, `${this.description} and ${other.description}`)
  }

  /** Either query's matches, in document order. */
  or(other: Query): Query {
    return new Query(this.dom, () => {
      const found = new Set([...this.find(), ...other.find()])
      return [...found].toSorted((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1))
    }, `${this.description} or ${other.description}`)
  }

  /** Each match's parent, as Playwright's `locator('xpath=..')`. */
  parent(): Query {
    return new Query(this.dom, () => [...new Set(this.find().map((el) => el.parentElement).filter((el): el is El => el !== null))], `${this.description} >> ..`)
  }

  first(): Query {
    return this.nth(0)
  }

  last(): Query {
    return new Query(this.dom, () => this.find().slice(-1), `${this.description} >> last`)
  }

  nth(index: number): Query {
    return new Query(this.dom, () => { const found = this.find(); const el = found.at(index); return el === undefined ? [] : [el] }, `${this.description} >> nth=${index}`)
  }

  /** Waits for a shown element, as an action does. */
  async element(timeout = DEFAULT_TIMEOUT): Promise<El> {
    return this.dom.until(this.description, () => this.find().find(shown), timeout)
  }

  async click(options: ClickOptions = {}): Promise<void> {
    const el = await this.dom.until(`${this.description} to be enabled`, () => { const found = this.find().find(shown); return found !== undefined && !disabled(found) ? found : undefined }, options.timeout)
    if (options.button === 'right') this.dom.rightClick(el, options.modifiers)
    else for (let n = 0; n < (options.clickCount ?? 1); n++) {
      // Each press is its own task in a browser, so React handles the first before the second arrives.
      if (n > 0) await new Promise((done) => setTimeout(done, 0))
      this.dom.click(el, options.modifiers, n + 1)
    }
  }

  async dblclick(): Promise<void> {
    await this.click({ clickCount: 2 })
  }

  async hover(): Promise<void> {
    this.dom.hover(await this.element())
  }

  async focus(): Promise<void> {
    (await this.element()).focus()
  }

  async blur(): Promise<void> {
    (await this.element()).blur()
  }

  async fill(text: string): Promise<void> {
    const el = await this.element()
    this.dom.fill(el as HTMLInputElement, text)
  }

  /** Focuses the element, then the keys (`Enter`, `Meta+Enter`, `Shift+Tab`, `a`). */
  async press(keys: string): Promise<void> {
    const el = await this.element()
    if (this.dom.active !== el) el.focus()
    await this.dom.press(keys)
  }

  /** Focuses the element and types a key at a time. */
  async pressSequentially(text: string): Promise<void> {
    const el = await this.element()
    if (this.dom.active !== el) el.focus()
    await this.dom.type(text)
  }

  async check(): Promise<void> {
    const el = await this.element()
    if (!checked(el)) this.dom.click(el)
  }

  async uncheck(): Promise<void> {
    const el = await this.element()
    if (checked(el)) this.dom.click(el)
  }

  async setChecked(value: boolean): Promise<void> {
    await (value ? this.check() : this.uncheck())
  }

  async textContent(): Promise<string> {
    return (await this.dom.until(this.description, () => this.el())).textContent ?? ''
  }

  allTextContents(): string[] {
    return this.find().map((el) => el.textContent ?? '')
  }

  async getAttribute(name: string): Promise<string | null> {
    return (await this.dom.until(this.description, () => this.el())).getAttribute(name)
  }

  async inputValue(): Promise<string> {
    return ((await this.element()) as HTMLInputElement).value
  }

  isVisible(): boolean {
    return this.find().some(shown)
  }
}

export const disabled = (el: El) => (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true'
export const checked = (el: El) => (el as HTMLInputElement).checked === true || el.getAttribute('aria-checked') === 'true'

const IMPLICIT_SELECTOR = new Map(IMPLICIT.map(([role, selector]) => [role, selector]))

function byRole(root: El, role: string, options: RoleOptions): El[] {
  // Only elements that can have the role: an explicit role, or the tags that imply it.
  const implicit = IMPLICIT_SELECTOR.get(role)
  return [...root.querySelectorAll<El>(`[role]${implicit === undefined ? '' : `, ${implicit}`}`)].filter((el) => {
    if (roleOf(el) !== role) return false
    if (options.includeHidden !== true && !shown(el)) return false
    if (options.name !== undefined && !matches(nameOf(el), options.name, options.exact === true)) return false
    if (options.selected !== undefined && (el.getAttribute('aria-selected') === 'true') !== options.selected) return false
    if (options.checked !== undefined && checked(el) !== options.checked) return false
    if (options.pressed !== undefined && (el.getAttribute('aria-pressed') === 'true') !== options.pressed) return false
    if (options.expanded !== undefined && (el.getAttribute('aria-expanded') === 'true') !== options.expanded) return false
    if (options.disabled !== undefined && disabled(el) !== options.disabled) return false
    return true
  })
}

/** The smallest elements whose text matches: none of their children match on their own. */
function byText(root: El, text: TextMatch, exact: boolean): El[] {
  return [...root.querySelectorAll<El>('*')].filter((el) => {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || !matches(el.textContent ?? '', text, exact)) return false
    return ![...el.children].some((child) => matches(child.textContent ?? '', text, exact))
  })
}

