import type { PaletteTabName, PaletteVerbs, TextMatch } from '../../e2e/driver/verbs'
import { expect } from '../expect'
import type { Dom } from '../input'
import { innerText, type Query } from '../query'
import type { Menus } from './menus'

/** ⌘K: search and commands (SPEC 10). */
export class PaletteDriver implements PaletteVerbs {
  readonly root: Query

  constructor(readonly dom: Dom, readonly menus: Menus) {
    this.root = dom.getByRole('dialog', { name: 'Search and commands' })
  }

  get input(): Query {
    return this.root.getByRole('combobox')
  }

  /** ⌘K, through its app menu item (Go › Search…). */
  async shortcut(): Promise<void> {
    this.menus.appMenu('search')
  }

  async open(): Promise<void> {
    await this.shortcut()
    await this.expectOpen()
  }

  async expectOpen(): Promise<void> {
    await expect(this.root).toBeVisible({ timeout: 10_000 })
    await expect(this.input).toBeFocused()
  }

  tab(name: PaletteTabName): Query {
    return this.root.getByRole('radio', { name })
  }

  async expectTab(name: PaletteTabName): Promise<void> {
    await expect(this.tab(name)).toHaveAttribute('aria-checked', 'true')
    await expect(this.input).toBeFocused()
  }

  async openMessages(): Promise<void> {
    await this.open()
    await this.expectTab('All')
    await this.press('Meta+3')
    await this.expectTab('Messages')
  }

  async openCommands(): Promise<void> {
    await this.open()
    await this.expectTab('All')
    await this.press('Meta+4')
    await this.expectTab('Commands')
  }

  async expectClosed(): Promise<void> {
    await expect(this.root).toHaveCount(0)
  }

  /** Types into the field, a key at a time as a person does. */
  async type(text: string): Promise<void> {
    await this.input.pressSequentially(text)
  }

  async expectResults(): Promise<void> {
    await expect(this.root.getByRole('listbox', { name: 'Results' })).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 })
  }

  async clear(): Promise<void> {
    await this.input.fill('')
  }

  async press(key: string): Promise<void> {
    await this.input.press(key)
  }

  section(heading: string): Query {
    return this.root.getByRole('group', { name: heading })
  }

  row(text: TextMatch): Query {
    return this.root.getByRole('option').filter({ hasText: text })
  }

  rows(): Query {
    return this.root.getByRole('option')
  }

  async activeText(): Promise<string> {
    const input = this.input.el()
    const id = input?.getAttribute('aria-activedescendant')
    const row = id === null || id === undefined ? null : this.dom.document.getElementById(id)
    return row === null || row === undefined ? '' : innerText(row)
  }

  async expectActive(text: TextMatch): Promise<void> {
    await expect.poll(() => this.activeText(), { timeout: 10_000 }).toMatch(text)
  }

  async arrowTo(text: TextMatch): Promise<void> {
    const count = this.rows().count()
    for (let step = 0; step <= count; step++) {
      const active = await this.activeText()
      if (typeof text === 'string' ? active.includes(text) : text.test(active)) return
      await this.press('ArrowDown')
    }
    throw new Error(`No row matching ${String(text)} among ${count}`)
  }

  async choose(text: TextMatch, options: { readonly newTab?: boolean } = {}): Promise<void> {
    const row = this.row(text).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click(options.newTab === true ? { modifiers: ['Meta'] } : {})
  }

  async chooseFromMenu(text: TextMatch, id: string): Promise<void> {
    this.menus.choose(id)
    await this.row(text).first().click({ button: 'right' })
  }

  async expectNoMatches(): Promise<void> {
    await expect(this.root.getByText('No matches.')).toBeVisible({ timeout: 15_000 })
  }
}

/** The Search tab's page (SPEC 10a), as `searchPage` in `e2e/searchSteps.ts`. */
export function searchPage(dom: Dom) {
  const root = dom.locator('[data-search-page]').filter({ visible: true })
  const results = root.locator('[data-search-results]')
  return {
    root,
    field: root.locator('input[data-search-field]'),
    chips: root.locator('[data-search-chip]'),
    results,
    rows: results.locator('[data-search-row]'),
    row: (text: string) => results.locator('[data-search-row]').filter({ hasText: text }),
    places: results.locator('[data-search-place]'),
    reader: root.locator('[data-search-reader]'),
    filter: (name: string) => root.getByRole('toolbar', { name: 'Filters' }).getByRole('button', { name }),
    hint: root.locator('[data-palette-hint]'),
  }
}
