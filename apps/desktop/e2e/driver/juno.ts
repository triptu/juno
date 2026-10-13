/**
 * The user-language driver for Juno (architecture 13). Tests read as what a
 * person does: `juno.signIn()`, `juno.sidebar.row('Postgres').hover()`.
 * Later milestones add verbs here; a test that needs a raw selector means a
 * verb is missing.
 */
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

export type SidebarSectionName = 'Pinned' | 'Recent'
export type SidebarFilterName = 'All' | 'Channels' | 'DMs'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One row in the sidebar, found by the start of its title. */
export class SidebarRow {
  readonly root: Locator

  constructor(
    readonly win: Page,
    readonly title: string,
  ) {
    // Rows are named by their title; "Resolve {title}" is the button inside,
    // so the name must start with the title.
    this.root = win.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}`) })
  }

  get resolveButton() {
    return this.root.getByRole('button', { name: new RegExp(`^Resolve ${escapeRegExp(this.title)}`) })
  }

  hover() {
    return this.root.hover()
  }

  focus() {
    return this.root.focus()
  }

  /** Selects the row with the mouse (it activates on mouse down). */
  async select(): Promise<void> {
    const box = await this.root.boundingBox()
    if (!box) throw new Error(`Row "${this.title}" is not on screen`)
    await this.win.mouse.move(box.x + 40, box.y + box.height / 2)
    await this.win.mouse.down()
    await this.win.mouse.up()
  }

  async expectVisible(): Promise<void> {
    await expect(this.root).toBeVisible({ timeout: 15_000 })
  }

  async expectSelected(selected = true): Promise<void> {
    await expect(this.root).toHaveAttribute('aria-pressed', String(selected))
  }

  async expectFocused(): Promise<void> {
    await expect(this.root).toBeFocused()
  }

  /** The row is not in the list at all. */
  async expectAbsent(): Promise<void> {
    await expect(this.root).toHaveCount(0)
  }

  /** The title element, which names the row. */
  get titleText() {
    return this.root.locator('[id]').first()
  }

  /** The "Sender: text" preview under the title. */
  get preview() {
    return this.root.locator('[id]').nth(1)
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

  async expectTag(tag: 'Main' | 'Reopened'): Promise<void> {
    await expect(this.root.getByText(tag, { exact: true })).toBeVisible()
  }

  async expectChannel(name: string): Promise<void> {
    await expect(this.root.getByText(name, { exact: true })).toBeVisible()
  }

  async expectMessageCount(count: number): Promise<void> {
    await expect(this.root.locator(`[title="${count} messages"]`)).toHaveText(String(count))
  }

}

/** The left pane: filters, sections and rows. */
export class Sidebar {
  readonly root: Locator

  constructor(readonly win: Page) {
    this.root = win.getByRole('complementary', { name: 'Sidebar' })
  }

  get list() {
    return this.root.getByRole('group', { name: 'Topics' })
  }

  get rows() {
    return this.list.locator('[data-topic-row]')
  }

  row(title: string): SidebarRow {
    return new SidebarRow(this.win, title)
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

  /** Waits until at least one row has arrived from the engine. */
  async expectRows(): Promise<void> {
    await expect(this.rows.first()).toBeVisible({ timeout: 15_000 })
  }

  async expectNoSection(section: SidebarSectionName): Promise<void> {
    await expect(this.section(section)).toHaveCount(0)
  }

  /** A quick filter. Its name gains ", unread" while its dot shows. */
  filterButton(name: SidebarFilterName) {
    return this.root.getByRole('group', { name: 'Quick filters' }).getByRole('button', { name: new RegExp(`^${name}(, unread)?$`) })
  }

  get unreadToggle() {
    return this.root.getByRole('button', { name: 'Show unread only' })
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

  /** The status line under the filters, shown when the list may be behind Slack. */
  get syncStatus() {
    return this.root.getByRole('status', { name: 'Sync status' })
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

  get themeButton() {
    return this.root.getByRole('button', { name: 'Toggle theme' })
  }

  get accountButton() {
    return this.root.getByRole('button', { name: 'Account and preferences' })
  }
}

/** The popover behind the avatar button: session, appearance, diagnostics. */
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

  get engineStatus() {
    return this.root.getByRole('status', { name: 'Engine status' })
  }

  get pingButton() {
    return this.root.getByRole('button', { name: 'Ping engine' })
  }

  get signOutButton() {
    return this.root.getByRole('button', { name: 'Sign out' })
  }

  themeRadio(name: 'Light' | 'Dark') {
    return this.root.getByRole('radio', { name })
  }
}

export class Juno {
  readonly app: ElectronApplication
  readonly win: Page
  readonly sidebar: Sidebar
  readonly accountMenu: AccountMenu

  constructor(app: ElectronApplication, win: Page) {
    this.app = app
    this.win = win
    this.sidebar = new Sidebar(win)
    this.accountMenu = new AccountMenu(win, this.sidebar)
  }

  /** The sign-in page's primary and secondary actions. */
  get signInButton() {
    return this.win.getByRole('button', { name: 'Sign in to Slack' })
  }

  get importButton() {
    return this.win.getByRole('button', { name: "Use the Slack app's session" })
  }

  /**
   * Clicks "Sign in to Slack", fills the fake's sign-in page in the window
   * that opens, and waits for the app to come back signed in.
   */
  async signIn(options: { readonly email?: string } = {}): Promise<void> {
    const opened = this.app.waitForEvent('window')
    await this.signInButton.click()
    const page = await opened
    await page.getByPlaceholder('Email').fill(options.email ?? 'tushar@juno-fake.test')
    await page.getByPlaceholder('Password').fill('password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForEvent('close')
  }

  /** Clicks "Sign in to Slack" and closes the window without signing in. */
  async abandonSignIn(): Promise<void> {
    const opened = this.app.waitForEvent('window')
    await this.signInButton.click()
    const page = await opened
    await page.close()
  }

  /** Clicks "Use the Slack app's session". The app reads the fixture directory it was launched with. */
  async importFromSlackApp(): Promise<void> {
    await this.importButton.click()
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

  /**
   * Waits until the engine has finished catching up with Slack, so the rows
   * hold still. The sidebar paints before this; tests that compare rows or
   * measure a hover wait for it first.
   */
  async waitForSync(): Promise<void> {
    await this.sidebar.expectRows()
    await this.expectEngineLive()
    // Park the pointer and the focus on the empty workspace.
    await this.win.mouse.click(900, 400)
  }

  /** Switches the theme from the account menu and waits for the page to follow. */
  async setTheme(theme: 'Light' | 'Dark'): Promise<void> {
    await this.accountMenu.open()
    await this.accountMenu.themeRadio(theme).click()
    await expect(this.accountMenu.themeRadio(theme)).toHaveAttribute('aria-checked', 'true')
    await this.accountMenu.close()
  }

  /** Waits until the engine has caught up with Slack and says it is live. */
  async expectEngineLive(timeout = 30_000): Promise<void> {
    await this.accountMenu.open()
    await expect(this.accountMenu.engineStatus).toHaveText('Engine live', { timeout })
    await this.accountMenu.close()
  }

  /** Reads one of the app's performance measures (`@juno/state/perf`), in milliseconds. */
  async measure(name: string): Promise<number | undefined> {
    return this.win.evaluate((measureName) => {
      const entries = performance.getEntriesByName(measureName, 'measure')
      const last = entries[entries.length - 1]
      return last === undefined ? undefined : last.duration
    }, name)
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
