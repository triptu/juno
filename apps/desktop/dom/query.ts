/**
 * Queries for the DOM lane (README). `Query` is a small, Locator-shaped
 * finder over a happy-dom window: it finds again on every use and waits
 * for what it acts on. Roles, names and text are matched in `find.ts`; its
 * actions go through `Dom` (`input.ts`). There is no layout, so nothing
 * here knows a box, a coordinate or a scroll position.
 */
import { byRole, byText, checked, disabled, matches, nameOf, shown, type El, type RoleOptions, type TextMatch } from './find'
import type { Dom } from './input'

export { innerText } from './find'

const DEFAULT_TIMEOUT = 5_000

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

  /** Picks an option of a `<select>` by its value or label, as Playwright's `selectOption`. */
  async selectOption(value: string): Promise<void> {
    this.dom.select((await this.element()) as unknown as HTMLSelectElement, value)
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

  /** Selects characters `start` to `end` of the element's text with the pointer (`Dom.selectText`). */
  async selectText(start: number, end: number): Promise<void> {
    this.dom.selectText(await this.element(), start, end)
  }

  async innerHTML(): Promise<string> {
    return (await this.dom.until(this.description, () => this.el())).innerHTML
  }

  async inputValue(): Promise<string> {
    return ((await this.element()) as HTMLInputElement).value
  }

  isVisible(): boolean {
    return this.find().some(shown)
  }
}
