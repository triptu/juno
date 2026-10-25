import type { MenuSeen, SidebarFilterName, SidebarRowVerbs, SidebarSectionName, SidebarVerbs, TextMatch } from '../../e2e/driver/verbs'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import { escapeRegExp, type Menus } from './menus'

export type PeekKeyName = 'option' | 'space'

export const PEEK_KEYS: Record<PeekKeyName, string> = { option: 'Alt', space: 'Space' }

/** The part of `@juno/state`'s sidebar trace the driver reads. */
interface SidebarTrace {
  readonly list: { readonly last?: { readonly seq: number; readonly filter: string } }
}

/** One row in the sidebar, found by the start of its title. */
/** What the view sheet is filled with. */
interface ViewFields {
  readonly name?: string
  readonly icon?: string
  readonly color?: string
  readonly conversations?: ReadonlyArray<string>
  readonly keepOutOfAll?: boolean
}

export class SidebarRow implements SidebarRowVerbs {
  readonly root: Query

  constructor(
    readonly dom: Dom,
    readonly menus: Menus,
    readonly title: string,
    exact = false,
  ) {
    this.root = dom.getByRole('listitem', { name: new RegExp(`^${escapeRegExp(title)}${exact ? '$' : ''}`) })
  }

  get presenceDot(): Query {
    return this.root.locator('[data-presence="active"]')
  }

  get art(): Query {
    return this.root.locator('[data-topic-art]')
  }

  hover(): Promise<void> {
    return this.root.hover()
  }

  focus(): Promise<void> {
    return this.root.focus()
  }

  /** Selects the row with the mouse; it activates on mouse down. */
  async select(): Promise<void> {
    await this.root.click({ timeout: 15_000 })
  }

  open(): Promise<void> {
    return this.select()
  }

  /** The pointer over the row, then the peek key held down (SPEC 5, "Peek"). */
  async peek(key: PeekKeyName = 'option'): Promise<void> {
    await this.hover()
    this.dom.down(PEEK_KEYS[key])
  }

  /** ⌘-click: opens the topic in a new tab, and waits for the tab, so a next step does not land in the tab before. */
  async openInNewTab(): Promise<void> {
    const tabs = () => this.dom.getByRole('tablist').getByRole('tab').count()
    const before = tabs()
    await this.root.click({ modifiers: ['Meta'], timeout: 15_000 })
    await expect.poll(tabs, { message: 'the new tab' }).toBeGreaterThan(before)
  }

  async openInNewTabFromMenu(): Promise<void> {
    this.menus.choose('open-new-tab')
    await this.root.click({ button: 'right' })
  }

  /** Right-click, then `item` in the topic menu. Returns the menu's labels. */
  async chooseInMenu(item: string): Promise<MenuSeen> {
    this.menus.choose(item)
    await this.root.click({ button: 'right' })
    return this.menus.last()
  }

  async expectResolvedCheck(shown = true): Promise<void> {
    await expect(this.root.locator('[title="Resolved"]')).toHaveCount(shown ? 1 : 0)
  }

  async expectNewThreads(count: number): Promise<void> {
    await expect(this.root.getByTitle(count === 1 ? '1 new thread' : `${count} new threads`, { exact: true })).toHaveText(String(count))
  }

  async expectNoNewThreads(): Promise<void> {
    await expect(this.root.getByTitle(/^\d+ new threads?$/)).toHaveCount(0)
  }

  async expectVisible(): Promise<void> {
    await expect(this.root).toBeVisible({ timeout: 15_000 })
  }

  async expectSelected(selected = true): Promise<void> {
    if (selected) await expect(this.root).toHaveAttribute('aria-current', 'true')
    else await expect(this.root).not.toHaveAttribute('aria-current')
  }

  async expectFocused(): Promise<void> {
    await expect(this.root).toBeFocused()
  }

  async expectAbsent(): Promise<void> {
    await expect(this.root).toHaveCount(0)
  }

  get titleText(): Query {
    return this.root.locator('span[id]').first()
  }

  /** The "Sender: text" preview under the title. */
  get preview(): Query {
    return this.root.locator('span[id]').nth(1)
  }

  async expectPreview(text: TextMatch): Promise<void> {
    await expect(this.preview).toHaveText(text)
  }

  /** The count. The title's weight is a style: the gallery checks it. */
  async expectUnread(count: number): Promise<void> {
    await expect(this.root.locator(`[title="${count} unread"]`)).toHaveText(count > 99 ? '99+' : String(count))
  }

  async expectRead(): Promise<void> {
    await expect(this.root.locator('[title$=" unread"]')).toHaveCount(0)
  }

  async expectMention(): Promise<void> {
    await expect(this.root.locator('[title="Mentions you"]')).toHaveText('@')
  }

  async expectTag(tag: 'Reopened'): Promise<void> {
    await expect(this.root.getByText(tag, { exact: true })).toBeVisible()
  }

  async expectChannel(name: string): Promise<void> {
    await expect(this.root.getByText(name, { exact: true })).toBeVisible()
  }
}

/** The left pane: filters, sections and rows. */
export class Sidebar implements SidebarVerbs {
  readonly root: Query

  constructor(readonly dom: Dom, readonly menus: Menus) {
    this.root = dom.getByRole('complementary', { name: 'Sidebar' })
  }

  get list(): Query {
    return this.root.getByRole('group', { name: 'Topics' })
  }

  /** Moves the pointer off the list, onto the workspace, so the list stops holding its order (SPEC 5). */
  async leave(): Promise<void> {
    await this.dom.getByRole('region', { name: 'Workspace' }).hover()
  }

  /** Points at the list itself, away from any row. */
  async hoverList(): Promise<void> {
    await this.list.hover()
  }

  get rows(): Query {
    return this.list.locator('[data-topic-row]')
  }

  row(title: string, options: { readonly exact?: boolean } = {}): SidebarRow {
    return new SidebarRow(this.dom, this.menus, title, options.exact === true)
  }

  section(name: SidebarSectionName): Query {
    return this.list.getByRole('region', { name, exact: true })
  }

  /** The row titles in a section, top to bottom. */
  async titles(section?: SidebarSectionName): Promise<string[]> {
    const scope = section === undefined ? this.list : this.section(section)
    return scope.locator('[data-topic-row]').all().map((row) => {
      const id = row.getAttribute('aria-labelledby')?.split(/\s+/)[0]
      return (id === undefined ? null : this.dom.document.getElementById(id)?.textContent) ?? ''
    })
  }

  async expectVisible(): Promise<void> {
    await expect(this.root).toBeVisible({ timeout: 15_000 })
  }

  /** Waits until Recent starts with these rows, in this order. */
  async expectTop(...titles: ReadonlyArray<string>): Promise<void> {
    await expect.poll(() => this.titles('Recent').then((shown) => shown.slice(0, titles.length))).toEqual(titles)
  }

  async expectRows(): Promise<void> {
    await expect(this.rows.first()).toBeVisible({ timeout: 15_000 })
  }

  async expectScope(name: string): Promise<void> {
    await expect(this.root.getByTitle(`Showing ${name} only`)).toBeVisible({ timeout: 15_000 })
  }

  async expectNoSection(section: SidebarSectionName): Promise<void> {
    await expect(this.section(section)).toHaveCount(0)
  }

  /** A quick filter. Its name gains ", unread" while its dot shows. */
  filterButton(name: SidebarFilterName): Query {
    return this.root.getByRole('group', { name: 'Quick filters' }).getByRole('button', { name: new RegExp(`^${name}(, unread)?$`) })
  }

  get unreadToggle(): Query {
    return this.root.getByRole('button', { name: 'Unread only' })
  }

  /** The sidebar trace's last topic list value (`window.ts` turns the trace on). */
  #lastList(): { readonly seq: number; readonly filter: string } | undefined {
    return (this.dom.window as unknown as { __junoSidebarTrace?: SidebarTrace }).__junoSidebarTrace?.list.last
  }

  /**
   * Does `change` to the filters, then waits until the engine's list for the new
   * filters reached the sidebar and the rows it took away are gone. Without the
   * wait, a test can read the rows of the list before.
   */
  async #refilter(change: () => Promise<void>): Promise<void> {
    const before = this.#lastList()
    await change()
    await expect.poll(() => { const last = this.#lastList(); return last !== undefined && last.filter !== before?.filter }, { message: 'the list for the new filters' }).toBe(true)
    await expect.poll(() => this.titles()).not.toContain('')
  }

  async filter(name: SidebarFilterName): Promise<void> {
    const pressed = (await this.filterButton(name).getAttribute('aria-pressed')) === 'true'
    const press = async () => {
      await this.filterButton(name).click()
      await expect(this.filterButton(name)).toHaveAttribute('aria-pressed', 'true')
    }
    await (pressed ? press() : this.#refilter(press))
  }

  async toggleUnread(): Promise<void> {
    const was = (await this.unreadToggle.getAttribute('aria-pressed')) === 'true'
    await this.#refilter(async () => {
      await this.unreadToggle.click()
      await expect(this.unreadToggle).toHaveAttribute('aria-pressed', String(!was))
    })
  }

  async expectFilterDot(name: 'Channels' | 'DMs', shown: boolean): Promise<void> {
    await expect(this.filterButton(name)).toHaveAccessibleName(shown ? `${name}, unread` : name)
  }

  async clearFilters(): Promise<void> {
    await this.#refilter(async () => {
      await this.list.getByRole('button', { name: 'Clear filters' }).click()
      await expect(this.filterButton('All')).toHaveAttribute('aria-pressed', 'true')
      await expect(this.unreadToggle).toHaveAttribute('aria-pressed', 'false')
    })
  }

  viewPill(name: string): Query {
    return this.root.getByRole('group', { name: 'Quick filters' }).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}(, unread mention)?$`) })
  }

  async selectView(name: string): Promise<void> {
    await this.#refilter(async () => {
      await this.viewPill(name).click()
      await expect(this.viewPill(name)).toHaveAttribute('aria-pressed', 'true')
    })
  }

  /** The views' names, in pill order. */
  async viewNames(): Promise<string[]> {
    return this.root.locator('[data-view-pill]').all().map((pill) => (pill.getAttribute('aria-label') ?? '').replace(/, unread mention$/, ''))
  }

  /** A view's id, for the menus' items. */
  async viewId(name: string): Promise<string> {
    return (await this.viewPill(name).getAttribute('data-view-pill'))!
  }

  async expectViewDot(name: string, shown: boolean): Promise<void> {
    await expect(this.viewPill(name)).toHaveAccessibleName(shown ? `${name}, unread mention` : name, { timeout: 10_000 })
  }

  /** The view sheet, new or edit. */
  get viewSheet(): Query {
    return this.dom.locator('[data-view-sheet]')
  }

  /**
   * Makes a view through the New view pill and the sheet: the name, an icon
   * and its colour by their labels, the conversations by searching for each
   * name, and Keep these out of All. A new view is selected once saved.
   */
  async createView(view: ViewFields & { readonly name: string }): Promise<void> {
    await this.root.getByRole('button', { name: 'New view', exact: true }).click()
    await expect(this.viewSheet).toBeVisible()
    await this.fillViewSheet(view)
    await this.viewSheet.getByRole('button', { name: 'Save' }).click()
    await expect(this.viewSheet).toHaveCount(0)
    await expect(this.viewPill(view.name)).toHaveAttribute('aria-pressed', 'true')
  }

  /** Fills the open sheet. Conversations are toggled: one already chosen is removed. */
  async fillViewSheet(view: ViewFields): Promise<void> {
    const sheet = this.viewSheet
    if (view.name !== undefined) await sheet.getByRole('textbox', { name: 'Name' }).fill(view.name)
    if (view.icon !== undefined) await sheet.getByRole('radio', { name: view.icon }).click()
    if (view.color !== undefined) await sheet.getByRole('radiogroup', { name: 'Colour' }).getByRole('radio', { name: view.color, exact: true }).click()
    for (const conversation of view.conversations ?? []) {
      await sheet.getByRole('combobox', { name: 'Add channels and people' }).fill(conversation)
      await sheet.getByRole('option', { name: conversation, exact: true }).click()
      await expect(sheet.getByRole('option', { name: conversation, exact: true })).toHaveAttribute('aria-selected', 'true')
    }
    if (view.keepOutOfAll !== undefined) await sheet.getByRole('checkbox', { name: /Keep these out of All/ }).setChecked(view.keepOutOfAll)
  }

  /** Right-click a view's pill, then `item` in its menu. Returns the menu's labels. */
  async viewMenu(name: string, item: 'view-edit' | 'view-left' | 'view-right' | 'view-delete'): Promise<string[]> {
    this.menus.choose(item)
    await this.viewPill(name).click({ button: 'right' })
    return (await this.menus.last()).labels
  }

  async expectEmpty(title: string): Promise<void> {
    await expect(this.list.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 })
  }

  get accountButton(): Query {
    return this.root.getByRole('button', { name: 'Account and settings' })
  }
}

