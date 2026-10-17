import type { BrowserWindow, ContextMenuParams, WebContents } from 'electron'
import type { ContextMenuItem } from '@juno/contract'
import { openInBrowser } from './browser'
import { popupContextMenu } from './contextMenu'

/** Look Up's label quotes at most this many characters of the selection, as macOS shortens it. */
const LOOK_UP_CHARS = 24

/**
 * The standard macOS text menu, for a page Juno shows (the app page, sign-in):
 * spelling, Look Up and Search with Google, then the edit items. It opens only
 * on a text field or selected text.
 *
 * Juno's own menus win. A renderer handler that opens one calls preventDefault
 * on the contextmenu event, and Chromium then sends no `context-menu` here, so
 * this menu shows only where no Juno menu opened. The web panel has its own
 * menu (webPanel.ts).
 */
export function wireTextMenu(window: BrowserWindow): void {
  const contents = window.webContents
  contents.on('context-menu', (_event, params) => void showTextMenu(window, contents, params))
}

/** The menu's items for a right-click, or none when it is not on a field or a selection. */
function textMenuItems(params: ContextMenuParams): ContextMenuItem[] {
  const selected = params.formControlType === 'input-password' ? '' : params.selectionText.trim()
  const items: ContextMenuItem[] = []
  const section = (...next: ContextMenuItem[]) => {
    if (items.length > 0) items.push({ separator: true })
    items.push(...next)
  }
  if (params.isEditable && params.misspelledWord !== '') {
    const guesses = params.dictionarySuggestions
    section(
      ...(guesses.length === 0 ? [{ id: 'no-guesses', label: 'No Guesses Found', enabled: false }] : guesses.map((word) => ({ id: `replace:${word}`, label: word }))),
    )
    section({ id: 'learn-spelling', label: 'Learn Spelling' })
  }
  if (selected !== '') {
    section(
      // Look Up is the macOS dictionary panel; other systems have none.
      ...(process.platform === 'darwin' ? [{ id: 'look-up', label: `Look Up “${shorten(selected)}”` }] : []),
      { id: 'search', label: 'Search with Google' },
    )
  }
  if (params.isEditable) {
    const flags = params.editFlags
    section(
      { id: 'cut', label: 'Cut', enabled: flags.canCut, accelerator: 'CommandOrControl+X' },
      { id: 'copy', label: 'Copy', enabled: flags.canCopy, accelerator: 'CommandOrControl+C' },
      { id: 'paste', label: 'Paste', enabled: flags.canPaste, accelerator: 'CommandOrControl+V' },
      { id: 'paste-and-match-style', label: 'Paste and Match Style', enabled: flags.canPaste, accelerator: 'Alt+Shift+CommandOrControl+V' },
      { id: 'select-all', label: 'Select All', enabled: flags.canSelectAll, accelerator: 'CommandOrControl+A' },
    )
  } else if (selected !== '') {
    section({ id: 'copy', label: 'Copy', enabled: params.editFlags.canCopy, accelerator: 'CommandOrControl+C' })
  }
  return items
}

async function showTextMenu(window: BrowserWindow, contents: WebContents, params: ContextMenuParams): Promise<void> {
  const items = textMenuItems(params)
  if (items.length === 0) return
  // Where Chromium says, so the context-menu key opens it at the field, not under the pointer.
  const chosen = await popupContextMenu(items, window, { x: params.x, y: params.y })
  if (chosen === null || contents.isDestroyed()) return
  if (chosen.startsWith('replace:')) return contents.replaceMisspelling(chosen.slice('replace:'.length))
  switch (chosen) {
    case 'learn-spelling':
      return void contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
    case 'look-up':
      return contents.showDefinitionForSelection()
    case 'search':
      return openInBrowser(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText.trim())}`)
    case 'cut':
      return contents.cut()
    case 'copy':
      return contents.copy()
    case 'paste':
      return contents.paste()
    case 'paste-and-match-style':
      return contents.pasteAndMatchStyle()
    case 'select-all':
      return contents.selectAll()
  }
}

function shorten(text: string): string {
  const line = text.replace(/\s+/g, ' ')
  return line.length <= LOOK_UP_CHARS ? line : `${line.slice(0, LOOK_UP_CHARS).trimEnd()}…`
}
