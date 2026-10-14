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

/** Presses and releases the primary button where the mouse is. */
export async function press(win: Page): Promise<void> {
  await win.mouse.down()
  await win.waitForTimeout(PRESS_MS)
  await win.mouse.up()
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
    await this.root.scrollIntoViewIfNeeded()
    const box = await this.root.boundingBox()
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

  /** Right-click, then Open in stealth. */
  async openInStealth(): Promise<void> {
    await chooseNextMenuItem(this.win, 'stealth')
    await this.root.click({ button: 'right', position: { x: 40, y: 20 } })
  }

  /** Main rows: "2 new threads" under the title. */
  async expectNewThreads(count: number): Promise<void> {
    await expect(this.root.getByTitle(count === 1 ? '1 new thread' : `${count} new threads`)).toHaveText(String(count))
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

  async expectTag(tag: 'Main' | 'Reopened'): Promise<void> {
    await expect(this.root.getByText(tag, { exact: true })).toBeVisible()
  }

  async expectChannel(name: string): Promise<void> {
    await expect(this.root.getByText(name, { exact: true })).toBeVisible()
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
  readonly topic: TopicPane
  readonly tabs: TabStrip

  constructor(app: ElectronApplication, win: Page) {
    this.app = app
    this.win = win
    appOf.set(win, app)
    this.sidebar = new Sidebar(win)
    this.accountMenu = new AccountMenu(win, this.sidebar)
    this.topic = new TopicPane(win)
    this.tabs = new TabStrip(app, win)
  }

  /** The empty workspace shown when no tab is open. */
  async expectNothingOpen(): Promise<void> {
    await expect(this.win.getByText('Nothing open yet', { exact: true })).toBeVisible()
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
    await Promise.all([page.waitForEvent('close'), page.getByRole('button', { name: 'Sign in' }).click()])
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

const appOf = new WeakMap<Page, ElectronApplication>()

/** Makes the next native context menu pick `id` without showing (main's JUNO_E2E hook). */
async function chooseNextMenuItem(win: Page, id: string): Promise<void> {
  const app = appOf.get(win)
  if (app === undefined) throw new Error('chooseNextMenuItem needs the app; use the Juno driver')
  await app.evaluate((_electron, choice) => {
    ;(globalThis as unknown as { junoTest: { contextMenu: { next: string | null | undefined } } }).junoTest.contextMenu.next = choice
  }, id)
}

const BOTTOM_SLACK = 2

/** The topic shown in the active tab. Hidden tabs stay in the page with `display: none`. */
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

  /** A message by the start of its text. */
  message(text: string): Locator {
    return this.list.locator('[data-message-row]').filter({ hasText: text })
  }

  async expectTitle(title: string | RegExp): Promise<void> {
    await expect(this.header).toContainText(title, { timeout: 15_000 })
  }

  async expectMessage(text: string): Promise<void> {
    await expect(this.message(text)).toBeVisible({ timeout: 15_000 })
  }

  /**
   * The "N new" divider sits right before the message that starts with
   * `text`, 80px from the top of the list, or as near as the list can
   * scroll when the topic is short.
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
    if (scrollTop > 0.5 && scrollTop < max - 0.5) expect(Math.abs(offset - 80)).toBeLessThanOrEqual(2)
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

  /** Scrolls the list up by `pixels` and waits for the scroll to settle. */
  async scrollUp(pixels: number): Promise<void> {
    await this.scrollTo({ by: -pixels })
  }

  async scrollToBottom(): Promise<void> {
    await this.scrollTo({ to: 'bottom' })
  }

  async scrollToTop(): Promise<void> {
    await this.scrollTo({ to: 'top' })
  }

  private async scrollTo(where: { readonly by: number } | { readonly to: 'top' | 'bottom' }): Promise<void> {
    await this.scroller.evaluate(
      (scroller, target) =>
        new Promise<void>((resolve) => {
          const max = scroller.scrollHeight - scroller.clientHeight
          const to = 'by' in target ? scroller.scrollTop + target.by : target.to === 'top' ? 0 : max
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

  /** The stealth pill in the header. */
  get stealthPill() {
    return this.header.getByText('Stealth. Not marking as read.')
  }

  async expectStealth(stealth = true): Promise<void> {
    await expect(this.stealthPill).toHaveCount(stealth ? 1 : 0)
  }

  /** The stealth pill's Mark read. */
  async markRead(): Promise<void> {
    await this.header.getByRole('button', { name: 'Mark read', exact: true }).click()
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
  get threadsButton() {
    return this.header.getByRole('button', { name: /^Threads/ })
  }

  async openThreads(): Promise<ThreadsPopover> {
    await this.threadsButton.click()
    const popover = new ThreadsPopover(this.win)
    await expect(popover.root).toBeVisible()
    return popover
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
      .poll(() => this.list.locator('img[src^="juno://files/"]').evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length), { timeout: 15_000 })
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
}

/** The list behind Main's "Threads" button. */
export class ThreadsPopover {
  readonly root: Locator

  constructor(readonly win: Page) {
    this.root = win.getByRole('dialog', { name: 'Threads' })
  }

  entry(title: string): Locator {
    return this.root.getByRole('listitem').filter({ hasText: title })
  }

  async open(title: string): Promise<void> {
    await this.entry(title).scrollIntoViewIfNeeded()
    const box = await this.entry(title).boundingBox()
    if (!box) throw new Error(`No thread "${title}" in the list`)
    await this.win.mouse.move(box.x + 24, box.y + box.height / 2)
    await press(this.win)
  }

  async subscribe(title: string): Promise<void> {
    const bell = this.entry(title).getByRole('button', { name: /^Unsubscribed/ })
    await bell.click()
    await expect(this.entry(title).getByRole('button', { name: /^Subscribed/ })).toBeVisible()
  }
}

/** The tab strip over the workspace. */
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

  /** Tab titles, left to right. */
  titles(): Promise<string[]> {
    return this.root.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('title') ?? ''))
  }

  async expectCount(count: number): Promise<void> {
    await expect(this.root.getByRole('tab')).toHaveCount(count, { timeout: 15_000 })
  }

  async expectActive(title: string): Promise<void> {
    await expect(this.tab(title)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
  }

  async expectStealth(title: string, stealth = true): Promise<void> {
    if (stealth) await expect(this.tab(title)).toHaveAttribute('aria-description', 'Stealth')
    else await expect(this.tab(title)).not.toHaveAttribute('aria-description', 'Stealth')
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
    await this.tab(title).getByRole('button', { name: 'Close tab' }).click()
  }

  /** An item of the app menu, as ⌘W, ⌘⇧] or ⌘⇧[ would choose it. */
  async menu(id: 'close-tab' | 'next-tab' | 'previous-tab'): Promise<void> {
    await this.app.evaluate(({ Menu, BrowserWindow }, itemId) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
      if (!item) throw new Error(`No menu item ${itemId}`)
      item.click(undefined, BrowserWindow.getAllWindows()[0])
    }, id)
  }
}
