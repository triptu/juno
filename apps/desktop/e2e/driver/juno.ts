import type { NotificationPermission } from '@juno/contract'
/**
 * The user-language driver for Juno (architecture 13). Tests read as what a
 * person does: `juno.signIn()`, `juno.sidebar.row('Postgres').hover()`.
 * Later milestones add verbs here; a test that needs a raw selector means a
 * verb is missing.
 */
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

/**
 * How long a click holds the button, as a real one does. A pointerup in the
 * frame right after the pointerdown makes Chromium defer the page's tasks
 * past the next frame, which would end the app's input-to-paint measures a
 * frame late.
 */
const PRESS_MS = 60

interface WorkHooks {
  readonly workPass: (name: 'title' | 'art' | 'home' | 'automated') => Promise<void>
}

/** Presses and releases the primary button where the mouse is. */
export async function press(win: Page): Promise<void> {
  await win.mouse.down()
  await win.waitForTimeout(PRESS_MS)
  await win.mouse.up()
}

/** Mouse moves per pointing gesture, so the pointer travels as a hand moves it rather than jumping. */
const POINT_STEPS = 4

/**
 * Points at an element: real stepped mouse moves, then waits until the
 * element matches `:hover`. If hover did not land, or was taken back,
 * it moves again, up to three times, then fails with what is hovered.
 * `position` is relative to the element's box, default its centre.
 */
export async function pointAt(win: Page, target: Locator, position?: { readonly x: number; readonly y: number }): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = await target.boundingBox()
    if (!box) throw new Error('Nothing on screen to point at')
    const x = box.x + (position?.x ?? box.width / 2)
    const y = box.y + (position?.y ?? box.height / 2)
    await win.mouse.move(x, y, { steps: POINT_STEPS })
    const hovered = () => target.evaluate((node) => node.matches(':hover'))
    try {
      await expect.poll(hovered, { timeout: 1_000, intervals: [16, 32, 64] }).toBe(true)
      // Two frames later it must still be hovered.
      await target.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      if (await hovered()) return
    } catch {
      // Move again.
    }
  }
  const deepest = await target.evaluate(() => {
    const node = [...document.querySelectorAll(':hover')].at(-1)
    return node === undefined ? 'nothing' : node.outerHTML.slice(0, 120)
  })
  throw new Error(`Pointing did not hover the element; hovered: ${deepest}`)
}

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** The element's box once it is the same on two frames in a row (up to two seconds), or null when it is not shown. */
function settledBox(target: Locator): Promise<Box | null> {
  return target.evaluate(
    (node) =>
      new Promise<Box | null>((resolve) => {
        const read = () => {
          const { x, y, width, height } = node.getBoundingClientRect()
          return node.isConnected && width > 0 ? { x, y, width, height } : null
        }
        const until = performance.now() + 2_000
        let last = read()
        const frame = () => {
          const next = read()
          if (next === null || (last !== null && next.x === last.x && next.y === last.y && next.height === last.height) || performance.now() > until) resolve(next)
          else {
            last = next
            requestAnimationFrame(frame)
          }
        }
        requestAnimationFrame(frame)
      }),
  )
}

export type SidebarSectionName = 'Pinned' | 'Recent'
export type SidebarFilterName = 'All' | 'Channels' | 'DMs'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One row in the sidebar, found by the start of its title. */
export class SidebarRow {
  readonly root: Locator

  constructor(
    readonly win: Page,
    readonly title: string,
    exact = false,
  ) {
    // Rows are focusable list items named by their title (a button would
    // flatten the Resolve button inside it).
    this.root = win.getByRole('listitem', { name: new RegExp(`^${escapeRegExp(title)}${exact ? '$' : ''}`) })
  }

  get resolveButton() {
    return this.root.getByRole('button', { name: new RegExp(`^Resolve ${escapeRegExp(this.title)}`) })
  }

  /** The row's tile: `data-topic-art` is `art` once the topic has a drawing, `placeholder` for the pebble. */
  get art(): Locator {
    return this.root.locator('[data-topic-art]')
  }

  /** The drawing's markup, once the row shows one. */
  async artMarkup(): Promise<string> {
    await expect(this.art).toHaveAttribute('data-topic-art', 'art', { timeout: 15_000 })
    return this.art.innerHTML()
  }

  hover(): Promise<void> {
    return pointAt(this.win, this.root)
  }

  focus() {
    return this.root.focus()
  }

  /**
   * Selects the row with the mouse (it activates on mouse down). Rows move
   * while the list fills and when a topic gets activity, so the pointer goes
   * to the row once its box has stayed the same for two frames; from then on
   * the list holds its order under the pointer (SPEC 5). A test that has just
   * caused a move waits for it first (`expectTop`).
   */
  async select(): Promise<void> {
    await this.root.scrollIntoViewIfNeeded()
    const box = await settledBox(this.root)
    if (!box) throw new Error(`Row "${this.title}" is not on screen`)
    await this.win.mouse.move(box.x + 40, box.y + box.height / 2)
    await press(this.win)
  }

  /** Opens the topic in the current tab. */
  open(): Promise<void> {
    return this.select()
  }

  /** ⌘-click: opens the topic in a new tab. */
  async openInNewTab(): Promise<void> {
    await this.win.keyboard.down('Meta')
    await this.select()
    await this.win.keyboard.up('Meta')
  }

  /** Right-click, then Open in new tab. */
  async openInNewTabFromMenu(): Promise<void> {
    await chooseNextMenuItem(this.win, 'open-new-tab')
    await this.root.click({ button: 'right', position: { x: 40, y: 20 } })
  }

  /**
   * Right-click, then `item` in the topic menu. Returns the menu's labels
   * (see `TopicPane.chooseInMenu`).
   */
  async chooseInMenu(item: TopicMenuItem): Promise<{ readonly labels: string[]; readonly at: { readonly x: number; readonly y: number } | null }> {
    await chooseNextMenuItem(this.win, item)
    await this.root.click({ button: 'right', position: { x: 40, y: 20 } })
    return lastMenu(this.win)
  }

  /** A pinned resolved row: the check before the title. */
  async expectResolvedCheck(shown = true): Promise<void> {
    await expect(this.root.locator('[title="Resolved"]')).toHaveCount(shown ? 1 : 0)
  }

  /** Main rows: "2 new threads" after the title. */
  async expectNewThreads(count: number): Promise<void> {
    await expect(this.root.getByTitle(count === 1 ? '1 new thread' : `${count} new threads`)).toHaveText(String(count))
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

  /** The row is not in the list at all. */
  async expectAbsent(): Promise<void> {
    await expect(this.root).toHaveCount(0)
  }

  /** The title element, which names the row. The row's text spans carry ids; the tile's SVG has an id of its own, hence `span`. */
  get titleText() {
    return this.root.locator('span[id]').first()
  }

  /** The "Sender: text" preview under the title. */
  get preview() {
    return this.root.locator('span[id]').nth(1)
  }

  async expectPreview(text: string | RegExp): Promise<void> {
    await expect(this.preview).toHaveText(text)
  }

  async expectUnread(count: number): Promise<void> {
    const label = count > 99 ? '99+' : String(count)
    await expect(this.root.locator(`[title="${count} unread"]`)).toHaveText(label)
    await expect(this.titleText).toHaveCSS('font-weight', '600')
  }

  async expectRead(): Promise<void> {
    await expect(this.root.locator('[title$=" unread"]')).toHaveCount(0)
    await expect(this.titleText).toHaveCSS('font-weight', '500')
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

  /** Points at the row and holds the peek key. `juno.peek.release()` lets go. */
  async peek(key: PeekKeyName = 'option'): Promise<void> {
    await this.hover()
    await this.win.keyboard.down(peekKeys[key])
  }
}

export type PeekKeyName = 'option' | 'space'

const peekKeys: Record<PeekKeyName, string> = { option: 'Alt', space: 'Space' }

/** The left pane: filters, sections and rows. */
export class Sidebar {
  readonly root: Locator

  constructor(readonly win: Page) {
    this.root = win.getByRole('complementary', { name: 'Sidebar' })
  }

  get list() {
    return this.root.getByRole('group', { name: 'Topics' })
  }

  /** Moves the pointer off the list, onto the workspace, so the list stops holding its order (SPEC 5). */
  leave(): Promise<void> {
    return this.win.mouse.move(900, 400, { steps: 4 })
  }

  /** Points at the list near its top-left corner, away from any row's controls. */
  hoverList(): Promise<void> {
    return pointAt(this.win, this.list, { x: 10, y: 10 })
  }

  get rows() {
    return this.list.locator('[data-topic-row]')
  }

  /** The row whose title starts with `title`, or is exactly `title` with `exact`. */
  row(title: string, options: { readonly exact?: boolean } = {}): SidebarRow {
    return new SidebarRow(this.win, title, options.exact === true)
  }

  section(name: SidebarSectionName) {
    return this.list.getByRole('region', { name, exact: true })
  }

  /** The row titles in a section, top to bottom. */
  async titles(section?: SidebarSectionName): Promise<string[]> {
    const scope = section === undefined ? this.list : this.section(section)
    return scope.locator('[data-topic-row]').evaluateAll((rows) =>
      rows.map((row) => {
        const titleId = row.getAttribute('aria-labelledby')
        return (titleId === null ? null : document.getElementById(titleId)?.textContent) ?? ''
      }),
    )
  }

  async expectVisible(): Promise<void> {
    await expect(this.root).toBeVisible({ timeout: 15_000 })
  }

  /**
   * Waits until Recent starts with these rows, in this order. A message a test injects moves its topic to the top
   * when the engine stores it, so a test that then clicks a row waits for that move first.
   */
  async expectTop(...titles: ReadonlyArray<string>): Promise<void> {
    await expect.poll(() => this.titles('Recent').then((shown) => shown.slice(0, titles.length))).toEqual(titles)
  }

  /** Waits until at least one row has arrived from the engine. */
  async expectRows(): Promise<void> {
    await expect(this.rows.first()).toBeVisible({ timeout: 15_000 })
  }

  /** The scope chip under the filters names the channel the list is narrowed to. */
  async expectScope(name: string): Promise<void> {
    await expect(this.root.getByTitle(`Showing ${name} only`)).toBeVisible({ timeout: 15_000 })
  }

  async expectNoSection(section: SidebarSectionName): Promise<void> {
    await expect(this.section(section)).toHaveCount(0)
  }

  /** A quick filter. Its name gains ", unread" while its dot shows. */
  filterButton(name: SidebarFilterName) {
    return this.root.getByRole('group', { name: 'Quick filters' }).getByRole('button', { name: new RegExp(`^${name}(, unread)?$`) })
  }

  get unreadToggle() {
    return this.root.getByRole('button', { name: 'Unread only' })
  }

  async filter(name: SidebarFilterName): Promise<void> {
    await this.filterButton(name).click()
    await expect(this.filterButton(name)).toHaveAttribute('aria-pressed', 'true')
  }

  async toggleUnread(): Promise<void> {
    const was = (await this.unreadToggle.getAttribute('aria-pressed')) === 'true'
    await this.unreadToggle.click()
    await expect(this.unreadToggle).toHaveAttribute('aria-pressed', String(!was))
  }

  /** The unread dot after a filter, which a screen reader hears as part of the filter's name. */
  async expectFilterDot(name: 'Channels' | 'DMs', shown: boolean): Promise<void> {
    await expect(this.filterButton(name)).toHaveAccessibleName(shown ? `${name}, unread` : name)
  }

  /** Clears the filters from the empty state. */
  async clearFilters(): Promise<void> {
    await this.list.getByRole('button', { name: 'Clear filters' }).click()
    await expect(this.filterButton('All')).toHaveAttribute('aria-pressed', 'true')
    await expect(this.unreadToggle).toHaveAttribute('aria-pressed', 'false')
  }

  // Views (SPEC 5 "Views", inventory 2.3).

  /** The horizontally scrolling row of pills. */
  get pillRow() {
    return this.root.getByRole('group', { name: 'Quick filters' }).locator('[data-pill-row]')
  }

  /** A view's pill. Its name gains ", unread mention" while its dot shows. */
  viewPill(name: string) {
    return this.root.getByRole('group', { name: 'Quick filters' }).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}(, unread mention)?$`) })
  }

  /** The views' names, in pill order. */
  viewNames(): Promise<string[]> {
    return this.root.locator('[data-view-pill]').evaluateAll((pills) => pills.map((pill) => (pill.getAttribute('aria-label') ?? '').replace(/, unread mention$/, '')))
  }

  /** A view's id, for the menus' items. */
  async viewId(name: string): Promise<string> {
    return (await this.viewPill(name).getAttribute('data-view-pill'))!
  }

  async selectView(name: string): Promise<void> {
    await this.viewPill(name).click()
    await expect(this.viewPill(name)).toHaveAttribute('aria-pressed', 'true')
  }

  async expectViewDot(name: string, shown: boolean): Promise<void> {
    await expect(this.viewPill(name)).toHaveAccessibleName(shown ? `${name}, unread mention` : name, { timeout: 10_000 })
  }

  /** The view sheet, new or edit. */
  get viewSheet() {
    return this.win.locator('[data-view-sheet]')
  }

  /**
   * Makes a view through the New view pill and the sheet: the name, an icon
   * and its colour by their labels, the conversations by searching for each name, and Keep
   * these out of All. A new view is selected once saved.
   */
  async createView(view: { readonly name: string; readonly icon?: string; readonly color?: string; readonly conversations?: ReadonlyArray<string>; readonly keepOutOfAll?: boolean }): Promise<void> {
    await this.root.getByRole('button', { name: 'New view', exact: true }).click()
    await expect(this.viewSheet).toBeVisible()
    await this.fillViewSheet(view)
    await this.viewSheet.getByRole('button', { name: 'Save' }).click()
    await expect(this.viewSheet).toHaveCount(0)
    await expect(this.viewPill(view.name)).toHaveAttribute('aria-pressed', 'true')
  }

  /** Fills the open sheet. Conversations are toggled: one already chosen is removed. */
  async fillViewSheet(view: { readonly name?: string; readonly icon?: string; readonly color?: string; readonly conversations?: ReadonlyArray<string>; readonly keepOutOfAll?: boolean }): Promise<void> {
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

  /** Right-click a view's pill, then `item` in its menu (inventory 15.7). Returns the menu's labels. */
  async viewMenu(name: string, item: 'view-edit' | 'view-left' | 'view-right' | 'view-delete'): Promise<string[]> {
    await chooseNextMenuItem(this.win, item)
    await this.viewPill(name).click({ button: 'right' })
    return (await lastMenu(this.win)).labels
  }

  /** The status card's title at the foot of the sidebar: the first sync, or why the list may be behind Slack. */
  get syncStatus() {
    return this.root.getByRole('status', { name: 'Sync status' })
  }

  /** The first sync's ring in the status card; its value text is "N of M conversations". */
  get syncProgress() {
    return this.root.getByRole('progressbar', { name: 'Sync progress' })
  }

  get restartButton() {
    return this.root.getByRole('region', { name: 'Sync' }).getByRole('button', { name: 'Restart' })
  }

  async expectSyncStatus(text: string | RegExp): Promise<void> {
    await expect(this.syncStatus).toContainText(text, { timeout: 15_000 })
  }

  async expectNoSyncStatus(timeout = 15_000): Promise<void> {
    await expect(this.syncStatus).toHaveCount(0, { timeout })
  }

  /**
   * Counts the rows in the list on every frame until the returned function
   * is called, which answers with the number of frames and how many of them
   * showed no rows at all.
   */
  async watchFrames(): Promise<() => Promise<{ readonly frames: number; readonly blank: number; readonly fewest: number }>> {
    await this.list.evaluate((list) => {
      const w = window as unknown as { __rowFrames?: { counts: number[]; on: boolean } }
      const state = { counts: [] as number[], on: true }
      w.__rowFrames = state
      const tick = () => {
        state.counts.push(list.querySelectorAll('[data-topic-row]').length)
        if (state.on) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    return () =>
      this.win.evaluate(() => {
        const state = (window as unknown as { __rowFrames: { counts: number[]; on: boolean } }).__rowFrames
        state.on = false
        return { frames: state.counts.length, blank: state.counts.filter((count) => count === 0).length, fewest: Math.min(...state.counts) }
      })
  }

  async expectEmpty(title: string): Promise<void> {
    await expect(this.list.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 })
  }

  get searchButton() {
    return this.root.getByRole('button', { name: 'Search ⌘K' })
  }

  get accountButton() {
    return this.root.getByRole('button', { name: 'Account and settings' })
  }
}

/** The popover behind the avatar button: presence, privacy, Notifications, Settings and the session. */
export class AccountMenu {
  readonly root: Locator

  constructor(
    readonly win: Page,
    readonly sidebar: Sidebar,
  ) {
    this.root = win.getByRole('dialog', { name: 'Account' })
  }

  async open(): Promise<void> {
    if (await this.root.isVisible()) return
    await this.sidebar.accountButton.click()
    await expect(this.root).toBeVisible()
  }

  async close(): Promise<void> {
    if (!(await this.root.isVisible())) return
    await this.win.keyboard.press('Escape')
    await expect(this.root).toHaveCount(0)
  }

  get sessionStatus() {
    return this.root.getByRole('status', { name: 'Session status' })
  }

  get signOutButton() {
    return this.root.getByRole('button', { name: 'Sign out' })
  }

  /** Set yourself away or active, Hide message text, Notifications, Settings (inventory 2.1). */
  item(name: string | RegExp) {
    return this.root.getByRole('menuitem', { name })
  }

  /** The line under the name: "Active", "Away until 9am". */
  async expectPresence(text: string | RegExp): Promise<void> {
    await expect(this.root.getByText(text)).toBeVisible({ timeout: 10_000 })
  }

  async choose(name: string | RegExp): Promise<void> {
    await this.open()
    await this.item(name).click()
    await expect(this.root).toHaveCount(0)
  }
}

/** Settings (inventory 14): its list of sections, and the open section's page. */
export class SettingsPage {
  readonly root: Locator
  readonly nav: Locator

  constructor(readonly win: Page) {
    this.root = win.getByRole('main')
    this.nav = this.root.getByRole('navigation', { name: 'Settings' })
  }

  section(name: SettingsSectionName): Locator {
    return this.nav.getByRole('button', { name, exact: true })
  }

  /** Goes to a section and waits for the list to mark it. */
  async show(name: SettingsSectionName): Promise<void> {
    await this.section(name).click()
    await expect(this.section(name)).toHaveAttribute('aria-current', 'page')
  }

  /** About's engine line. */
  get engineStatus() {
    return this.root.getByRole('status', { name: 'Engine status' })
  }

  get pingButton() {
    return this.root.getByRole('button', { name: 'Ping engine' })
  }

  themeRadio(name: 'System' | 'Light' | 'Dark') {
    return this.root.getByRole('radio', { name })
  }

  densityRadio(name: 'Comfortable' | 'Compact') {
    return this.root.getByRole('radio', { name })
  }

  /** One ignored channel's row on the ignore list (inventory 14), by name without "#". */
  ignored(name: string): Locator {
    return this.root.locator('[data-ignored-channel]').filter({ hasText: name })
  }

  async stopIgnoring(name: string): Promise<void> {
    await this.ignored(name).getByRole('button', { name: `Stop ignoring ${name}` }).click()
  }

  /** The ignore list's add row: the channel select and Ignore. */
  get ignoreAdd(): Locator {
    return this.root.locator('[data-ignore-add]')
  }

  get ignoreSelect(): Locator {
    return this.ignoreAdd.getByRole('button', { name: /^Channel to ignore/ })
  }

  get ignoreButton(): Locator {
    return this.ignoreAdd.getByRole('button', { name: 'Ignore', exact: true })
  }

  /** The add row's open list of channels. */
  get ignoreOptions(): Locator {
    return this.win.getByRole('listbox', { name: 'Channels' }).getByRole('option')
  }
}

export type SettingsSectionName = 'General' | 'Appearance' | 'Notifications' | 'Ignored' | 'Tidy up' | 'Juno' | 'AI activity' | 'Connections' | 'Backup & This Mac' | 'About'

/** Settings › Notifications (inventory 13). */
export class NotificationsPage {
  readonly root: Locator

  constructor(readonly win: Page) {
    this.root = win.getByRole('main')
  }

  /** The Notifications or Active in Slack row. */
  hoursRow(which: 'Notifications' | 'Active in Slack'): Locator {
    return this.root.getByLabel(which, { exact: true })
  }

  async setFrom(which: 'Notifications' | 'Active in Slack', label: string): Promise<void> {
    await this.root.getByRole('combobox', { name: `${which} from` }).selectOption({ label })
  }

  async setTo(which: 'Notifications' | 'Active in Slack', label: string): Promise<void> {
    await this.root.getByRole('combobox', { name: `${which} to` }).selectOption({ label })
  }

  day(which: 'Notifications' | 'Active in Slack', day: string): Locator {
    return this.root.getByRole('group', { name: `${which} days` }).getByRole('button', { name: day })
  }

  get matters(): Locator {
    return this.root.getByRole('textbox', { name: 'What matters to you' })
  }

  /** Types into What matters to you and leaves the field, which saves it. */
  async writeMatters(text: string): Promise<void> {
    await this.matters.fill(text)
    await this.matters.blur()
  }

  /** The Every message or Never row. */
  level(name: 'Every message' | 'Never'): Locator {
    return this.root.getByLabel(name, { exact: true })
  }

  async removeTag(name: string): Promise<void> {
    await this.root.getByRole('button', { name: `Remove ${name}` }).click()
  }

  get showWhy(): Locator {
    return this.root.getByRole('button', { name: 'Show why' })
  }

  get interrupted(): Locator {
    return this.root.getByRole('list', { name: 'Messages that interrupted you' })
  }
}

/** The peek popover, while the peek key is held over a sidebar row or a Main message's thread. */
export class PeekPopover {
  readonly root: Locator

  constructor(readonly win: Page) {
    this.root = win.locator('[role="dialog"][aria-roledescription="peek"]')
  }

  async expectShowing(title: string): Promise<void> {
    await expect(this.root).toBeVisible()
    await expect(this.root).toHaveAccessibleName(new RegExp(`^${escapeRegExp(title)}`))
  }

  async expectMessage(text: string): Promise<void> {
    await expect(this.root.getByRole('list', { name: 'Messages' }).getByText(text, { exact: false }).first()).toBeVisible()
  }

  async expectClosed(): Promise<void> {
    await expect(this.root).toHaveCount(0)
  }

  /** Lets go of the peek key. */
  async release(key: PeekKeyName = 'option'): Promise<void> {
    await this.win.keyboard.up(peekKeys[key])
  }
}

export class Juno {
  readonly app: ElectronApplication
  readonly win: Page
  readonly sidebar: Sidebar
  readonly accountMenu: AccountMenu
  readonly settings: SettingsPage
  readonly notifications: NotificationsPage
  readonly topic: TopicPane
  /** Home's composer: Recent, the destination chip and the field. */
  readonly write: HomeWritePane
  readonly tabs: TabStrip
  readonly nav: Navigation
  readonly frame: SidebarFrame
  readonly allTopics: AllTopicsPane
  readonly home: HomePane
  readonly peek: PeekPopover
  readonly privacy: PrivacyMode
  readonly palette: PaletteDriver
  readonly welcome: WelcomeDriver

  constructor(app: ElectronApplication, win: Page) {
    this.app = app
    this.win = win
    appOf.set(win, app)
    this.sidebar = new Sidebar(win)
    this.accountMenu = new AccountMenu(win, this.sidebar)
    this.settings = new SettingsPage(win)
    this.notifications = new NotificationsPage(win)
    this.topic = new TopicPane(win)
    this.write = new HomeWritePane(win)
    this.tabs = new TabStrip(app, win)
    this.nav = new Navigation(app, win)
    this.frame = new SidebarFrame(app, win)
    this.allTopics = new AllTopicsPane(win)
    this.home = new HomePane(win)
    this.peek = new PeekPopover(win)
    this.privacy = new PrivacyMode(app, win)
    this.palette = new PaletteDriver(app, win)
    this.welcome = new WelcomeDriver(app, win)
  }

  /**
   * Makes the next native context menu pick `id` without showing it, or pick
   * nothing with null. With `hold`, the menu stays open until `releaseMenu`,
   * so a test can change things under it.
   */
  chooseNextMenuItem(id: string | null, options: { readonly hold?: boolean } = {}): Promise<void> {
    return chooseNextMenuItem(this.win, id, options)
  }

  /** What the last native menu showed, once it took the item `chooseNextMenuItem` set. */
  lastMenu(): Promise<{ readonly labels: string[]; readonly at: { readonly x: number; readonly y: number } | null }> {
    return lastMenu(this.win)
  }

  /** How many native context menus were asked for since launch, Juno's and the text menu. */
  menusAsked(): Promise<number> {
    return this.app.evaluate(() => (globalThis as unknown as { junoTest: { contextMenu: { asked: number } } }).junoTest.contextMenu.asked)
  }

  /** Picks the item of the menu `chooseNextMenuItem` held open. */
  releaseMenu(): Promise<void> {
    return releaseMenu(this.app)
  }

  /** The toast that says `text` (inventory 16). */
  toast(text: string): Locator {
    return this.win.getByRole('status').filter({ hasText: text })
  }

  async expectToast(text: string): Promise<void> {
    await expect(this.toast(text)).toBeVisible({ timeout: 10_000 })
  }

  /** The Undo of the toast on screen. */
  async undoFromToast(): Promise<void> {
    await this.win.getByRole('status').getByRole('button', { name: /^Undo/ }).click()
  }

  /** Edit › Undo, as ⌘Z. */
  async undo(): Promise<void> {
    await clickAppMenu(this.app, 'undo')
  }

  /** The title field of a rename, in a row or the header. */
  get renameField(): Locator {
    return this.win.locator('[data-rename-field]').filter({ visible: true })
  }

  /** Types a new title into the open rename field and saves it with Enter. */
  async rename(title: string): Promise<void> {
    await expect(this.renameField).toBeFocused()
    await this.renameField.fill(title)
    await this.renameField.press('Enter')
    await expect(this.renameField).toHaveCount(0)
  }

  /** The text the app last put on the clipboard. */
  clipboard(): Promise<string> {
    return this.app.evaluate(({ clipboard }) => clipboard.readText())
  }

  /** The links a click sent to the browser, oldest first. */
  browserLinks(): Promise<string[]> {
    return this.app.evaluate(() => [...(globalThis as unknown as { junoTest: { browserLinks: string[] } }).junoTest.browserLinks])
  }

  /** The web panel's page as main has it: its url, or null with no panel, and whether it is drawn. */
  webPanel(): Promise<{ url: string | null; visible: boolean }> {
    return this.app.evaluate(() => (globalThis as unknown as { junoTest: { webPanel: () => { url: string | null; visible: boolean } } }).junoTest.webPanel())
  }

  /** The `slack://` links Open in Slack opened, oldest first. */
  slackLinks(): Promise<string[]> {
    return this.app.evaluate(() => [...(globalThis as unknown as { junoTest: { slackLinks: string[] } }).junoTest.slackLinks])
  }

  /**
   * Nothing was opened: the one tab a fresh launch, or closing the last tab,
   * leaves, with Home. There is never no tab (SPEC 6).
   */
  async expectNothingOpen(): Promise<void> {
    await this.tabs.expectCount(1)
    await this.tabs.expectActive('Home')
    await this.home.expectShown()
  }

  /**
   * The window loses focus, as when the user switches to another app.
   * Playwright keeps the page focused, so this sends the event the app listens for.
   */
  async blurWindow(): Promise<void> {
    await this.win.evaluate(() => window.dispatchEvent(new FocusEvent('blur')))
  }

  async focusWindow(): Promise<void> {
    await this.win.evaluate(() => window.dispatchEvent(new FocusEvent('focus')))
  }

  /** The sign-in page's primary and secondary actions. */
  get signInButton() {
    return this.win.getByRole('button', { name: 'Sign in to Slack' })
  }

  get importButton() {
    return this.win.getByRole('button', { name: "Use the Slack app's session" })
  }

  /** The quiet button beside a failed import's line. */
  get copyDetailsButton() {
    return this.win.getByRole('button', { name: 'Copy details', exact: true })
  }

  /** Clicks "Copy details" and returns what it put on the clipboard. */
  async copySignInDetails(): Promise<string> {
    await this.copyDetailsButton.click()
    await expect.poll(() => this.clipboard(), { timeout: 5_000 }).toContain('Juno: Slack app import')
    return this.clipboard()
  }

  /**
   * Clicks "Sign in to Slack", fills the fake's sign-in page in the window
   * that opens, and waits for the app to come back signed in. Then skips
   * "Set up Juno" unless `skipSetUp` is false.
   */
  async signIn(options: { readonly email?: string; readonly skipSetUp?: boolean } = {}): Promise<void> {
    const started = performance.now()
    const page = await this.openSignInWindow()
    await page.getByPlaceholder('Email').fill(options.email ?? 'tushar@juno-fake.test')
    await page.getByPlaceholder('Password').fill('password')
    await Promise.all([page.waitForEvent('close'), page.getByRole('button', { name: 'Sign in' }).click()])
    if (options.skipSetUp !== false) await this.skipSetUp()
    if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: sign-in ${Math.round(performance.now() - started)} ms`)
  }

  /** "Set up Juno", shown after a first sign-in with no model provider (SPEC 13.10). */
  get setUp(): Locator {
    return this.win.locator('[data-set-up-juno]')
  }

  /**
   * Once signed in, presses Skip for now on "Set up Juno" if it shows. It
   * shows before the sidebar or not at all, so whichever comes first says.
   */
  async skipSetUp(): Promise<void> {
    await expect(this.setUp.or(this.sidebar.root).first()).toBeVisible({ timeout: 15_000 })
    if (await this.setUp.isVisible()) await this.setUp.getByRole('button', { name: 'Skip for now' }).click()
  }

  /** Clicks "Sign in to Slack" and closes the window without signing in. */
  async abandonSignIn(): Promise<void> {
    const page = await this.openSignInWindow()
    await page.close()
  }

  /**
   * Clicks "Sign in to Slack" and returns the window it opens. The main
   * window is never taken for it: closing that by mistake leaves the test
   * with no app window.
   */
  private async openSignInWindow(): Promise<Page> {
    const opened = this.app.waitForEvent('window', { predicate: (page) => page !== this.win })
    await this.signInButton.click()
    return opened
  }

  /** Clicks "Use the Slack app's session" and skips "Set up Juno" unless `skipSetUp` is false (as for an import that fails). The app reads the fixture directory it was launched with. */
  async importFromSlackApp(options: { readonly skipSetUp?: boolean } = {}): Promise<void> {
    await this.importButton.click()
    if (options.skipSetUp !== false) await this.skipSetUp()
  }

  /** How many times main asked the keychain for a Slack password; outside tests, each may be a macOS prompt. */
  slackKeychainReads(): Promise<number> {
    return this.app.evaluate(() => (globalThis as unknown as { junoTest: { slackKeychainReads: () => number } }).junoTest.slackKeychainReads())
  }

  async signOut(): Promise<void> {
    await this.accountMenu.open()
    await this.accountMenu.signOutButton.click()
  }

  /** The signed-in window: the sidebar is up, and the account menu names the workspace and user. */
  async expectSignedIn(teamName: string, userName = 'tushar'): Promise<void> {
    await this.sidebar.expectVisible()
    await this.accountMenu.open()
    await expect(this.accountMenu.sessionStatus).toHaveText(`Signed in to ${teamName} as ${userName}`, { timeout: 15_000 })
    await this.accountMenu.close()
  }

  async expectSignedOut(): Promise<void> {
    await expect(this.win.getByRole('heading', { name: "Hi, I'm Juno", exact: true })).toBeVisible({ timeout: 15_000 })
  }

  async expectSessionExpired(): Promise<void> {
    await expect(this.win.getByRole('heading', { name: 'Slack signed you out', exact: true })).toBeVisible({ timeout: 15_000 })
  }

  async expectSignInError(text: string | RegExp): Promise<void> {
    await expect(this.win.getByText(text)).toBeVisible({ timeout: 15_000 })
  }

  /** Wait for a real job pass, including a pass that chooses not to call the model. */
  async workPass(name: Parameters<WorkHooks['workPass']>[0]): Promise<void> {
    const started = performance.now()
    await this.app.evaluate((_electron, job) => (globalThis as unknown as { junoTest: WorkHooks }).junoTest.workPass(job), name)
    if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: work-pass ${Math.round(performance.now() - started)} ms`)
  }

  /**
   * Waits until the engine has finished catching up with Slack, so the rows
   * hold still. The sidebar paints before this; tests that compare rows or
   * measure a hover wait for it first.
   */
  async waitForSync(): Promise<void> {
    const started = performance.now()
    await this.sidebar.expectRows()
    await this.expectEngineLive()
    // Park the pointer and the focus on the workspace. With no tab open that is Home, whose rows sit
    // where a blind click would land, so wait for it and click its greeting, which does nothing.
    const tabOpen = this.win.getByRole('tablist').getByRole('tab', { selected: true })
    await expect(this.home.greeting.or(tabOpen).first()).toBeVisible()
    if (await this.home.greeting.isVisible()) await this.home.greeting.click()
    else await this.win.mouse.click(900, 400)
    if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: sync ${Math.round(performance.now() - started)} ms`)
  }

  /** Switches the theme in Settings › Appearance and waits for the page to follow, then closes Settings. */
  async setTheme(theme: 'Light' | 'Dark'): Promise<void> {
    await this.openSettings('Appearance')
    await this.settings.themeRadio(theme).click()
    await expect(this.settings.themeRadio(theme)).toHaveAttribute('aria-checked', 'true')
    await this.tabs.close('Settings')
    await expect(this.tabs.tab('Settings')).toHaveCount(0)
  }

  /** Settings › General › Hold to peek: ⌥ Option or Space. Closes Settings after. */
  async setPeekKey(key: PeekKeyName): Promise<void> {
    await this.openSettings('General')
    const radio = this.settings.root.getByRole('radiogroup', { name: 'Hold to peek' }).getByRole('radio', { name: key === 'option' ? '⌥ Option' : 'Space' })
    await radio.click()
    await expect(radio).toHaveAttribute('aria-checked', 'true')
    await this.tabs.close('Settings')
    await expect(this.tabs.tab('Settings')).toHaveCount(0)
  }

  /** Settings from the avatar menu, which opens it at General, then `section`. */
  async openSettings(section: SettingsSectionName = 'General'): Promise<void> {
    await this.accountMenu.choose(/^Settings/)
    await this.tabs.expectActive('Settings')
    await expect(this.settings.section('General')).toHaveAttribute('aria-current', 'page')
    if (section !== 'General') await this.settings.show(section)
  }

  /** Settings › Notifications, from the avatar menu's Notifications. */
  async openNotifications(): Promise<void> {
    await this.accountMenu.choose(/^Notifications/)
    await this.tabs.expectActive('Settings')
    await expect(this.settings.section('Notifications')).toHaveAttribute('aria-current', 'page')
  }

  /** The OS notifications main showed (recorded under JUNO_E2E), oldest first. `silent` only on one posted without a sound. */
  osNotifications(): Promise<Array<{ readonly title: string; readonly body: string; readonly silent?: true }>> {
    return this.app.evaluate(() => (globalThis as unknown as { junoTest: { notifications: () => Array<{ title: string; body: string; silent?: true }> } }).junoTest.notifications())
  }

  /** Clicks the OS notification at `index`, as the user would in Notification Center. */
  async clickOsNotification(index: number): Promise<void> {
    await this.app.evaluate((_electron, at) => (globalThis as unknown as { junoTest: { clickNotification: (i: number) => void } }).junoTest.clickNotification(at), index)
  }

  /** What macOS says about Juno's notifications from now on (main's seam); `allowed` at launch. */
  async setNotificationPermission(permission: NotificationPermission): Promise<void> {
    await this.app.evaluate((_electron, value) => {
      ;(globalThis as unknown as { junoTest: { notificationPermission: (p: NotificationPermission) => void } }).junoTest.notificationPermission(value)
    }, permission)
  }

  /** How many times Open Notification Settings opened System Settings. */
  notificationSettingsOpened(): Promise<number> {
    return this.app.evaluate(() => (globalThis as unknown as { junoTest: { notificationSettingsOpened: () => number } }).junoTest.notificationSettingsOpened())
  }

  /** The Mac's idle time from now on, in seconds (main's seam for `powerMonitor`); 0 at launch, a user at the Mac. */
  async setSystemIdle(seconds: number): Promise<void> {
    await this.app.evaluate((_electron, value) => (globalThis as unknown as { junoTest: { systemIdle: (s: number) => void } }).junoTest.systemIdle(value), seconds)
  }

  /** The dock's badge text: "•" with eligible unread items, else empty. */
  dockBadge(): Promise<string> {
    return this.app.evaluate(() => (globalThis as unknown as { junoTest: { dockBadge: () => string } }).junoTest.dockBadge())
  }

  /** How many times the dock icon bounced (main counts them under JUNO_E2E). */
  dockBounces(): Promise<number> {
    return this.app.evaluate(() => (globalThis as unknown as { junoTest: { dockBounces: () => number } }).junoTest.dockBounces())
  }

  /** Whether Juno is the frontmost app, as main's dock bounce reads it. Juno starts frontmost. */
  async setFrontmost(frontmost: boolean): Promise<void> {
    await this.app.evaluate((_electron, value) => (globalThis as unknown as { junoTest: { frontmost: (f: boolean) => void } }).junoTest.frontmost(value), frontmost)
  }

  /** The why popover (inventory 15.4), by its title. */
  whyPopover(title: string | RegExp): Locator {
    return this.win.getByRole('dialog', { name: title })
  }

  /**
   * Waits until the engine is live and its sync cycle has ended: the sidebar
   * is no longer `aria-busy`. A cycle goes on after "Engine live" with work
   * on the background lane (the follow pass), whose Slack calls and row
   * changes would land in the test.
   */
  async expectEngineLive(timeout = 30_000): Promise<void> {
    const started = performance.now()
    await expect(this.sidebar.root).toHaveAttribute('aria-busy', 'false', { timeout })
    if (process.env.JUNO_E2E_TIMINGS === '1') console.log(`e2e timing: engine-live ${Math.round(performance.now() - started)} ms`)
  }

  /** Reads one of the app's performance measures (`@juno/state/perf`), in milliseconds. */
  async measure(name: string): Promise<number | undefined> {
    return this.win.evaluate((measureName) => {
      const entries = performance.getEntriesByName(measureName, 'measure')
      const last = entries[entries.length - 1]
      return last === undefined ? undefined : last.duration
    }, name)
  }

  /** When one of the app's marks (`@juno/state/perf`) was last recorded, on the page's clock; undefined if never. */
  async lastMark(name: string): Promise<number | undefined> {
    return this.win.evaluate((markName) => performance.getEntriesByName(markName, 'mark').at(-1)?.startTime, name)
  }

  /** Every recorded duration of one measure, oldest first. */
  async measures(name: string): Promise<number[]> {
    return this.win.evaluate((measureName) => performance.getEntriesByName(measureName, 'measure').map((entry) => entry.duration), name)
  }

  /**
   * How this launch went, in milliseconds: from the main process's creation
   * to the shell and to the first rows painted, from the sidebar snapshot to
   * those rows, and the longest frame up to a second after them. Call it
   * once the rows are on screen.
   */
  async startupTimes(): Promise<StartupTimes> {
    await expect.poll(() => this.measure('juno.sidebar-rows'), { timeout: 15_000 }).not.toBeUndefined()
    // Let the work queued after the first paint run, so its frames are counted.
    await this.win.waitForTimeout(1_000)
    const created = await this.app.evaluate(({ app }) => app.getAppMetrics().find((metric) => metric.type === 'Browser')?.creationTime ?? 0)
    const page = await this.win.evaluate(async () => {
      const last = (name: string) => performance.getEntriesByName(name, 'measure').at(-1)
      const shell = last('juno.shell-paint')
      const rows = last('juno.sidebar-rows')
      const paint = last('juno.sidebar-paint')
      const frames = await new Promise<ReadonlyArray<PerformanceEntry & { readonly blockingDuration?: number }>>((resolve) => {
        const timer = setTimeout(() => resolve([]), 250)
        const observer = new PerformanceObserver((list) => {
          clearTimeout(timer)
          observer.disconnect()
          resolve(list.getEntries())
        })
        observer.observe({ type: 'long-animation-frame', buffered: true })
      })
      const rowsEnd = rows === undefined ? 0 : rows.startTime + rows.duration
      const early = frames.filter((frame) => frame.startTime < rowsEnd + 1_000)
      const longest = early.reduce<(typeof early)[number] | undefined>((max, frame) => (max === undefined || frame.duration > max.duration ? frame : max), undefined)
      return {
        origin: performance.timeOrigin,
        shellEnd: shell === undefined ? 0 : shell.startTime + shell.duration,
        rowsEnd,
        snapshotToRows: paint?.duration ?? Number.NaN,
        longestFrame: longest?.duration ?? 0,
        longestBlocking: longest?.blockingDuration ?? 0,
        longFrames: early.length,
        rows: document.querySelectorAll('[data-topic-row]').length,
      }
    })
    return {
      mainToShell: page.origin + page.shellEnd - created,
      mainToRows: page.origin + page.rowsEnd - created,
      snapshotToRows: page.snapshotToRows,
      longestFrame: page.longestFrame,
      longestBlocking: page.longestBlocking,
      longFrames: page.longFrames,
      rows: page.rows,
    }
  }
}

export interface StartupTimes {
  readonly mainToShell: number
  readonly mainToRows: number
  readonly snapshotToRows: number
  /** The longest animation frame (over 50 ms) up to a second after the rows painted; 0 when there was none. */
  readonly longestFrame: number
  readonly longestBlocking: number
  readonly longFrames: number
  /** Rows in the list a second after the first paint. */
  readonly rows: number
}

const appOf = new WeakMap<Page, ElectronApplication>()

/** Makes the next native context menu pick `id` without showing (main's JUNO_E2E hook). */
/** What the last native menu showed and where it was asked to open (see `contextMenuForTests` in main). */
async function lastMenu(win: Page): Promise<{ readonly labels: string[]; readonly at: { readonly x: number; readonly y: number } | null }> {
  const app = appOf.get(win)
  if (app === undefined) throw new Error('lastMenu needs the app; use the Juno driver')
  // A menu may wait for the engine before it opens (the why item asks first); wait until it took the chosen item.
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { junoTest: { contextMenu: { next: string | null | undefined } } }).junoTest.contextMenu.next === undefined), { timeout: 10_000 })
    .toBe(true)
  return app.evaluate(() => {
    const menu = (globalThis as unknown as { junoTest: { contextMenu: { lastLabels: string[]; lastAt: { x: number; y: number } | null } } }).junoTest.contextMenu
    return { labels: [...menu.lastLabels], at: menu.lastAt }
  })
}

async function chooseNextMenuItem(win: Page, id: string | null, options: { readonly hold?: boolean } = {}): Promise<void> {
  const app = appOf.get(win)
  if (app === undefined) throw new Error('chooseNextMenuItem needs the app; use the Juno driver')
  await app.evaluate(
    (_electron, { choice, hold }) => {
      const menu = (globalThis as unknown as { junoTest: { contextMenu: { next: string | null | undefined; hold: boolean } } }).junoTest.contextMenu
      menu.next = choice
      menu.hold = hold
    },
    { choice: id, hold: options.hold === true },
  )
}

/** Chooses the item of a menu opened with `hold`, which stayed open until now. */
async function releaseMenu(app: ElectronApplication): Promise<void> {
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { junoTest: { contextMenu: { release: (() => void) | undefined } } }).junoTest.contextMenu.release !== undefined))
    .toBe(true)
  await app.evaluate(() => (globalThis as unknown as { junoTest: { contextMenu: { release: () => void } } }).junoTest.contextMenu.release())
}

const BOTTOM_SLACK = 2
/** The "N new" divider's offset from the list's top on open: the 68px header band, then 80px (inventory 5). */
const DIVIDER_OFFSET = 148

/** The ids of the topic menu's items (inventory 15.1). */
export type TopicMenuItem =
  | 'open-new-tab'
  // Start huddle or Join huddle, in a channel's topics (SPEC 20).
  | 'huddle'
  | 'rename'
  | 'redraw'
  | 'mark-read'
  | 'mark-unread'
  | 'pin'
  | 'unpin'
  | 'resolve'
  | 'reopen'
  | 'copy-link'
  | 'open-in-slack'
  | 'notify-every'
  | 'notify-matters'
  | 'notify-never'
  | 'ignore-channel'
  // What Juno knows about a DM's other person (SPEC 13.8).
  | 'juno-knows'
  // Add to view (inventory 15.8), by the view's id.
  | `view-add:${string}`
  | `view-remove:${string}`
  | 'view-new'

/** The topic shown in the active tab. Hidden tabs stay in the page with `display: none`. */
export type AllTopicsChipName = 'All' | 'Open' | 'Resolved' | 'Quiet' | 'Unfollowed'

/** One row of the All topics table, found by the start of its title. */
export class AllTopicsRow {
  readonly root: Locator

  constructor(
    readonly win: Page,
    readonly title: string,
  ) {
    this.root = win.locator('[data-all-topics-row]').filter({ has: win.locator('[data-row-title]', { hasText: new RegExp(`^${escapeRegExp(title)}`) }) })
  }

  /**
   * The table is a virtual list: only the rows near the viewport are in the
   * page. Scrolls it from the top, a screen at a time, until the row is
   * drawn; false when the whole list has no such row.
   */
  async reveal(): Promise<boolean> {
    const table = this.win.locator('[data-all-topics-table]')
    await table.evaluate((node) => {
      node.scrollTop = 0
    })
    for (;;) {
      await settle(table)
      if ((await this.root.count()) > 0) {
        // A filter that is still applying can take the row away between the count and the scroll: then look again.
        if (await this.root.scrollIntoViewIfNeeded({ timeout: 2_000 }).then(() => true, () => false)) return true
        if ((await this.root.count()) > 0) throw new Error(`All topics row "${this.title}" is drawn but never stable`)
        continue
      }
      if (!(await pageDown(table))) return false
    }
  }

  async expectVisible(): Promise<void> {
    await expect.poll(() => this.reveal(), { timeout: 10_000 }).toBe(true)
  }

  /** The "Sender: text" line under the title, which privacy mode always blurs (the title blurs only while it is first words). */
  get preview(): Locator {
    return this.root.locator('[data-sensitive]:not([data-row-title])')
  }

  async expectAbsent(): Promise<void> {
    await expect.poll(() => this.reveal(), { timeout: 10_000 }).toBe(false)
  }

  /** The status chip in the row: Open, Resolved, Quiet or Unfollowed. */
  async expectStatus(status: Exclude<AllTopicsChipName, 'All'>): Promise<void> {
    await expect.poll(async () => ((await this.reveal()) ? this.root.getByRole('gridcell').nth(2).textContent() : null), { timeout: 10_000 }).toBe(status)
  }

  async expectWhere(name: string): Promise<void> {
    await this.expectVisible()
    await expect(this.root.getByRole('gridcell').nth(1)).toHaveText(name)
  }

  /** Opens the topic with the mouse (rows activate on mouse down); with `newTab`, ⌘-click. */
  async open({ newTab = false }: { readonly newTab?: boolean } = {}): Promise<void> {
    await this.expectVisible()
    const box = await this.root.boundingBox()
    if (!box) throw new Error(`All topics row "${this.title}" is not on screen`)
    await this.win.mouse.move(box.x + 40, box.y + box.height / 2)
    if (newTab) await this.win.keyboard.down('Meta')
    await press(this.win)
    if (newTab) await this.win.keyboard.up('Meta')
  }

  /** Right-click, then `item` in the topic menu. Returns the menu's labels. */
  async chooseInMenu(item: TopicMenuItem): Promise<{ readonly labels: string[]; readonly at: { readonly x: number; readonly y: number } | null }> {
    await this.expectVisible()
    await chooseNextMenuItem(this.win, item)
    await this.root.click({ button: 'right', position: { x: 40, y: 20 } })
    return lastMenu(this.win)
  }
}

/** Two frames for the virtual table to draw the rows a scroll brought in, then until no row on screen waits for its window. */
async function settle(table: Locator): Promise<void> {
  await table.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect.poll(() => table.locator('[aria-busy="true"]').count(), { timeout: 5_000 }).toBe(0)
}

/** Scrolls the table down most of a screen; false at the end. */
function pageDown(table: Locator): Promise<boolean> {
  return table.evaluate((node) => {
    const before = node.scrollTop
    node.scrollTop += Math.floor(node.clientHeight * 0.8)
    return node.scrollTop !== before
  })
}

/** The All topics page (spec section 11): the status chips, the three selects, the text filter and the table. */
export class AllTopicsPane {
  constructor(readonly win: Page) {}

  /** The sidebar title bar's All topics button (SPEC 5). */
  get navItem(): Locator {
    return this.win.locator('header[aria-label="Sidebar title bar"]').getByRole('button', { name: 'All topics' })
  }

  get table(): Locator {
    return this.win.getByRole('grid', { name: 'All topics' })
  }

  get search(): Locator {
    return this.win.getByRole('textbox', { name: 'Filter topics' })
  }

  /** Opens the page from the sidebar title bar's All topics button and waits for its rows. */
  async open(): Promise<void> {
    await this.navItem.click()
    await expect(this.table).toBeVisible()
  }

  row(title: string): AllTopicsRow {
    return new AllTopicsRow(this.win, title)
  }

  chip(name: AllTopicsChipName): Locator {
    return this.win.getByRole('radiogroup', { name: 'Status' }).getByRole('radio', { name: new RegExp(`^${name} \\d+$`) })
  }

  async filterStatus(name: AllTopicsChipName): Promise<void> {
    await this.chip(name).click()
    await expect(this.chip(name)).toHaveAttribute('aria-checked', 'true')
  }

  /** The count after a chip's label. */
  async expectCount(name: AllTopicsChipName, count: number): Promise<void> {
    await expect(this.chip(name)).toHaveText(`${name}${count}`)
  }

  async filterKind(label: 'All' | 'Channels' | 'DMs'): Promise<void> {
    const segment = this.win.getByRole('radiogroup', { name: 'Kind' }).getByRole('radio', { name: label, exact: true })
    await segment.click()
    await expect(segment).toHaveAttribute('aria-checked', 'true')
  }

  /** The place picker's button: "Where: Anywhere", "Where: design-review". */
  get placeButton(): Locator {
    return this.win.getByRole('button', { name: /^Where: / })
  }

  /** The place picker's search field, while its list is open. */
  get placeSearch(): Locator {
    return this.win.getByRole('dialog', { name: 'Pick a place' }).getByRole('textbox')
  }

  /** The open list's row whose name starts with `name`. */
  placeOption(name: string): Locator {
    return this.win.getByRole('dialog', { name: 'Pick a place' }).getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) })
  }

  /** Opens the place picker, types `query`, and picks the row whose name starts with the word `name` ("Anywhere" clears the place). */
  async filterPlace(query: string, name: string): Promise<void> {
    await this.placeButton.click()
    await this.placeSearch.fill(query)
    await this.placeOption(name).click()
    await expect(this.placeSearch).toBeHidden()
    await expect(this.placeButton).toHaveAccessibleName(new RegExp(`^Where: ${escapeRegExp(name)}(\\s|$)`))
  }

  async sort(label: 'Most recent' | 'Oldest first' | 'Most messages'): Promise<void> {
    await this.win.getByRole('combobox', { name: 'Sort' }).selectOption({ label })
  }

  async type(text: string): Promise<void> {
    await this.search.fill(text)
  }

  /** Every row's title in list order, read by scrolling the virtual table from top to bottom. */
  async titles(): Promise<string[]> {
    const table = this.table
    const byIndex = new Map<number, string>()
    await table.evaluate((node) => {
      node.scrollTop = 0
    })
    do {
      await settle(table)
      const seen = await table
        .locator('[data-all-topics-row]')
        .evaluateAll((nodes) => nodes.map((node) => [Number(node.getAttribute('aria-rowindex')), node.querySelector('[data-row-title]')?.textContent ?? ''] as const))
      for (const [index, title] of seen) byIndex.set(index, title)
    } while (await pageDown(table))
    return [...byIndex].toSorted((a, b) => a[0] - b[0]).map(([, title]) => title)
  }

  async expectEmpty(): Promise<void> {
    await expect(this.win.getByText('No topics match these filters.')).toBeVisible()
  }

  async clearFilters(): Promise<void> {
    await this.win.getByRole('button', { name: 'Clear filters' }).click()
  }
}

/**
 * Home's composer (SPEC section 12, "Writing"): Recent, the destination chip
 * above the field, the field, the "Send to" list a first @ or # opens, and
 * the chip's destination list.
 */
export class HomeWritePane {
  readonly root: Locator

  constructor(readonly win: Page) {
    this.root = win.locator('[data-home]').filter({ visible: true })
  }

  get composer(): Locator {
    return this.root.locator('[data-composer] textarea')
  }

  /** The @ or # suggestions above the composer once a person or channel is chosen (inventory 7.1). */
  get suggestions(): Locator {
    return this.root.locator('[data-mention-suggestions]')
  }

  /** The suggestion row whose name starts with `name`. */
  suggestion(name: string): Locator {
    return this.suggestions.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) })
  }

  /** The picked people and channels drawn as chips in the composer's field. */
  get composerChips(): Locator {
    return this.root.locator('[data-composer] [data-mark]')
  }

  /** The composer's field, whose box must not move when a message is sent. */
  get field(): Locator {
    return this.win.locator('[data-composer-field]').filter({ visible: true })
  }

  /** The destination chip above the field: "Send to: Juno", "Send to: Maya Chen", "Send to: #eng". */
  get chip(): Locator {
    return this.root.getByRole('button', { name: /^Send to: / })
  }

  /** The list a first @ or # opens while Juno is chosen. */
  get sendTo(): Locator {
    return this.root.locator('[data-send-to]')
  }

  sendToOption(name: string): Locator {
    return this.sendTo.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) })
  }

  /** Recent: the people and channels you wrote to. */
  get recent(): Locator {
    return this.root.locator('[data-home-recent]')
  }

  /** The Recent row named `name`; a private channel's name goes on with "Private". */
  recentRow(name: string): Locator {
    return this.recent.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}( Private)?$`) })
  }

  /** The chip's destination list. */
  get list(): Locator {
    return this.root.getByRole('dialog', { name: 'Send to' }).getByRole('listbox')
  }

  get search(): Locator {
    return this.root.getByRole('dialog', { name: 'Send to' }).getByRole('textbox')
  }

  /** The row in the destination list named `name`, followed by its sub line ("Direct message"). */
  option(name: string): Locator {
    return this.list.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) })
  }

  async write(text: string): Promise<void> {
    await this.composer.fill(text)
  }

  /** Enter in the composer. */
  async send(): Promise<void> {
    await this.composer.press('Enter')
  }

  /** Opens the destination list, searches it, and picks the row that starts with `name`. */
  async pickConversation(query: string, name: string): Promise<void> {
    if (!(await this.search.isVisible())) await this.chip.click()
    await this.search.fill(query)
    await this.option(name).click()
    await expect(this.list).toBeHidden()
  }

  /** The chip names a destination starting with `label`: "Juno", "Maya" for Maya Chen, "#eng". */
  async expectDestination(label: string): Promise<void> {
    await expect(this.chip).toHaveAccessibleName(new RegExp(`^Send to: ${escapeRegExp(label)}`))
  }

  /** The topic chip right of the destination chip, while a person or channel is chosen: "Topic: Main", "Topic: <thread title>". */
  get topicChip(): Locator {
    return this.root.getByRole('button', { name: /^Topic: / })
  }

  /** The topic chip's list: Main, then the conversation's threads. */
  get topicList(): Locator {
    return this.root.getByRole('dialog', { name: 'Pick a topic' }).getByRole('listbox')
  }

  get topicSearch(): Locator {
    return this.root.getByRole('dialog', { name: 'Pick a topic' }).getByRole('textbox')
  }

  /** The row in the topic list whose title starts with `title`. */
  topicOption(title: string): Locator {
    return this.topicList.getByRole('option', { name: new RegExp(`^${escapeRegExp(title)}`) })
  }

  /** Opens the topic list, searches it, and picks the row that starts with `title`. */
  async pickTopic(query: string, title: string): Promise<void> {
    if (!(await this.topicSearch.isVisible())) await this.topicChip.click()
    await this.topicSearch.fill(query)
    await this.topicOption(title).click()
    await expect(this.topicList).toBeHidden()
  }

  /** The topic chip names `label`: "Main", or the start of a thread's title. */
  async expectTopic(label: string): Promise<void> {
    await expect(this.topicChip).toHaveAccessibleName(new RegExp(`^Topic: ${escapeRegExp(label)}`))
  }
}

export class TopicPane {
  readonly root: Locator

  constructor(readonly win: Page) {
    this.root = win.locator('[data-topic-view]').filter({ visible: true })
  }

  get header() {
    return this.root.locator('[data-topic-header]')
  }

  get list() {
    return this.root.getByRole('list', { name: 'Messages' })
  }

  get scroller() {
    return this.root.locator('[data-scroll]')
  }

  get divider() {
    return this.root.locator('[data-new-divider]')
  }

  /**
   * Right-clicks the message that starts with `text` and picks `item` in its
   * menu; on its sender's name with `onSender`. Returns the menu's labels.
   */
  async chooseInMessageMenu(text: string, item: string | null, options: { readonly onSender?: boolean } = {}): Promise<{ readonly labels: string[] }> {
    await chooseNextMenuItem(this.win, item)
    const message = this.message(text)
    await message.scrollIntoViewIfNeeded()
    await (options.onSender === true ? message.locator('[data-sender]').last() : message).click({ button: 'right' })
    return lastMenu(this.win)
  }

  /** A message by the start of its text. */
  message(text: string): Locator {
    return this.list.locator('[data-message-row]').filter({ hasText: text })
  }

  /** The composer's text field. */
  get composer(): Locator {
    return this.root.locator('[data-composer] textarea')
  }

  /** Moves the composer's caret to the end of its text: ⌘↓ on macOS, where End only scrolls, and Ctrl+End elsewhere. */
  async caretToEnd(): Promise<void> {
    await this.composer.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  }

  /** The @ or # suggestions above the composer (inventory 7.1). */
  get suggestions(): Locator {
    return this.root.locator('[data-mention-suggestions]')
  }

  /** The suggestion row whose name starts with `name`. */
  suggestion(name: string): Locator {
    return this.suggestions.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) })
  }

  /** The picked people and channels drawn as chips in the composer's field. */
  get composerChips(): Locator {
    return this.root.locator('[data-composer] [data-mark]')
  }

  /** The links drawn in the composer's field: typed URLs and linked words. */
  get composerLinks(): Locator {
    return this.root.locator('[data-composer] [data-mark="link"]')
  }

  /** The link editor ⌘K opens on words selected in the composer. */
  get linkEditor() {
    const root = this.root.locator('[data-link-editor]')
    return { root, url: root.getByRole('textbox', { name: 'Link' }), remove: root.getByRole('button', { name: 'Remove' }) }
  }

  /** The composer's box, which must not move as rows come and go. */
  get composerField(): Locator {
    return this.root.locator('[data-composer-field]')
  }

  /** Types `text` into the composer and presses Enter. */
  async send(text: string): Promise<void> {
    await this.composer.fill(text)
    await this.composer.press('Enter')
  }

  /** The bar a check on send shows inside the composer (spec section 8). */
  get checkBar() {
    const bar = this.root.locator('[data-send-check]')
    return {
      bar,
      /** Picks one of its two choices by name: Post in thread, Send to Main, Fix and send, Send as is. */
      choose: (name: string) => bar.getByRole('button', { name: new RegExp(`^${name}`) }).click(),
    }
  }

  /** The amber line that warns about hiring or people details in a public channel. */
  get audienceWarning(): Locator {
    return this.root.locator('[data-audience-warning]')
  }

  /** The message is shown as Slack holds it: once, and not pending. */
  async expectSent(text: string): Promise<void> {
    await expect(this.message(text)).toHaveCount(1, { timeout: 15_000 })
    await expect(this.message(text)).not.toHaveAttribute('data-pending', /.*/, { timeout: 15_000 })
  }

  /** A failed send's row, with its Retry and Delete draft. */
  failed(text: string) {
    const row = this.message(text).and(this.list.locator('[data-pending="failed"]'))
    return {
      row,
      retry: () => row.getByRole('button', { name: 'Retry' }).click(),
      discard: () => row.getByRole('button', { name: 'Delete draft' }).click(),
    }
  }

  async expectTitle(title: string | RegExp): Promise<void> {
    await expect(this.header).toContainText(title, { timeout: 15_000 })
  }

  async expectMessage(text: string): Promise<void> {
    await expect(this.message(text)).toBeVisible({ timeout: 15_000 })
  }

  /** The context pill, a button named by the channel and its kind. */
  get contextPill() {
    return this.header.locator('[data-island="left"]').getByRole('button').first()
  }

  /** The title, a menu button inside the page's heading. */
  /** The title: opens the topic switcher; a right-click opens the topic menu. */
  get titleButton() {
    return this.header.getByRole('heading').getByRole('button')
  }

  /** The right island's ⋯, which opens the topic menu. */
  get moreButton() {
    return this.header.getByRole('button', { name: 'More', exact: true })
  }

  /**
   * Clicks the title and picks `item` in the topic menu. Returns the menu's
   * labels ("-" a separator, "(label)" disabled, "label ✓" checked, "> "
   * before a submenu's items) and where it was asked to open.
   */
  /** Opens the topic menu from ⋯ and picks `item`. */
  async chooseInMenu(item: TopicMenuItem): Promise<{ readonly labels: string[]; readonly at: { readonly x: number; readonly y: number } | null }> {
    await chooseNextMenuItem(this.win, item)
    await this.moreButton.click()
    return lastMenu(this.win)
  }

  /** The right island's Follow, on a thread you do not follow: a click follows it. */
  get followButton() {
    return this.header.getByRole('button', { name: 'Follow', exact: true })
  }

  /** Clicks Follow and waits for it to give way. Answers whether a native menu opened on the way (none should). */
  async follow(): Promise<{ readonly menuOpened: boolean }> {
    const app = appOf.get(this.win)
    if (app === undefined) throw new Error('follow needs the app; use the Juno driver')
    // A menu that opens takes the armed choice; with none, it is still armed afterwards.
    await chooseNextMenuItem(this.win, 'no-menu-expected')
    await this.followButton.click()
    await expect(this.followButton).toHaveCount(0, { timeout: 10_000 })
    const menuOpened = await app.evaluate(() => {
      const menu = (globalThis as unknown as { junoTest: { contextMenu: { next: string | null | undefined } } }).junoTest.contextMenu
      const taken = menu.next !== 'no-menu-expected'
      menu.next = undefined
      return taken
    })
    return { menuOpened }
  }

  /** Opens the topic menu by right-clicking the title and picks `item`. */
  async chooseInTitleMenu(item: TopicMenuItem): Promise<{ readonly labels: string[]; readonly at: { readonly x: number; readonly y: number } | null }> {
    await chooseNextMenuItem(this.win, item)
    await this.titleButton.click({ button: 'right' })
    return lastMenu(this.win)
  }

  /**
   * The "N new" divider sits right before the message that starts with
   * `text`, 80px below the header band (148px from the top of the list,
   * which runs under the band), or as near as the list can scroll when the
   * topic is short.
   */
  async expectDividerBefore(text: string): Promise<void> {
    await expect(this.root.locator('[data-new-divider] + [data-message-row]')).toContainText(text, { timeout: 15_000 })
    const { offset, scrollTop, max } = await this.scroller.evaluate((scroller) => {
      const divider = scroller.querySelector('[data-new-divider]')
      if (divider === null) throw new Error('No divider')
      return {
        offset: divider.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
        scrollTop: scroller.scrollTop,
        max: scroller.scrollHeight - scroller.clientHeight,
      }
    })
    if (scrollTop > 0.5 && scrollTop < max - 0.5) expect(Math.abs(offset - DIVIDER_OFFSET)).toBeLessThanOrEqual(2)
    else expect(offset).toBeGreaterThanOrEqual(0)
  }

  /** How far the divider is from the top of the list, in CSS pixels. */
  dividerOffset(): Promise<number> {
    return this.scroller.evaluate((scroller) => {
      const divider = scroller.querySelector('[data-new-divider]')
      if (divider === null) throw new Error('No divider')
      return divider.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    })
  }

  async expectNew(count: number): Promise<void> {
    await expect(this.divider).toHaveText(`${count} new`)
  }

  async expectNoDivider(): Promise<void> {
    await expect(this.divider).toHaveCount(0)
  }

  distanceFromBottom(): Promise<number> {
    return this.scroller.evaluate((scroller) => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
  }

  /**
   * Reads the shown list's distance from the bottom on every frame until the
   * returned function is called, which answers with one value per frame
   * that had message rows, so a test can check the first painted frame.
   */
  async watchBottom(): Promise<() => Promise<number[]>> {
    await this.win.evaluate(() => {
      const w = window as unknown as { __bottomFrames?: { distances: number[]; on: boolean } }
      const state = { distances: [] as number[], on: true }
      w.__bottomFrames = state
      const tick = () => {
        const scroller = [...document.querySelectorAll<HTMLElement>('[data-topic-view] [data-scroll]')].find((node) => node.offsetParent !== null)
        if (scroller !== undefined && scroller.querySelector('[data-message-row]') !== null) state.distances.push(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
        if (state.on) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    return () =>
      this.win.evaluate(() => {
        const state = (window as unknown as { __bottomFrames: { distances: number[]; on: boolean } }).__bottomFrames
        state.on = false
        return state.distances
      })
  }

  async expectAtBottom(): Promise<void> {
    await expect.poll(() => this.distanceFromBottom(), { timeout: 5_000 }).toBeLessThanOrEqual(BOTTOM_SLACK)
  }

  /**
   * Scrolls the list up by `pixels` with the mouse wheel over it, as a user
   * does, and waits for the scroll to settle. The wheel is what lets go of
   * the list's hold on the bottom; a scroll set from a script does not, and a
   * commit that adds rows before it settles puts the bottom back.
   */
  async scrollUp(pixels: number): Promise<void> {
    const box = await this.scroller.boundingBox()
    if (box === null) throw new Error('No message list to scroll')
    await this.win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    type Watched = HTMLElement & { scrollEnded?: Promise<void> }
    // The listener is in place before the wheel turns: the wheel reaches the page by another path than evaluate.
    await this.scroller.evaluate((scroller: Watched) => {
      scroller.scrollEnded = new Promise((resolve) => scroller.addEventListener('scrollend', () => resolve(), { once: true }))
    })
    await this.win.mouse.wheel(0, -pixels)
    await this.scroller.evaluate((scroller: Watched) => scroller.scrollEnded)
  }

  async scrollToBottom(): Promise<void> {
    await this.scrollTo('bottom')
  }

  async scrollToTop(): Promise<void> {
    await this.scrollTo('top')
  }

  private async scrollTo(where: 'top' | 'bottom'): Promise<void> {
    await this.scroller.evaluate(
      (scroller, target) =>
        new Promise<void>((resolve) => {
          const max = scroller.scrollHeight - scroller.clientHeight
          const to = target === 'top' ? 0 : max
          if (Math.abs(Math.min(max, Math.max(0, to)) - scroller.scrollTop) < 1) return resolve()
          scroller.addEventListener('scrollend', () => resolve(), { once: true })
          scroller.scrollTop = to
        }),
      where,
    )
  }

  /** The "N new messages" or "Jump to latest" pill over the bottom of the list. */
  get pill() {
    return this.root.getByRole('button', { name: /new message|Jump to latest/ })
  }

  async expectPill(text: string): Promise<void> {
    await expect(this.pill).toHaveText(text)
  }

  async expectNoPill(): Promise<void> {
    await expect(this.pill).toHaveCount(0)
  }

  async jumpToLatest(): Promise<void> {
    await this.pill.click()
  }

  /** Waits for the open topic's rows; if it opened at its "N new" divider, jumps to the latest. Ends at the bottom. */
  async toLatest(): Promise<void> {
    await expect(this.divider.or(this.list.locator('[data-message-row]').last()).first()).toBeVisible({ timeout: 15_000 })
    if ((await this.divider.count()) > 0) await this.jumpToLatest()
    await this.expectAtBottom()
  }

  /** A "2 replies · Title" link under a Main message, by its label or title. */
  threadLink(text: string | RegExp): ThreadLinkDriver {
    return new ThreadLinkDriver(this.win, this.list.getByRole('button', { name: text }))
  }

  /** A #channel chip in a message: clicking it scopes the sidebar. */
  async clickChannel(name: string): Promise<void> {
    await this.list.getByRole('button', { name: `#${name}` }).first().click()
  }

  /** Main's "Threads" button and its popover. */
  /** Opens the topic switcher from the title. */
  async openSwitcher(): Promise<TopicSwitcherDriver> {
    await this.titleButton.click()
    const switcher = new TopicSwitcherDriver(this.win)
    await expect(switcher.root).toBeVisible()
    return switcher
  }

  /** Focuses the title and opens the switcher with Enter. */
  async openSwitcherWithKeyboard(): Promise<TopicSwitcherDriver> {
    await this.titleButton.focus()
    await this.win.keyboard.press('Enter')
    const switcher = new TopicSwitcherDriver(this.win)
    await expect(switcher.root).toBeVisible()
    return switcher
  }

  /** The first message row in view and its top, for checking that nothing moved. */
  firstVisibleRow(): Promise<{ readonly ts: string; readonly top: number }> {
    return this.scroller.evaluate((scroller) => {
      const box = scroller.getBoundingClientRect()
      for (const row of scroller.querySelectorAll<HTMLElement>('[data-message-row]')) {
        const top = row.getBoundingClientRect().top
        if (top >= box.top) return { ts: row.dataset['messageRow'] ?? '', top }
      }
      throw new Error('No row in view')
    })
  }

  /** The top of the row with `ts`. */
  rowTop(ts: string): Promise<number> {
    return this.scroller.evaluate((scroller, key) => {
      const row = scroller.querySelector(`[data-message-row="${CSS.escape(key)}"]`)
      if (row === null) throw new Error(`No row ${key}`)
      return row.getBoundingClientRect().top
    }, ts)
  }

  /** At least one image thumbnail in view has its bytes, served by main from the Slack session. */
  async expectThumbnailsLoaded(): Promise<void> {
    await expect
      .poll(() => this.list.locator('[data-thumbnail] img[src^="juno://files/"]').evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length), { timeout: 15_000 })
      .toBeGreaterThan(0)
  }

  rowCount(): Promise<number> {
    return this.list.locator('[data-message-row]').count()
  }
}

export class ThreadLinkDriver {
  constructor(
    readonly win: Page,
    readonly root: Locator,
  ) {}

  /** Mouse down on the link. */
  async open(options: { readonly newTab?: boolean } = {}): Promise<void> {
    await this.root.scrollIntoViewIfNeeded()
    const box = await this.root.boundingBox()
    if (!box) throw new Error('Thread link is not on screen')
    if (options.newTab) await this.win.keyboard.down('Meta')
    await this.win.mouse.move(box.x + 8, box.y + box.height / 2)
    await press(this.win)
    if (options.newTab) await this.win.keyboard.up('Meta')
  }

  /** Points at the link and holds the peek key. `juno.peek.release()` lets go. */
  async peek(key: PeekKeyName = 'option'): Promise<void> {
    await this.root.scrollIntoViewIfNeeded()
    await this.root.hover({ position: { x: 8, y: 8 } })
    await this.win.keyboard.down(peekKeys[key])
  }
}

/** The title's topic switcher: a search field over the channel's Main and threads. */
export class TopicSwitcherDriver {
  readonly root: Locator

  constructor(readonly win: Page) {
    this.root = win.getByRole('dialog', { name: 'Topics in this channel' })
  }

  get search(): Locator {
    return this.root.getByRole('textbox', { name: 'Search this channel' })
  }

  /** A row, by the start of its title ("Main" for Main). */
  row(title: string): Locator {
    return this.root.getByRole('option', { name: new RegExp(`^${escapeRegExp(title)}`) })
  }

  /** Row titles, top to bottom. */
  titles(): Promise<string[]> {
    return this.root.getByRole('option').evaluateAll((rows) => rows.map((row) => (row.querySelector('span span')?.textContent ?? row.textContent ?? '').trim()))
  }

  /** Mouse down on a row; with `newTab`, ⌘ held. */
  async open(title: string, options: { readonly newTab?: boolean } = {}): Promise<void> {
    const row = this.row(title)
    await row.scrollIntoViewIfNeeded()
    const box = await row.boundingBox()
    if (!box) throw new Error(`No topic "${title}" in the switcher`)
    if (options.newTab) await this.win.keyboard.down('Meta')
    await this.win.mouse.move(box.x + 24, box.y + box.height / 2)
    await press(this.win)
    if (options.newTab) await this.win.keyboard.up('Meta')
  }

  async type(text: string): Promise<void> {
    await this.search.fill(text)
  }
}

/** The tab strip over the workspace. */

/** A tab's close button: the tab's sibling in its box, not its child. */
const closeOf = (tab: Locator): Locator => tab.locator('xpath=..').getByRole('button', { name: 'Close tab' })

export class TabStrip {
  readonly root: Locator

  constructor(
    readonly app: ElectronApplication,
    readonly win: Page,
  ) {
    this.root = win.getByRole('tablist')
  }

  tab(title: string): Locator {
    return this.root.getByRole('tab', { name: new RegExp(`^${escapeRegExp(title)}`) })
  }

  /** The `index`th tab titled `title`, left to right, when several show the same place. */
  nth(title: string, index: number): Locator {
    return this.tab(title).nth(index)
  }

  /** The `index`th of the tabs titled `title` is the active one. */
  async expectActiveAt(title: string, index: number): Promise<void> {
    await expect(this.nth(title, index)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
  }

  /** Mouse down on the `index`th tab titled `title`. */
  async selectAt(title: string, index: number): Promise<void> {
    const box = await this.nth(title, index).boundingBox()
    if (!box) throw new Error(`No tab "${title}" at ${index}`)
    await this.win.mouse.move(box.x + 24, box.y + box.height / 2)
    await press(this.win)
  }

  /** The close button on the `index`th tab titled `title`. */
  async closeAt(title: string, index: number): Promise<void> {
    const tab = this.nth(title, index)
    await tab.hover()
    await closeOf(tab).click()
  }

  /** Points at a tab. */
  hover(title: string): Promise<void> {
    return pointAt(this.win, this.tab(title))
  }

  /**
   * Drags the tab titled `title` with the real mouse until its left edge is
   * over the left edge of the tab titled `onto`, in small steps, then drops it.
   */
  async drag(title: string, onto: string): Promise<void> {
    const from = await this.tab(title).boundingBox()
    const to = await this.tab(onto).boundingBox()
    if (!from || !to) throw new Error(`No tab "${title}" or "${onto}"`)
    const y = from.y + from.height / 2
    await this.win.mouse.move(from.x + 24, y)
    await this.win.mouse.down()
    await this.win.mouse.move(to.x + 24, y, { steps: 20 })
    await this.win.mouse.up()
  }

  /** What a screen reader last heard about a tab's move. */
  get announcement(): Locator {
    return this.win.locator('[data-tab-announce]')
  }

  /** The art or photo in a tab's icon slot. */
  tile(title: string): Locator {
    return this.tab(title).locator('[data-topic-art], img')
  }

  /** Tab titles, left to right. */
  titles(): Promise<string[]> {
    return this.root.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tooltip') ?? ''))
  }

  async expectCount(count: number): Promise<void> {
    await expect(this.root.getByRole('tab')).toHaveCount(count, { timeout: 15_000 })
  }

  async expectActive(title: string): Promise<void> {
    await expect(this.tab(title)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
  }

  /** Mouse down on a tab. */
  async select(title: string): Promise<void> {
    const box = await this.tab(title).boundingBox()
    if (!box) throw new Error(`No tab "${title}"`)
    await this.win.mouse.move(box.x + 24, box.y + box.height / 2)
    await press(this.win)
  }

  /** The close button on a tab. */
  async close(title: string): Promise<void> {
    await this.tab(title).hover()
    await closeOf(this.tab(title)).click()
  }

  /** Focuses a tab and presses Delete. The close buttons are not Tab stops. */
  async closeWithKeyboard(title: string): Promise<void> {
    await this.tab(title).focus()
    await this.win.keyboard.press('Delete')
  }

  async expectFocused(title: string): Promise<void> {
    await expect(this.tab(title)).toBeFocused()
  }

  /** The "+" after the last tab: a new tab with Home. */
  get newTabButton() {
    return this.win.getByRole('region', { name: 'Workspace' }).getByRole('button', { name: 'New tab ⌘T' })
  }

  /** An item of the app menu, as its shortcut would choose it. */
  async menu(id: AppMenuItem): Promise<void> {
    await clickAppMenu(this.app, id)
  }

  /**
   * ⌘N or ⌘T as a user presses it: the key's keydown reaches the page, then
   * main runs the menu item. Key presses here never reach Electron's menu
   * accelerators on Linux, so the keydown is sent to the page and the item
   * clicked after it. `menu` alone skips the keydown, so keys typed at once
   * could reach the page before the command, which a real ⌘N never allows.
   */
  async shortcut(id: 'new-message' | 'new-tab'): Promise<void> {
    await this.win.evaluate((key) => {
      const target = document.activeElement ?? document.body
      target.dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true }))
    }, id === 'new-message' ? 'n' : 't')
    await clickAppMenu(this.app, id)
  }

  /** Right-clicks a tab and picks `item` in the tab menu. Returns the menu's labels, "-" for a separator and "(label)" for a disabled item. */
  async contextMenu(title: string, item: 'pin' | 'close' | 'close-others' | 'close-right' | 'close-all' | 'copy-link' | 'open-in-slack'): Promise<string[]> {
    await chooseNextMenuItem(this.win, item)
    await this.tab(title).click({ button: 'right' })
    return this.app.evaluate(() => [...(globalThis as unknown as { junoTest: { contextMenu: { lastLabels: string[] } } }).junoTest.contextMenu.lastLabels])
  }

  async expectPinned(title: string, pinned = true): Promise<void> {
    if (pinned) await expect(this.tab(title)).toHaveAttribute('data-pinned', '')
    else await expect(this.tab(title)).not.toHaveAttribute('data-pinned')
  }

  /** The soft grey dot of an inactive tab whose topic has unread messages. */
  async expectUnread(title: string, unread = true): Promise<void> {
    const tab = this.tab(title)
    if (unread) await expect(tab).toHaveAttribute('data-unread', '', { timeout: 15_000 })
    else await expect(tab).not.toHaveAttribute('data-unread', { timeout: 15_000 })
  }

  /** Whether the tab shows a close button. */
  closeButton(title: string): Locator {
    return closeOf(this.tab(title))
  }
}

/** App menu items the tests click, as their shortcuts would. */
export type AppMenuItem =
  | 'close-tab'
  | 'next-tab'
  | 'previous-tab'
  | 'next-tab-control'
  | 'previous-tab-control'
  | 'new-tab'
  | 'new-message'
  | 'reopen-tab'
  | 'back'
  | 'forward'
  | 'toggle-sidebar'
  | 'toggle-privacy'
  | 'juno'
  | 'search'
  | 'undo'
  | 'tour'
  | `tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'tab-last'

async function clickAppMenu(app: ElectronApplication, id: AppMenuItem): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) throw new Error(`No menu item ${itemId}`)
    item.click(undefined, BrowserWindow.getAllWindows()[0])
  }, id)
}

/**
 * The welcome card (SPEC 4, "The welcome"): three things to try on Home,
 * by itself once per workspace when the sidebar has rows (only in apps
 * launched with `tour: true`), and again from Help, ⌘K or Settings › About.
 */
export class WelcomeDriver {
  readonly root: Locator

  constructor(
    readonly app: ElectronApplication,
    readonly win: Page,
  ) {
    // The card's room can stay on Home, empty and hidden; this is the card on screen.
    this.root = win.locator('[data-home]').filter({ visible: true }).locator('section[data-welcome]').filter({ visible: true })
  }

  get heading(): Locator {
    return this.root.getByRole('heading', { level: 3 })
  }

  /** Hide, or Done once all three are ticked. */
  get close(): Locator {
    return this.root.locator('[data-welcome-close]')
  }

  hint(name: 'peek' | 'tab' | 'juno'): Locator {
    return this.root.locator(`[data-welcome-hint="${name}"]`)
  }

  async expectShown(): Promise<void> {
    await expect(this.root).toBeVisible({ timeout: 15_000 })
  }

  async expectGone(): Promise<void> {
    await expect(this.root).toHaveCount(0)
  }

  /** Exactly these hints are ticked. */
  async expectTicked(...names: ReadonlyArray<'peek' | 'tab' | 'juno'>): Promise<void> {
    for (const name of ['peek', 'tab', 'juno'] as const) {
      if (names.includes(name)) await expect(this.hint(name)).toHaveAttribute('data-done', '')
      else await expect(this.hint(name)).not.toHaveAttribute('data-done')
    }
  }

  /** The whole card is on screen above Home's field, without scrolling. */
  async expectWholeAboveField(): Promise<void> {
    const card = await this.root.boundingBox()
    const chip = await this.win.locator('[data-home]').filter({ visible: true }).getByRole('button', { name: /^Send to: / }).boundingBox()
    const viewport = this.win.viewportSize()
    if (card === null || chip === null) throw new Error('No card or no field')
    expect(card.y).toBeGreaterThanOrEqual(0)
    expect(card.y + card.height).toBeLessThanOrEqual(chip.y)
    if (viewport !== null) expect(card.x + card.width).toBeLessThanOrEqual(viewport.width)
  }

  /** Help › Show the Tour, through its app menu item. */
  async openFromHelp(): Promise<void> {
    await clickAppMenu(this.app, 'tour')
    await this.expectShown()
  }
}

/** ⌘K (spec section 10): the search and command palette. */
export class PaletteDriver {
  readonly root: Locator

  constructor(
    readonly app: ElectronApplication,
    readonly win: Page,
  ) {
    this.root = win.getByRole('dialog', { name: 'Search and commands' })
  }

  get input(): Locator {
    return this.root.getByRole('combobox')
  }

  /** ⌘K, through its app menu item (Go › Search…). */
  async shortcut(): Promise<void> {
    await clickAppMenu(this.app, 'search')
  }

  async open(): Promise<void> {
    await this.shortcut()
    await this.expectOpen()
  }

  async expectOpen(): Promise<void> {
    await expect(this.root).toBeVisible({ timeout: 10_000 })
    await expect(this.input).toBeFocused()
  }

  /** One of the two tabs in the segmented control. */
  tab(name: 'Conversations' | 'Messages'): Locator {
    return this.root.getByRole('radio', { name })
  }

  async expectTab(name: 'Conversations' | 'Messages'): Promise<void> {
    await expect(this.tab(name)).toHaveAttribute('aria-checked', 'true')
    await expect(this.input).toBeFocused()
  }

  /** ⌘K, then Tab to the Messages tab: the message search. */
  async openMessages(): Promise<void> {
    await this.open()
    await this.expectTab('Conversations')
    await this.press('Tab')
    await this.expectTab('Messages')
  }

  async expectClosed(): Promise<void> {
    await expect(this.root).toHaveCount(0)
  }

  /** Types into the field, a key at a time as a person does. */
  async type(text: string): Promise<void> {
    await this.input.pressSequentially(text)
  }

  /** Local results now belong to the current input, rather than the held previous query. */
  async expectResults(): Promise<void> {
    await expect(this.root.getByRole('listbox')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 })
  }

  async clear(): Promise<void> {
    await this.input.fill('')
  }

  async press(key: string): Promise<void> {
    await this.input.press(key)
  }

  /** A section of rows: Frequent, Conversations, Pages, Settings, Commands, the open topic's name, Recent, Results or Juno. */
  section(heading: string): Locator {
    return this.root.getByRole('group', { name: heading })
  }

  /** Rows whose text matches, label and sub line included. */
  row(text: string | RegExp): Locator {
    return this.root.getByRole('option').filter({ hasText: text })
  }

  rows(): Locator {
    return this.root.getByRole('option')
  }

  /** The text of the row the arrows or the pointer chose. */
  async activeText(): Promise<string> {
    return this.input.evaluate((input) => {
      const id = input.getAttribute('aria-activedescendant')
      const row = id === null ? null : input.ownerDocument.getElementById(id)
      return (row?.innerText ?? '').replace(/\s+/g, ' ').trim()
    })
  }

  async expectActive(text: string | RegExp): Promise<void> {
    await expect.poll(() => this.activeText(), { timeout: 10_000 }).toMatch(text)
  }

  /** Picks a row with the pointer; ⌘-click with `newTab`. */
  async choose(text: string | RegExp, options: { readonly newTab?: boolean } = {}): Promise<void> {
    const row = this.row(text).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click(options.newTab === true ? { modifiers: ['Meta'] } : {})
  }

  /** Right-clicks a row: the channel menu opens, and the next native menu picks `id`. */
  async chooseFromMenu(text: string | RegExp, id: string): Promise<void> {
    await chooseNextMenuItem(this.win, id)
    await this.row(text).first().click({ button: 'right' })
  }

  async expectNoMatches(): Promise<void> {
    await expect(this.root.getByText('No matches.')).toBeVisible({ timeout: 15_000 })
  }
}

/** Back and Forward: the title bar buttons, the app menu (⌘[ and ⌘]), the mouse's side buttons and the swipe. */
export class Navigation {
  constructor(
    readonly app: ElectronApplication,
    readonly win: Page,
  ) {}

  /** The visible Back button: in the sidebar's bar, or in the tab strip while the sidebar is hidden. */
  get backButton(): Locator {
    return this.win.getByRole('button', { name: 'Back ⌘[' }).locator('visible=true')
  }

  get forwardButton(): Locator {
    return this.win.getByRole('button', { name: 'Forward ⌘]' }).locator('visible=true')
  }

  async back(): Promise<void> {
    await this.backButton.click()
  }

  async forward(): Promise<void> {
    await this.forwardButton.click()
  }

  async menu(id: 'back' | 'forward'): Promise<void> {
    await clickAppMenu(this.app, id)
  }

  /** The mouse's back (3) or forward (4) button. Playwright's mouse has neither, so the event is sent as the page would get it. */
  async mouseButton(button: 3 | 4): Promise<void> {
    await this.win.evaluate((which) => window.dispatchEvent(new MouseEvent('mouseup', { button: which })), button)
  }

  /** The three-finger swipe, as macOS reports it to the window. */
  async swipe(direction: 'left' | 'right'): Promise<void> {
    await this.app.evaluate(({ BrowserWindow }, way) => {
      BrowserWindow.getAllWindows()[0]?.emit('swipe', {}, way)
    }, direction)
  }

  async expectCanGo(back: boolean, forward: boolean): Promise<void> {
    if (back) await expect(this.backButton).toBeEnabled()
    else await expect(this.backButton).toBeDisabled()
    if (forward) await expect(this.forwardButton).toBeEnabled()
    else await expect(this.forwardButton).toBeDisabled()
  }
}

/** The sidebar's width and hidden state, driven through its edge, its button and View › Hide Sidebar. */
export class SidebarFrame {
  readonly sidebar: Locator
  readonly edge: Locator

  constructor(
    readonly app: ElectronApplication,
    readonly win: Page,
  ) {
    this.sidebar = win.getByRole('complementary', { name: 'Sidebar' })
    this.edge = win.getByRole('separator', { name: 'Resize sidebar' })
  }

  async width(): Promise<number> {
    const box = await this.sidebar.boundingBox()
    if (!box) throw new Error('The sidebar is not shown')
    return Math.round(box.width)
  }

  async expectWidth(width: number): Promise<void> {
    await expect.poll(() => this.width()).toBe(width)
  }

  /** Drags the edge by `dx` pixels in `steps` pointer moves. */
  async drag(dx: number, steps = 10): Promise<void> {
    const box = await this.edge.boundingBox()
    if (!box) throw new Error('No sidebar edge')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await this.win.mouse.move(x, y)
    await this.win.mouse.down()
    await this.win.mouse.move(x + dx, y, { steps })
    await this.win.mouse.up()
  }

  async doubleClickEdge(): Promise<void> {
    await this.edge.dblclick()
  }

  /** The title bar button that hides or shows the sidebar. */
  async toggleWithButton(): Promise<void> {
    await this.win.getByRole('button', { name: /^(Hide|Show) sidebar/ }).locator('visible=true').click()
  }

  async toggleWithMenu(): Promise<void> {
    await clickAppMenu(this.app, 'toggle-sidebar')
  }

  async expectHidden(hidden = true): Promise<void> {
    if (hidden) await expect(this.sidebar).toBeHidden()
    else await expect(this.sidebar).toBeVisible()
  }

  /** View › Hide Sidebar's label, which names what it will do. */
  async menuLabel(): Promise<string | undefined> {
    return this.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('toggle-sidebar')?.label)
  }
}

/** Privacy mode (SPEC section 5): blurred message text, the sidebar footer, View › Hide Message Text. */
export class PrivacyMode {
  constructor(
    readonly app: ElectronApplication,
    readonly win: Page,
  ) {}

  /** The sidebar footer that says the mode is on. */
  get footer(): Locator {
    return this.win.getByRole('complementary', { name: 'Sidebar' }).getByRole('status').filter({ hasText: 'Message text hidden' })
  }

  get showButton(): Locator {
    return this.footer.getByRole('button', { name: 'Show message text' })
  }

  /** The CSS filter on an element: `blur(6px)` while hidden, `none` otherwise. */
  filterOf(target: Locator): Promise<string> {
    return target.evaluate((node) => getComputedStyle(node).filter)
  }

  async expectBlurred(target: Locator, blurred = true): Promise<void> {
    await expect.poll(() => this.filterOf(target)).toBe(blurred ? 'blur(6px)' : 'none')
  }

  /** ⌃⌘H through View, and waits until main has the change (the menu names the other action). */
  async toggleWithMenu(): Promise<void> {
    const before = await this.menuLabel()
    await clickAppMenu(this.app, 'toggle-privacy')
    await expect.poll(() => this.menuLabel()).not.toBe(before)
  }

  /** View › Hide or Show Message Text, which names what it will do. */
  menuLabel(): Promise<string | undefined> {
    return this.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('toggle-privacy')?.label)
  }

  /** The footer's text: "Message text hidden", or "… while sharing" when sharing turned it on. */
  footerText(): Promise<string> {
    return this.footer.getByText(/^Message text hidden/).innerText()
  }

  /** Another app starts capturing the screen, as main's screen watch would see it (the JUNO_E2E seam). */
  async startSharing(): Promise<void> {
    await this.screenShared(true)
  }

  /** The capture ends. */
  async stopSharing(): Promise<void> {
    await this.screenShared(false)
  }

  /** Moves the screen watch's clock on, as if the signal had stayed as it is for that long. */
  async elapse(ms: number): Promise<void> {
    await this.app.evaluate((_electron, by) => (globalThis as unknown as { junoTest: { screenWatchElapse: (ms: number) => void } }).junoTest.screenWatchElapse(by), ms)
  }

  private async screenShared(shared: boolean): Promise<void> {
    await this.app.evaluate((_electron, value) => (globalThis as unknown as { junoTest: { screenShared: (shared: boolean) => Promise<void> } }).junoTest.screenShared(value), shared)
  }
}

export type HomeItemKind = 'waiting' | 'mentioned' | 'resume' | 'moved' | 'followUp' | 'ask' | 'automated' | 'tidyUp' | 'automatedMoves' | 'doneFollowUps' | 'oldDrafts' | 'unfollow' | 'ignore'

/** Home (SPEC section 12): the greeting and the rows, in the visible page. Its composer is `HomeWritePane`. */
export class HomePane {
  constructor(readonly win: Page) {}

  get root(): Locator {
    return this.win.locator('[data-home]:not([data-home-waiting]):not([data-home-loading])').filter({ visible: true })
  }

  get greeting(): Locator {
    return this.root.getByRole('heading', { level: 2 })
  }

  /** The quote or fact under the greeting when Home has no rows (SPEC 12). */
  get thought(): Locator {
    return this.root.locator('[data-home-thought]')
  }

  async expectShown(): Promise<void> {
    await expect(this.greeting).toBeVisible()
  }

  /** The sidebar title bar's Home button (SPEC 5). */
  get navItem(): Locator {
    return this.win.locator('header[aria-label="Sidebar title bar"]').getByRole('button', { name: 'Home' })
  }

  /** Opens Home from the sidebar title bar, which reads the items afresh. */
  async open(): Promise<void> {
    await this.navItem.click()
    await this.expectShown()
  }

  item(kind: HomeItemKind): Locator {
    return this.root.locator(`[data-home-item="${kind}"]`)
  }

  title(kind: HomeItemKind): Locator {
    return this.item(kind).locator('[data-home-title]')
  }

  meta(kind: HomeItemKind): Locator {
    return this.item(kind).locator('[data-home-meta]')
  }

  /** The kinds shown, top to bottom. */
  kinds(): Promise<string[]> {
    return this.root.locator('[data-home-item]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-home-item') ?? ''))
  }

  /** Clicks a row's link, which opens its topic. */
  async openItem(kind: HomeItemKind): Promise<void> {
    await this.item(kind).getByRole('link').click()
  }

  button(kind: HomeItemKind, name: 'Mark done' | 'Resolve all' | 'Move' | 'Keep in All' | 'Dismiss'): Locator {
    return this.item(kind).getByRole('button', { name, exact: true })
  }

  /** Tidy up's row, which opens its review sheet. */
  review(): Promise<ReviewSheetPane> {
    return this.reviewOf('tidyUp', 'settled')
  }

  /** A review card's row, which opens its review sheet (`data-sheet="<sheet>"`): "settled", "automated", "doneFollowUps", "oldDrafts", "unfollow", "ignore". */
  async reviewOf(kind: HomeItemKind, sheet: string): Promise<ReviewSheetPane> {
    await this.item(kind).locator('[data-home-review]').click()
    const pane = new ReviewSheetPane(this.win, sheet)
    await expect(pane.root).toBeVisible()
    return pane
  }

  /** Right-clicks a row and chooses `item` in its menu. Returns the menu's labels. */
  async chooseInItemMenu(kind: HomeItemKind, item: string): Promise<string[]> {
    await chooseNextMenuItem(this.win, item)
    await this.item(kind).click({ button: 'right' })
    return (await lastMenu(this.win)).labels
  }
}

/**
 * A Home card's review sheet (SPEC 12, `docs/design/settled-suggestions/`),
 * the same for every card (`ReviewSheet`): each proposal with its reason,
 * the card's action and its "no", what the row says once acted on, and Undo.
 */
export class ReviewSheetPane {
  constructor(
    readonly win: Page,
    readonly name: string,
  ) {}

  get root(): Locator {
    return this.win.locator(`[data-sheet="${this.name}"]`)
  }

  get title(): Locator {
    return this.root.getByRole('heading', { level: 2 })
  }

  /** The line under the title: what the rows are, and what the action does in Slack. */
  get lead(): Locator {
    return this.root.locator('[data-review-lead]')
  }

  /** A proposal's row, by text in its title. */
  row(title: string): Locator {
    return this.root.locator('[data-review-row]').filter({ has: this.win.locator('[data-review-title]', { hasText: title }) })
  }

  reason(title: string): Locator {
    return this.row(title).locator('[data-review-reason]')
  }

  /** The message or draft quoted in the row. */
  quote(title: string): Locator {
    return this.row(title).locator('[data-review-quote]')
  }

  /** `open`, `done` or `declined`. */
  status(title: string): Promise<string | null> {
    return this.row(title).getAttribute('data-review-status')
  }

  /** The card's action: Resolve, Move back, Mark done, Delete. */
  act(title: string): Locator {
    return this.row(title).locator('[data-review-act]')
  }

  /** The card's "no": Keep open, Keep, Not done. */
  decline(title: string): Locator {
    return this.row(title).locator('[data-review-decline]')
  }

  /** What the row says once acted on: "Resolved", "Moved back", "Kept in Follow-up". */
  outcome(title: string): Locator {
    return this.row(title).locator('[data-review-outcome]')
  }

  undo(title: string): Locator {
    return this.row(title).locator('[data-review-undo]')
  }

  /** The bottom button that acts on every row still open: Resolve all. */
  get all(): Locator {
    return this.root.locator('[data-review-all]')
  }

  /** Done, which closes the sheet. */
  get close(): Locator {
    return this.root.locator('[data-review-close]')
  }

  get about(): Locator {
    return this.root.locator('[data-review-about]')
  }

  get explainer(): Locator {
    return this.root.locator('[data-review-explainer]')
  }
}
