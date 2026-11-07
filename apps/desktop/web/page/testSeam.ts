/**
 * What main records for tests under JUNO_E2E, kept in the page for the
 * browser e2e lane (apps/desktop/e2e/README.md, "Browser lane"). It is on
 * only when the address has `e2e` (the lane's driver adds it); `bun run web`
 * opens without it, so menus show and links open.
 *
 * - `contextMenu`: the same seam as main's `contextMenuForTests`. A test sets
 *   the item the next menu picks; that menu answers at once without
 *   showing, and keeps its labels in main's format and where it was asked
 *   to open. `hold` keeps it open until `release`.
 * - `browserLinks`, `slackLinks`: links that would have opened outside.
 * - `menu`: an app-menu command, as main sends one when a menu item is
 *   clicked.
 * - `updates`: the updater main would run. `set` reports a state, as
 *   main's `Events.updatesChanged` does; `restarts` counts Restart to update.
 */
import type { ContextMenuAt, ContextMenuItem, ContextMenuLeaf, MenuCommand } from '@juno/contract/channels'

export interface WebTestSeam {
  readonly contextMenu: {
    next: string | null | undefined
    hold: boolean
    release: (() => void) | undefined
    lastLabels: ReadonlyArray<string>
    lastAt: ContextMenuAt | null
    asked: number
  }
  readonly browserLinks: string[]
  readonly slackLinks: string[]
  /** How many times the page asked to show the microphone's System Settings. */
  microphoneSettingsOpened: number
  menu: (command: MenuCommand) => void
  readonly updates: {
    state: unknown
    restarts: number
    readonly listeners: Set<(state: unknown) => void>
    set: (state: unknown) => void
  }
}

export const testing = new URLSearchParams(location.search).has('e2e')

export const seam: WebTestSeam = {
  contextMenu: { next: undefined, hold: false, release: undefined, lastLabels: [], lastAt: null, asked: 0 },
  browserLinks: [],
  slackLinks: [],
  microphoneSettingsOpened: 0,
  menu: () => {},
  updates: {
    state: { kind: 'unavailable' },
    restarts: 0,
    listeners: new Set(),
    set(state) {
      this.state = state
      for (const listener of this.listeners) listener(state)
    },
  },
}

/** As main's `testLabel`: "-" for a separator, "(label)" when disabled, "label ✓" when checked, "label · sublabel". */
function testLabel(item: ContextMenuLeaf): string {
  if ('separator' in item) return '-'
  const label = item.enabled === false ? `(${item.label})` : item.label
  const lines = item.sublabel === undefined ? label : `${label} · ${item.sublabel}`
  return item.checked === true ? `${lines} ✓` : lines
}

/** The seam's answer to a menu, or undefined to show it. */
export function answerMenu(items: ReadonlyArray<ContextMenuItem>, at: ContextMenuAt | undefined): Promise<string | null> | undefined {
  const menu = seam.contextMenu
  menu.asked += 1
  if (menu.next === undefined) return undefined
  const next = menu.next
  menu.next = undefined
  menu.lastAt = at ?? null
  menu.lastLabels = items.flatMap((item) => ('submenu' in item ? [item.label, ...item.submenu.map((sub) => `> ${testLabel(sub)}`)] : [testLabel(item)]))
  if (!menu.hold) return Promise.resolve(next)
  menu.hold = false
  return new Promise((resolve) => {
    menu.release = () => {
      menu.release = undefined
      resolve(next)
    }
  })
}

export function installTestSeam(): void {
  if (testing) Object.assign(window, { __junoWebTest: seam })
}
