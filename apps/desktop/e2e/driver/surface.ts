import { expect, type ElectronApplication, type Page } from '@playwright/test'
import type { MenuCommand } from '@juno/contract/channels'
import type { WebTestSeam } from '../../web/page/testSeam'

/**
 * Where the driver reaches what the page alone does not show: native menus,
 * the app menu, the clipboard, links that leave the app and the engine's test
 * passes. The Electron surface goes through main's `junoTest` hooks; the web
 * surface goes through the page's test seam (`web/page/testSeam.ts`) and the
 * test's host (`e2e/browser/host.ts`). A Playwright project picks one
 * (README, "Browser lane").
 */
export interface AppSurface {
  readonly kind: 'electron' | 'web'
  /** The Electron app, for a test that is about Electron itself; throws on the web surface. */
  readonly electron: ElectronApplication
  chooseNextMenuItem(id: string | null, hold: boolean): Promise<void>
  /** The armed choice once a menu took it, or undefined while it is still armed. */
  menuState(): Promise<{ readonly next: string | null | undefined; readonly labels: string[]; readonly at: { readonly x: number; readonly y: number } | null; readonly asked: number; readonly held: boolean }>
  /** Disarms the next choice; answers whether a menu took it first. */
  disarmMenu(expected: string): Promise<boolean>
  releaseMenu(): Promise<void>
  appMenu(id: AppMenuItem): Promise<void>
  /** An app menu item's label, which names what it will do. */
  menuLabel(id: 'toggle-sidebar' | 'toggle-privacy'): Promise<string | undefined>
  clipboard(): Promise<string>
  browserLinks(): Promise<string[]>
  slackLinks(): Promise<string[]>
  workPass(name: WorkPassName): Promise<void>
  aiCalls(): Promise<Record<string, number>>
  /** The three-finger swipe. */
  swipe(direction: 'left' | 'right'): Promise<void>
  /** The window's content size. */
  setWindowSize(width: number, height: number): Promise<void>
}

export type WorkPassName = 'title' | 'art' | 'home' | 'automated'

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
  | 'settings'
  | `tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'tab-last'

/** What each item sends the page, as `setAppMenu` in `src/main/window.ts` wires it. */
const COMMANDS: Record<AppMenuItem, MenuCommand> = {
  'close-tab': 'tab.close',
  'next-tab': 'tab.next',
  'previous-tab': 'tab.previous',
  'next-tab-control': 'tab.next',
  'previous-tab-control': 'tab.previous',
  'new-tab': 'tab.new',
  'new-message': 'chat.new',
  'reopen-tab': 'tab.reopen',
  back: 'history.back',
  forward: 'history.forward',
  'toggle-sidebar': 'sidebar.toggle',
  'toggle-privacy': 'privacy.toggle',
  juno: 'juno.toggle',
  search: 'palette.toggle',
  undo: 'edit.undo',
  tour: 'tour.show',
  settings: 'settings.open',
  'tab-1': 'tab.select.1',
  'tab-2': 'tab.select.2',
  'tab-3': 'tab.select.3',
  'tab-4': 'tab.select.4',
  'tab-5': 'tab.select.5',
  'tab-6': 'tab.select.6',
  'tab-7': 'tab.select.7',
  'tab-8': 'tab.select.8',
  'tab-last': 'tab.select.9',
}

interface ContextMenuHook {
  next: string | null | undefined
  hold: boolean
  release: (() => void) | undefined
  lastLabels: string[]
  lastAt: { x: number; y: number } | null
  asked: number
}
type MainHooks = { junoTest: { contextMenu: ContextMenuHook; browserLinks: string[]; slackLinks: string[]; workPass: (name: WorkPassName) => Promise<void>; aiCalls: () => Record<string, number> } }

export function electronSurface(app: ElectronApplication): AppSurface {
  return {
    kind: 'electron',
    electron: app,
    chooseNextMenuItem: (id, hold) =>
      app.evaluate((_electron, { choice, held }) => {
        const menu = (globalThis as unknown as MainHooks).junoTest.contextMenu
        menu.next = choice
        menu.hold = held
      }, { choice: id, held: hold }),
    menuState: () =>
      app.evaluate(() => {
        const menu = (globalThis as unknown as MainHooks).junoTest.contextMenu
        return { next: menu.next, labels: [...menu.lastLabels], at: menu.lastAt, asked: menu.asked, held: menu.release !== undefined }
      }),
    disarmMenu: (expected) =>
      app.evaluate((_electron, choice) => {
        const menu = (globalThis as unknown as MainHooks).junoTest.contextMenu
        const taken = menu.next !== choice
        menu.next = undefined
        return taken
      }, expected),
    releaseMenu: () => app.evaluate(() => (globalThis as unknown as MainHooks).junoTest.contextMenu.release?.()),
    appMenu: (id) =>
      app.evaluate(({ Menu, BrowserWindow }, itemId) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
        if (!item) throw new Error(`No menu item ${itemId}`)
        item.click(undefined, BrowserWindow.getAllWindows()[0])
      }, id),
    menuLabel: (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.label, id),
    clipboard: () => app.evaluate(({ clipboard }) => clipboard.readText()),
    browserLinks: () => app.evaluate(() => [...(globalThis as unknown as MainHooks).junoTest.browserLinks]),
    slackLinks: () => app.evaluate(() => [...(globalThis as unknown as MainHooks).junoTest.slackLinks]),
    workPass: (name) => app.evaluate((_electron, job) => (globalThis as unknown as MainHooks).junoTest.workPass(job), name),
    aiCalls: () => app.evaluate(() => (globalThis as unknown as MainHooks).junoTest.aiCalls()),
    swipe: (direction) =>
      app.evaluate(({ BrowserWindow }, way) => {
        BrowserWindow.getAllWindows()[0]?.emit('swipe', {}, way)
      }, direction),
    setWindowSize: (width, height) =>
      app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
      }, { width, height }),
  }
}

/** The engine's test passes and counters, which the web surface asks the test's host for. */
export interface EngineHooks {
  workPass(name: WorkPassName): Promise<void>
  aiCalls(): Promise<Record<string, number>>
}

type PageSeam = { __junoWebTest: WebTestSeam }

export function webSurface(page: Page, engine: EngineHooks): AppSurface {
  return {
    kind: 'web',
    get electron(): ElectronApplication {
      throw new Error('This test needs Electron. Tag it @electron so only the electron project runs it (README, "Browser lane").')
    },
    chooseNextMenuItem: (id, hold) =>
      page.evaluate(({ choice, held }) => {
        const menu = (window as unknown as PageSeam).__junoWebTest.contextMenu
        menu.next = choice
        menu.hold = held
      }, { choice: id, held: hold }),
    menuState: () =>
      page.evaluate(() => {
        const menu = (window as unknown as PageSeam).__junoWebTest.contextMenu
        return { next: menu.next, labels: [...menu.lastLabels], at: menu.lastAt, asked: menu.asked, held: menu.release !== undefined }
      }),
    disarmMenu: (expected) =>
      page.evaluate((choice) => {
        const menu = (window as unknown as PageSeam).__junoWebTest.contextMenu
        const taken = menu.next !== choice
        menu.next = undefined
        return taken
      }, expected),
    releaseMenu: () => page.evaluate(() => (window as unknown as PageSeam).__junoWebTest.contextMenu.release?.()),
    appMenu: (id) => page.evaluate((command) => (window as unknown as PageSeam).__junoWebTest.menu(command), COMMANDS[id]),
    // As main names them from what the page reported (`setAppMenu`).
    menuLabel: async (id) => {
      const params = await page.evaluate(() => Object.fromEntries(new URL(location.href).searchParams))
      if (id === 'toggle-privacy') return params['privacy'] === undefined ? 'Hide Message Text' : 'Show Message Text'
      return params['sidebar']?.endsWith('-hidden') === true ? 'Show Sidebar' : 'Hide Sidebar'
    },
    clipboard: () => page.evaluate(() => navigator.clipboard.readText()),
    browserLinks: () => page.evaluate(() => [...(window as unknown as PageSeam).__junoWebTest.browserLinks]),
    slackLinks: () => page.evaluate(() => [...(window as unknown as PageSeam).__junoWebTest.slackLinks]),
    workPass: (name) => engine.workPass(name),
    aiCalls: () => engine.aiCalls(),
    swipe: async () => {
      throw new Error('The swipe is an Electron window event. Tag the test @electron.')
    },
    setWindowSize: (width, height) => page.setViewportSize({ width, height }),
  }
}

/** Waits until a menu took the armed choice, then answers what it showed. */
export async function lastMenu(surface: AppSurface): Promise<{ readonly labels: string[]; readonly at: { readonly x: number; readonly y: number } | null }> {
  // A menu may wait for the engine before it opens (the why item asks first).
  await expect.poll(async () => (await surface.menuState()).next === undefined, { timeout: 10_000 }).toBe(true)
  const { labels, at } = await surface.menuState()
  return { labels, at }
}
