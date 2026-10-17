import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { ContextMenuAt, ContextMenuItem, ContextMenuLeaf } from '@juno/contract'

/**
 * Native menus are out of Playwright's reach. Under JUNO_E2E a test sets the
 * item the next context menu picks; that menu answers at once without
 * showing, and keeps the labels it was asked to show and where.
 */
export const contextMenuForTests: {
  next: string | null | undefined
  lastLabels: ReadonlyArray<string>
  lastAt: { readonly x: number; readonly y: number } | null
  /** Keeps the next menu open, as if the user were still reading it, until `release` is called. */
  hold: boolean
  release: (() => void) | undefined
} = {
  next: undefined,
  lastLabels: [],
  lastAt: null,
  hold: false,
  release: undefined,
}

/** How a test reads a menu item: "-" for a separator, "(label)" when disabled, "label ✓" when checked, "label · sublabel" with a second line; submenu items start with "> ". */
function testLabel(item: ContextMenuLeaf): string {
  if ('separator' in item) return '-'
  const label = item.enabled === false ? `(${item.label})` : item.label
  const lines = item.sublabel === undefined ? label : `${label} · ${item.sublabel}`
  return item.checked === true ? `${lines} ✓` : lines
}

/**
 * A native menu at the pointer, or at `at` (CSS pixels from the window's top
 * left). The answer is the chosen item's id, or null. The app page's menus and
 * the web panel's both come through here, so one test seam covers both.
 */
export function popupContextMenu(items: ReadonlyArray<ContextMenuItem>, window: BrowserWindow | undefined, at?: ContextMenuAt): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    if (contextMenuForTests.next !== undefined) {
      const next = contextMenuForTests.next
      contextMenuForTests.next = undefined
      contextMenuForTests.lastAt = at ?? null
      contextMenuForTests.lastLabels = items.flatMap((item) => ('submenu' in item ? [item.label, ...item.submenu.map((sub) => `> ${testLabel(sub)}`)] : [testLabel(item)]))
      if (!contextMenuForTests.hold) return resolve(next)
      contextMenuForTests.hold = false
      contextMenuForTests.release = () => {
        contextMenuForTests.release = undefined
        resolve(next)
      }
      return
    }
    let chosen: string | null = null
    const leaf = (item: ContextMenuLeaf): MenuItemConstructorOptions =>
      'separator' in item
        ? { type: 'separator' }
        : {
            label: item.label,
            enabled: item.enabled ?? true,
            ...(item.checked === undefined ? {} : { type: 'checkbox', checked: item.checked }),
            ...(item.sublabel === undefined ? {} : { sublabel: item.sublabel }),
            // Shown only: the app menu owns the shortcut.
            ...(item.accelerator === undefined ? {} : { accelerator: item.accelerator, registerAccelerator: false }),
            click: () => (chosen = item.id),
          }
    const menu = Menu.buildFromTemplate(items.map((item) => ('submenu' in item ? { label: item.label, submenu: item.submenu.map(leaf) } : leaf(item))))
    const point = at === undefined ? {} : { x: Math.round(at.x), y: Math.round(at.y) }
    // The item's click runs before the menu reports it closed.
    menu.popup({ ...(window === undefined ? {} : { window }), ...point, callback: () => setImmediate(() => resolve(chosen)) })
  })
}
