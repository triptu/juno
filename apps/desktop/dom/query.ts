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
  group: 'FIELDSET DETAILS OPTGROUP', region: 'SECTION', separator: 'HR', table: 'TABLE', row: 'TR', cell: 'TD', form: 'FORM', progressbar: 'PROGRESS', status: 'OUTPUT',
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
  if (tag === 'A') return el.hasAttribute('href') ? 'link' : undefined
  if (tag === 'IMG') return el.getAttribute('alt') === '' ? undefined : 'img'
  if (tag === 'SECTION' || tag === 'FORM') return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? (tag === 'SECTION' ? 'region' : 'form') : undefined
  return undefined
}

/** Roles whose name is not taken from what they contain. */
const NAME_FROM_AUTHOR = new Set(['textbox', 'combobox', 'searchbox', 'list', 'listbox', 'group', 'radiogroup', 'region', 'dialog', 'alertdialog', 'navigation', 'complementary', 'main', 'tablist', 'menu', 'menubar', 'tree', 'grid', 'table', 'img', 'form', 'progressbar', 'slider', 'spinbutton', 'toolbar', 'status'])

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
  if (role === undefined || !NAME_FROM_AUTHOR.has(role)) {
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
    return this.#within((root) => [...root.querySelectorAll<El>('input, textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"], [role="switch"], [role="checkbox"]')].filter((el) => matches(nameOf(el), text, options.exact === true)), `>> label=${String(text)}`)
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
    else for (let n = 0; n < (options.clickCount ?? 1); n++) this.dom.click(el, options.modifiers, n + 1)
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

const NO_TAGS: ReadonlySet<string> = new Set()

function byRole(root: El, role: string, options: RoleOptions): El[] {
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
    for (const el of parent.children) {
      if ((tags.has(el.tagName) || el.hasAttribute('role')) && roleOf(el) === role && (!visibleOnly || isVisible(el)) && fits(el as El, options)) found.push(el as El)
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
  if (options.name !== undefined && !matches(nameOf(el), options.name, options.exact === true)) return false
  return true
}

/**
 * The smallest elements whose text matches: none of their children match on
 * their own. A substring cannot be in a child's text and not in its
 * parent's, so a parent that does not match is not walked into.
 */
function byText(root: El, text: TextMatch, exact: boolean): El[] {
  const prune = typeof text === 'string' && !exact
  const found: El[] = []
  const walk = (parent: Element) => {
    for (const el of parent.children) {
      const hit = el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && matches(el.textContent ?? '', text, exact)
      if (hit && ![...el.children].some((child) => matches(child.textContent ?? '', text, exact))) found.push(el as El)
      if (hit || !prune) walk(el)
    }
  }
  walk(root)
  return found
}
