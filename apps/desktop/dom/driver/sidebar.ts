import type { MenuSeen, SidebarFilterName, SidebarRowVerbs, SidebarSectionName, SidebarVerbs, TextMatch } from '../../e2e/driver/verbs'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import { escapeRegExp, type Menus } from './menus'

/** The part of `@juno/state`'s sidebar trace the driver reads. */
interface SidebarTrace {
  readonly list: { readonly last?: { readonly seq: number; readonly filter: string } }
}

/** One row in the sidebar, found by the start of its title. */
export class SidebarRow implements SidebarRowVerbs {
  readonly root: Query

  constructor(
    readonly dom: Dom,
    readonly menus: Menus,
    readonly title: string,
    exact = false,
  ) {
    // Topic rows only: a row's avatar stack is a list of its own, whose items are named by people.
    this.root = dom.getByRole('listitem', { name: new RegExp(`^${escapeRegExp(title)}${exact ? '$' : ''}`) }).and(dom.locator('[data-topic-row]'))
  }

  get presenceDot(): Query {
    return this.root.locator('[data-presence="active"]')
  }

  get art(): Query {
    return this.root.locator('[data-topic-art]')
  }

  /** The row's drawing, once it has one. */
  async artMarkup(): Promise<string> {
    await expect(this.art).toHaveAttribute('data-topic-art', 'art', { timeout: 15_000 })
    return this.art.innerHTML()
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

  /** The status card's title at the foot of the sidebar: the first sync, or why the list may be behind Slack. */
  get syncStatus(): Query {
    return this.root.getByRole('status', { name: 'Sync status' })
  }

  /** The first sync's ring in the status card; its value text is "N of M conversations". */
  get syncProgress(): Query {
    return this.root.getByRole('progressbar', { name: 'Sync progress' })
  }

  async expectSyncStatus(text: string | RegExp): Promise<void> {
    await expect(this.syncStatus).toContainText(text, { timeout: 15_000 })
  }

  async expectNoSyncStatus(timeout = 15_000): Promise<void> {
    await expect(this.syncStatus).toHaveCount(0, { timeout })
  }

  /** Right-clicks a view's pill and picks `item` in its menu. Returns the menu's labels. */
  async viewMenu(name: string, item: 'view-edit' | 'view-left' | 'view-right' | 'view-delete'): Promise<string[]> {
    this.menus.choose(item)
    await this.viewPill(name).click({ button: 'right' })
    return (await this.menus.last()).labels
  }

  /** The sheet that makes or edits a view. */
  get viewSheet(): Query {
    return this.dom.locator('[data-view-sheet]')
  }

  async expectEmpty(title: string): Promise<void> {
    await expect(this.list.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 })
  }

  get accountButton(): Query {
    return this.root.getByRole('button', { name: 'Account and settings' })
  }
}

