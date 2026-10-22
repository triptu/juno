/**
 * The web shell's context menu: what `contextMenu.popup` shows where
 * Electron shows a native menu. A plain HTML list in system colours, good
 * enough to read and click (`role="menu"` with `menuitem` buttons, one level
 * of submenus); it does not try to look like macOS.
 *
 * It opens at `at`, or else where the pointer last went down or the last
 * context menu was asked for, and answers the chosen item's id, or null when
 * it closes without a choice (Escape, a press outside, the window losing
 * focus).
 */
import type { ContextMenuAt, ContextMenuItem, ContextMenuLeaf } from '@juno/contract/channels'

let pointer: ContextMenuAt = { x: 0, y: 0 }
let close: (() => void) | undefined

export function trackPointer(): void {
  const remember = (event: MouseEvent) => {
    pointer = { x: event.clientX, y: event.clientY }
  }
  window.addEventListener('pointerdown', remember, true)
  window.addEventListener('contextmenu', remember, true)
}

const MENU_STYLE = [
  'position: fixed',
  'z-index: 2147483647',
  'min-width: 180px',
  'padding: 4px',
  'margin: 0',
  'list-style: none',
  'background: Canvas',
  'color: CanvasText',
  'border: 1px solid GrayText',
  'border-radius: 6px',
  'font: 13px system-ui, sans-serif',
  'box-shadow: 0 4px 16px color-mix(in srgb, CanvasText 25%, transparent)',
].join(';')

const ITEM_STYLE = [
  'display: flex',
  'gap: 12px',
  'width: 100%',
  'padding: 4px 8px',
  'border: 0',
  'border-radius: 4px',
  'background: none',
  'color: inherit',
  'font: inherit',
  'text-align: start',
  'cursor: default',
].join(';')

function leafButton(item: Exclude<ContextMenuLeaf, { separator: true }>, choose: (id: string) => void): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox')
  if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked))
  button.style.cssText = ITEM_STYLE
  button.disabled = item.enabled === false
  if (button.disabled) button.style.color = 'GrayText'
  const label = document.createElement('span')
  label.style.flex = '1'
  label.textContent = `${item.checked === true ? '✓ ' : ''}${item.label}`
  button.append(label)
  if (item.sublabel !== undefined) button.title = item.sublabel
  if (item.accelerator !== undefined) {
    const keys = document.createElement('span')
    keys.style.color = 'GrayText'
    keys.textContent = item.accelerator.replace('CommandOrControl', 'Cmd')
    button.append(keys)
  }
  button.addEventListener('pointerenter', () => button.focus())
  button.addEventListener('focus', () => {
    button.style.background = 'Highlight'
    button.style.color = 'HighlightText'
  })
  button.addEventListener('blur', () => {
    button.style.background = 'none'
    button.style.color = button.disabled ? 'GrayText' : 'inherit'
  })
  button.addEventListener('click', () => choose(item.id))
  return button
}

function list(items: ReadonlyArray<ContextMenuItem>, choose: (id: string) => void, label?: string): HTMLElement {
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  if (label !== undefined) menu.setAttribute('aria-label', label)
  menu.style.cssText = MENU_STYLE
  for (const item of items) {
    if ('separator' in item) {
      const line = document.createElement('div')
      line.setAttribute('role', 'separator')
      line.style.cssText = 'height: 1px; margin: 4px 0; background: GrayText'
      menu.append(line)
    } else if ('submenu' in item) {
      const wrap = document.createElement('div')
      wrap.style.position = 'relative'
      const trigger = leafButton({ id: '', label: `${item.label} ▸` }, () => {})
      trigger.setAttribute('aria-haspopup', 'menu')
      const sub = list(item.submenu, choose, item.label)
      sub.style.display = 'none'
      sub.style.position = 'absolute'
      sub.style.left = '100%'
      sub.style.top = '0'
      const show = () => {
        sub.style.display = 'block'
        trigger.setAttribute('aria-expanded', 'true')
      }
      trigger.addEventListener('click', (event) => {
        event.stopPropagation()
        show()
      })
      wrap.addEventListener('pointerenter', show)
      wrap.addEventListener('pointerleave', () => {
        sub.style.display = 'none'
        trigger.setAttribute('aria-expanded', 'false')
      })
      wrap.append(trigger, sub)
      menu.append(wrap)
    } else {
      menu.append(leafButton(item, choose))
    }
  }
  return menu
}

/** Shows `items` and resolves with the chosen id, or null. A second menu closes the first. */
export function popupMenu(items: ReadonlyArray<ContextMenuItem>, at?: ContextMenuAt): Promise<string | null> {
  close?.()
  return new Promise((resolve) => {
    const focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const finish = (id: string | null) => {
      if (close !== done) return
      close = undefined
      menu.remove()
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', keys, true)
      window.removeEventListener('blur', cancel)
      focusBefore?.focus({ preventScroll: true })
      resolve(id)
    }
    const done = () => finish(null)
    const cancel = () => finish(null)
    const menu = list(items, (id) => finish(id), 'Context menu')
    menu.dataset['junoWebMenu'] = ''
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) finish(null)
    }
    const keys = (event: KeyboardEvent) => {
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled), :scope > div > button:not(:disabled)')]
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape') finish(null)
      else if (event.key === 'ArrowDown') buttons[(at + 1) % buttons.length]?.focus()
      else if (event.key === 'ArrowUp') buttons[(at - 1 + buttons.length) % buttons.length]?.focus()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    close = done
    document.body.append(menu)
    const where = at ?? pointer
    const box = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(0, Math.min(where.x, window.innerWidth - box.width))}px`
    menu.style.top = `${Math.max(0, Math.min(where.y, window.innerHeight - box.height))}px`
    // A press that opened the menu must not close it: listen from the next task.
    setTimeout(() => {
      if (close !== done) return
      window.addEventListener('pointerdown', outside, true)
      window.addEventListener('keydown', keys, true)
      window.addEventListener('blur', cancel)
    })
  })
}
