/**
 * The DOM lane's driver: the Playwright driver's page objects
 * (`e2e/driver/juno.ts`) over `Query` (`../query.ts`), with the same verbs
 * (`e2e/driver/verbs.ts`). Rows, tabs and buttons are found by role and
 * name as there; a press is the events a browser sends, at no coordinate.
 * Native menus and app-menu items go through the page's test seam
 * (`web/page/testSeam.ts`), as in the browser lane (`menus.ts`).
 */
import type { AppMenuItem, AppSurface, WorkPassName } from '../../e2e/driver/surface'
import type { JunoVerbs, MenuSeen, SettingsSectionName, TabStripVerbs } from '../../e2e/driver/verbs'
import type { SystemHooks } from '../../web/shell'
import type { DomApp } from '../app'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import { HomePane, HomeWritePane } from './home'
import { domSurface, escapeRegExp, Menus } from './menus'
import { PaletteDriver } from './palette'
import { AccountMenu, NotificationsPage, SettingsPage } from './settings'
import { Sidebar } from './sidebar'
import { TopicPane } from './topic'

/** The tab strip over the workspace. */
export class TabStrip implements TabStripVerbs {
  readonly root: Query

  constructor(readonly dom: Dom, readonly menus: Menus) {
    this.root = dom.getByRole('tablist')
  }

  tab(title: string): Query {
    return this.root.getByRole('tab', { name: new RegExp(`^${escapeRegExp(title)}`) })
  }

  nth(title: string, index: number): Query {
    return this.tab(title).nth(index)
  }

  async titles(): Promise<string[]> {
    return this.root.getByRole('tab').all().map((tab) => tab.getAttribute('data-tooltip') ?? '')
  }

  async expectCount(count: number): Promise<void> {
    await expect(this.root.getByRole('tab')).toHaveCount(count, { timeout: 15_000 })
  }

  async expectActive(title: string): Promise<void> {
    await expect(this.tab(title)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
  }

  async expectActiveAt(title: string, index: number): Promise<void> {
    await expect(this.nth(title, index)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
  }

  /**
   * Mouse down on a tab, then wait until it is the active one: the switch goes
   * through the navigation queue, and a next step must not land in the old tab.
   */
  async select(title: string): Promise<void> {
    await this.tab(title).click()
    await this.expectActive(title)
  }

  /** The close button on a tab. */
  async close(title: string): Promise<void> {
    await this.tab(title).hover()
    await this.closeButton(title).click()
  }

  /** The close button: the tab's sibling. */
  closeButton(title: string): Query {
    return this.tab(title).parent().getByRole('button', { name: 'Close tab' })
  }

  /** The close button on the `index`th tab titled `title`. */
  async closeAt(title: string, index: number): Promise<void> {
    const tab = this.nth(title, index)
    await tab.hover()
    await tab.parent().getByRole('button', { name: 'Close tab' }).click()
  }

  /** Delete on the focused tab. */
  async closeWithKeyboard(title: string): Promise<void> {
    await this.tab(title).focus()
    await this.dom.press('Delete')
  }

  async selectAt(title: string, index: number): Promise<void> {
    await this.nth(title, index).click()
    await this.expectActiveAt(title, index)
  }

  async expectFocused(title: string): Promise<void> {
    await expect(this.tab(title)).toBeFocused()
  }

  /** The "+" after the last tab: a new tab with Home. */
  get newTabButton(): Query {
    return this.dom.getByRole('region', { name: 'Workspace' }).getByRole('button', { name: 'New tab ⌘T' })
  }

  async menu(id: AppMenuItem): Promise<void> {
    this.menus.appMenu(id)
  }

  /** ⌘N or ⌘T as a user presses it: the keydown reaches the page, then main runs the menu item. */
  async shortcut(id: 'new-message' | 'new-tab'): Promise<void> {
    const key = id === 'new-message' ? 'n' : 't'
    this.dom.key(this.dom.active ?? (this.dom.document.body as HTMLElement), key, ['Meta'])
    this.menus.appMenu(id)
  }

  /** Right-clicks a tab and picks `item` in the tab menu. Returns the menu's labels. */
  async contextMenu(title: string, item: string): Promise<string[]> {
    this.menus.choose(item)
    await this.tab(title).click({ button: 'right' })
    return (await this.menus.last()).labels
  }
}

/** Back and Forward: the title bar buttons and the app menu (⌘[ and ⌘]). */
export class Navigation {
  constructor(readonly dom: Dom, readonly menus: Menus) {}

  get backButton(): Query {
    return this.dom.getByRole('button', { name: 'Back ⌘[' }).filter({ visible: true })
  }

  get forwardButton(): Query {
    return this.dom.getByRole('button', { name: 'Forward ⌘]' }).filter({ visible: true })
  }

  async back(): Promise<void> {
    await this.backButton.click()
  }

  async forward(): Promise<void> {
    await this.forwardButton.click()
  }

  async menu(id: 'back' | 'forward'): Promise<void> {
    this.menus.appMenu(id)
  }

  async expectCanGo(back: boolean, forward: boolean): Promise<void> {
    if (back) await expect(this.backButton).toBeEnabled()
    else await expect(this.backButton).toBeDisabled()
    if (forward) await expect(this.forwardButton).toBeEnabled()
    else await expect(this.forwardButton).toBeDisabled()
  }
}

export class Juno implements JunoVerbs {
  readonly dom: Dom
  readonly menus: Menus
  readonly surface: AppSurface
  readonly sidebar: Sidebar
  readonly accountMenu: AccountMenu
  readonly settings: SettingsPage
  readonly notifications: NotificationsPage
  readonly topic: TopicPane
  readonly write: HomeWritePane
  readonly tabs: TabStrip
  readonly nav: Navigation
  readonly home: HomePane
  readonly palette: PaletteDriver

  constructor(readonly app: DomApp) {
    this.dom = app.dom
    this.menus = new Menus(app)
    this.surface = domSurface(app, this.menus)
    this.sidebar = new Sidebar(this.dom, this.menus)
    this.accountMenu = new AccountMenu(this.dom, this.sidebar)
    this.settings = new SettingsPage(this.dom)
    this.notifications = new NotificationsPage(this.dom)
    this.topic = new TopicPane(this.dom, this.menus)
    this.write = new HomeWritePane(this.dom)
    this.tabs = new TabStrip(this.dom, this.menus)
    this.nav = new Navigation(this.dom, this.menus)
    this.home = new HomePane(this.dom, this.menus)
    this.palette = new PaletteDriver(this.dom, this.menus)
  }

  /** The page, for a test's own queries, as `juno.win` is in the Playwright driver. */
  get win(): Dom {
    return this.dom
  }

  /**
   * When one of the app's marks (`@juno/state/perf`) was last recorded, or
   * undefined. The Bun worker's `performance` is shared by every window it
   * opens, so compare with the value before the step.
   */
  lastMark(name: string): number | undefined {
    return this.dom.window.performance.getEntriesByName(name, 'mark').at(-1)?.startTime
  }

  /** When one of the app's measures last started, or undefined; see `lastMark`. */
  lastMeasure(name: string): number | undefined {
    return this.dom.window.performance.getEntriesByName(name, 'measure').at(-1)?.startTime
  }

  async chooseNextMenuItem(id: string | null, options: { readonly hold?: boolean } = {}): Promise<void> {
    this.menus.choose(id, options)
  }

  lastMenu(): Promise<MenuSeen> {
    return this.menus.last()
  }

  releaseMenu(): Promise<void> {
    return this.menus.release()
  }

  async menusAsked(): Promise<number> {
    return this.menus.asked
  }

  toast(text: string): Query {
    return this.dom.getByRole('status').filter({ hasText: text })
  }

  async expectToast(text: string): Promise<void> {
    await expect(this.toast(text)).toBeVisible({ timeout: 10_000 })
  }

  async undoFromToast(): Promise<void> {
    await this.dom.getByRole('status').getByRole('button', { name: /^Undo/ }).click()
  }

  /** Edit › Undo, as ⌘Z. */
  async undo(): Promise<void> {
    this.menus.appMenu('undo')
  }

  get renameField(): Query {
    return this.dom.locator('[data-rename-field]').filter({ visible: true })
  }

  async rename(title: string): Promise<void> {
    await expect(this.renameField).toBeFocused()
    await this.renameField.fill(title)
    await this.renameField.press('Enter')
    await expect(this.renameField).toHaveCount(0)
  }

  clipboard(): Promise<string> {
    return this.surface.clipboard()
  }

  browserLinks(): Promise<string[]> {
    return this.surface.browserLinks()
  }

  slackLinks(): Promise<string[]> {
    return this.surface.slackLinks()
  }

  async expectNothingOpen(): Promise<void> {
    await this.tabs.expectCount(1)
    await this.tabs.expectActive('Home')
    await this.home.expectShown()
  }

  get importButton(): Query {
    return this.dom.getByRole('button', { name: "Use the Slack app's session" })
  }

  get setUp(): Query {
    return this.dom.locator('[data-set-up-juno]')
  }

  async signIn(options: { readonly skipSetUp?: boolean } = {}): Promise<void> {
    await this.importButton.click({ timeout: 15_000 })
    if (options.skipSetUp !== false) await this.skipSetUp()
  }

  async skipSetUp(): Promise<void> {
    await expect(this.setUp.or(this.sidebar.root).first()).toBeVisible({ timeout: 15_000 })
    if (this.setUp.isVisible()) await this.setUp.getByRole('button', { name: 'Skip for now' }).click()
  }

  async workPass(name: WorkPassName): Promise<void> {
    await this.app.host.workPass(name)
  }

  aiCalls(): Promise<Record<string, number>> {
    return this.app.host.aiCalls()
  }

  /** Signed in, rows shown and the engine idle; then the pointer and focus rest on the workspace, as the Playwright driver leaves them. */
  async waitForSync(): Promise<void> {
    await this.sidebar.expectRows()
    await this.expectEngineLive()
    const tabOpen = this.dom.getByRole('tablist').getByRole('tab', { selected: true })
    await expect(this.home.root.or(tabOpen).first()).toBeVisible()
    if (this.home.root.isVisible()) await this.home.root.click()
    else await this.dom.getByRole('region', { name: 'Workspace' }).click()
  }

  async expectEngineLive(timeout = 30_000): Promise<void> {
    await expect(this.sidebar.root).toHaveAttribute('aria-busy', 'false', { timeout })
  }

  async setTheme(theme: 'Light' | 'Dark'): Promise<void> {
    await this.openSettings('Appearance')
    await this.settings.themeRadio(theme).click()
    await expect(this.settings.themeRadio(theme)).toHaveAttribute('aria-checked', 'true')
    await this.tabs.close('Settings')
    await expect(this.tabs.tab('Settings')).toHaveCount(0)
  }

  async openSettings(section: SettingsSectionName = 'General'): Promise<void> {
    await this.accountMenu.choose(/^Settings/)
    await this.tabs.expectActive('Settings')
    await expect(this.settings.section('General')).toHaveAttribute('aria-current', 'page')
    if (section !== 'General') await this.settings.show(section)
  }

  async openNotifications(): Promise<void> {
    await this.accountMenu.choose(/^Notifications/)
    await this.tabs.expectActive('Settings')
    await expect(this.settings.section('Notifications')).toHaveAttribute('aria-current', 'page')
  }

  /** What the engine host's shell did (`SystemHooks`): notifications, the dock, the agent's state. */
  system<K extends keyof SystemHooks>(name: K, ...args: Parameters<SystemHooks[K]>): Promise<ReturnType<SystemHooks[K]>> {
    return this.app.host.system(name, ...args)
  }
}
