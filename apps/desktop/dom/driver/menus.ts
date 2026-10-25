import type { MenuCommand } from '@juno/contract/channels'
import type { AppMenuItem, AppSurface } from '../../e2e/driver/surface'
import type { MenuSeen } from '../../e2e/driver/verbs'
import type { DomApp } from '../app'
import { expect } from '../expect'

export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What each app menu item sends the page, as `setAppMenu` in `src/main/window.ts` wires it (as `e2e/driver/surface.ts`). */
const COMMANDS: Record<AppMenuItem, MenuCommand> = {
  'close-tab': 'tab.close', 'next-tab': 'tab.next', 'previous-tab': 'tab.previous', 'next-tab-control': 'tab.next', 'previous-tab-control': 'tab.previous',
  'new-tab': 'tab.new', 'new-message': 'chat.new', 'reopen-tab': 'tab.reopen', back: 'history.back', forward: 'history.forward',
  'toggle-sidebar': 'sidebar.toggle', 'toggle-privacy': 'privacy.toggle', juno: 'juno.toggle', search: 'palette.toggle',
  'search-messages': 'search.open', 'search-topic': 'search.topic', undo: 'edit.undo', tour: 'tour.show', settings: 'settings.open',
  'tab-1': 'tab.select.1', 'tab-2': 'tab.select.2', 'tab-3': 'tab.select.3', 'tab-4': 'tab.select.4', 'tab-5': 'tab.select.5',
  'tab-6': 'tab.select.6', 'tab-7': 'tab.select.7', 'tab-8': 'tab.select.8', 'tab-last': 'tab.select.9',
}

/** The page's menu seam, as the web surface reaches it. */
export class Menus {
  constructor(readonly app: DomApp) {}

  get #menu() {
    return this.app.seam.contextMenu
  }

  /** Makes the next native context menu pick `id` without showing it, or pick nothing with null; with `hold`, it stays open until `release`. */
  choose(id: string | null, options: { readonly hold?: boolean } = {}): void {
    this.#menu.next = id
    this.#menu.hold = options.hold === true
  }

  /** Waits until a menu took the armed choice, then answers what it showed. */
  async last(): Promise<MenuSeen> {
    await expect.poll(() => this.#menu.next === undefined, { timeout: 10_000, message: 'a native menu to take the armed item' }).toBe(true)
    return { labels: [...this.#menu.lastLabels], at: this.#menu.lastAt }
  }

  async release(): Promise<void> {
    await expect.poll(() => this.#menu.release !== undefined, { message: 'a held native menu' }).toBe(true)
    this.#menu.release?.()
  }

  get asked(): number {
    return this.#menu.asked
  }

  /** Clicks an app menu item `presses` times, as a held key repeats it. */
  appMenu(id: AppMenuItem, presses = 1): void {
    for (let press = 0; press < presses; press++) this.app.seam.menu(COMMANDS[id])
  }
}

/**
 * The DOM lane's `AppSurface`, as `webSurface` is the browser lane's: the
 * page's seam for menus and links, the host for the engine and the shell.
 */
export function domSurface(app: DomApp, menus: Menus): AppSurface {
  const menu = () => app.seam.contextMenu
  return {
    kind: 'web',
    system: (name, ...args) => app.host.system(name, ...args),
    get electron(): never {
      throw new Error('This test needs Electron; it belongs in the electron project (e2e README, "Browser lane").')
    },
    chooseNextMenuItem: async (id, hold) => menus.choose(id, { hold }),
    menuState: async () => ({ next: menu().next, labels: [...menu().lastLabels], at: menu().lastAt, asked: menu().asked, held: menu().release !== undefined }),
    disarmMenu: async (expected) => {
      const taken = menu().next !== expected
      menu().next = undefined
      return taken
    },
    releaseMenu: async () => menu().release?.(),
    appMenu: async (id, presses) => menus.appMenu(id, presses),
    menuLabel: async (id) => {
      const params = new URL(app.window.location.href).searchParams
      if (id === 'toggle-privacy') return params.get('privacy') === null ? 'Hide Message Text' : 'Show Message Text'
      return params.get('sidebar')?.endsWith('-hidden') === true ? 'Show Sidebar' : 'Hide Sidebar'
    },
    clipboard: () => (app.window.navigator as unknown as Navigator).clipboard.readText(),
    browserLinks: async () => [...app.seam.browserLinks],
    slackLinks: async () => [...app.seam.slackLinks],
    workPass: (name) => app.host.workPass(name),
    aiCalls: () => app.host.aiCalls(),
    swipe: async () => { throw new Error('The swipe is an Electron window event; the test belongs in the electron project.') },
    setWindowSize: async () => { throw new Error('A window size is layout; the test belongs in the browser lane.') },
  }
}

