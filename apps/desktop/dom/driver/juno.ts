/**
 * The DOM lane's driver: the Playwright driver's page objects
 * (`e2e/driver/juno.ts`) over `Query` (`../query.ts`), with the same verbs
 * (`e2e/driver/verbs.ts`). Rows, tabs and buttons are found by role and
 * name as there; a press is the events a browser sends, at no coordinate.
 * Native menus and app-menu items go through the page's test seam
 * (`web/page/testSeam.ts`), as in the browser lane (`menus.ts`).
 */
import type { NotificationPermission } from '@juno/contract'
import type { AppSurface, WorkPassName } from '../../e2e/driver/surface'
import type { JunoVerbs, MenuSeen, SettingsSectionName } from '../../e2e/driver/verbs'
import type { SystemHooks } from '../../web/shell'
import type { DomApp } from '../app'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import { HomePane, HomeWritePane, WelcomeCard } from './home'
import { domSurface, Menus } from './menus'
import { PaletteDriver } from './palette'
import { AccountMenu, hoursRows, NotificationsPage, PrivacyMode, SettingsPage, type HoursSection } from './settings'
import { PeekPopover } from './peek'
import { Sidebar, type PeekKeyName } from './sidebar'
import { Navigation, TabStrip } from './tabs'
import { MessageMenuDriver, TopicPane } from './topic'

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
  readonly privacy: PrivacyMode
  readonly peek: PeekPopover
  readonly welcome: WelcomeCard

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
    this.privacy = new PrivacyMode(this.dom, this.surface)
    this.peek = new PeekPopover(this.dom)
    this.welcome = new WelcomeCard(this.dom, this.menus)
  }

  /** A message's menu: `openOn` or `openOnRow`, then its rows and the emoji grid. */
  get messageMenu(): MessageMenuDriver {
    return new MessageMenuDriver(this.dom)
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

  async setPeekKey(key: PeekKeyName): Promise<void> {
    await this.openSettings('General')
    const radio = this.settings.root.getByRole('radiogroup', { name: 'Hold to peek' }).getByRole('radio', { name: key === 'option' ? '⌥ Option' : 'Space' })
    await radio.click()
    await expect(radio).toHaveAttribute('aria-checked', 'true')
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

  /** Notification hours around now (or, with `outside`, away from now) on every day, saved, as the Playwright driver's. */
  notificationHoursNow(options: { readonly outside?: boolean } = {}): Promise<void> {
    return this.#hoursNow(['Notifications'], options)
  }

  /**
   * Notification and Active in Slack hours around now on every day, saved, and Settings closed: Slack shows the
   * owner active and the account button its dot rather than the paused badge, whatever the time and day.
   */
  async allHoursNow(): Promise<void> {
    await this.#hoursNow(['Notifications', 'Active in Slack'], {})
    await this.tabs.close('Settings')
  }

  /** Active in Slack hours around now and notification hours away from now, on every day, saved, and Settings closed: the hours keep the owner active while notifications are paused. */
  async activeWhilePaused(): Promise<void> {
    await this.#hoursNow(['Active in Slack'], {})
    await this.#hoursNow(['Notifications'], { outside: true })
    await this.tabs.close('Settings')
  }

  async #hoursNow(sections: ReadonlyArray<HoursSection>, options: { readonly outside?: boolean }): Promise<void> {
    await this.openNotifications()
    const now = new this.dom.window.Date()
    const half = Math.floor((now.getHours() * 60 + now.getMinutes()) / 30) * 30
    const from = options.outside === true ? (half + 360) % 1440 : (half + 1380) % 1440
    const to = options.outside === true ? (half + 1080) % 1440 : (from + 120) % 1440
    for (const section of sections) for (const row of hoursRows) await this.notifications.setRow(section, row, { from, to })
    await this.tabs.close('Settings')
    await this.openNotifications()
    for (const section of sections) for (const row of hoursRows) await this.notifications.expectRow(section, row, { from, to })
  }

  /** The OS notifications the host's shell showed, oldest first. */
  osNotifications(): Promise<Array<{ readonly title: string; readonly body: string; readonly silent?: true }>> {
    return this.surface.system('notifications')
  }

  clickOsNotification(index: number): Promise<void> {
    return this.surface.system('clickNotification', index)
  }

  setNotificationPermission(permission: NotificationPermission): Promise<void> {
    return this.surface.system('notificationPermission', permission)
  }

  dockBounces(): Promise<number> {
    return this.surface.system('dockBounces')
  }

  setFrontmost(frontmost: boolean): Promise<void> {
    return this.surface.system('frontmost', frontmost)
  }

  /** The dock's badge as main would set it: '•' or ''. */
  dockBadge(): Promise<string> {
    return this.surface.system('dockBadge')
  }

  /** The window goes to the background, as main reports it: a `blur` on the window. */
  async blurWindow(): Promise<void> {
    const W = this.dom.window as unknown as { FocusEvent: typeof FocusEvent; dispatchEvent: (event: Event) => boolean }
    W.dispatchEvent(new W.FocusEvent('blur'))
  }

  async focusWindow(): Promise<void> {
    const W = this.dom.window as unknown as { FocusEvent: typeof FocusEvent; dispatchEvent: (event: Event) => boolean }
    W.dispatchEvent(new W.FocusEvent('focus'))
  }

  /** What the engine host's shell did (`SystemHooks`): notifications, the dock, the agent's state. */
  system<K extends keyof SystemHooks>(name: K, ...args: Parameters<SystemHooks[K]>): Promise<ReturnType<SystemHooks[K]>> {
    return this.app.host.system(name, ...args)
  }
}
