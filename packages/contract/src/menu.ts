/**
 * The app menu's commands and shortcuts, shared by main and the renderer.
 * No runtime dependencies, as `channels.ts`, which re-exports them.
 */

/**
 * The app-menu items main hands to the renderer (architecture, shortcuts):
 * the tab keys, Back and Forward (also the three-finger swipe), Hide
 * Sidebar, Hide Message Text (⌃⌘H), ⌘J for Juno, ⌘K for the palette, Edit › Undo, which undoes typing in a text field or else
 * Juno's last action, Settings (⌘,), which opens Settings, Help › Show
 * the Tour, which brings the welcome card back on Home (SPEC 4), and the
 * Huddle menu (SPEC 20).
 */
export type MenuCommand =
  /** ⌘T: a new tab with Home. */
  | 'tab.new'
  /** ⌘N: write a message from Home, with the destination list open. */
  | 'chat.new'
  | 'tab.close'
  | 'tab.reopen'
  | 'tab.next'
  | 'tab.previous'
  | `tab.select.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | 'history.back'
  | 'history.forward'
  | 'sidebar.toggle'
  | 'privacy.toggle'
  | 'juno.toggle'
  | 'palette.toggle'
  | 'edit.undo'
  | 'settings.open'
  /** Esc, from main, which sees every key: a key pressed in a frame (the media viewer's PDF or HTML file) never reaches the page. No menu item. */
  | 'frame.escape'
  /** Help › Show the Tour. No shortcut. */
  | 'tour.show'
  /** Huddle › Show Huddle: the huddle tab, focused or opened. */
  | 'huddle.show'
  /** Huddle › Mute Microphone or Unmute Microphone. */
  | 'huddle.mute'
  /** Huddle › Share Screen… (the share sheet) or Stop Sharing. */
  | 'huddle.share'
  | 'huddle.leave'

/**
 * The app menu's shortcuts, in Electron's accelerator form. Main registers
 * them; the renderer shows them in tooltips and hints through
 * `shortcutKeys`, so a key changes in one place.
 */
export const menuShortcuts = {
  'chat.new': 'CommandOrControl+N',
  'tab.new': 'CommandOrControl+T',
  'tab.reopen': 'CommandOrControl+Shift+T',
  'tab.close': 'CommandOrControl+W',
  'tab.previous': 'CommandOrControl+Shift+[',
  'tab.next': 'CommandOrControl+Shift+]',
  'history.back': 'CommandOrControl+[',
  'history.forward': 'CommandOrControl+]',
  'sidebar.toggle': 'Control+Command+S',
  'privacy.toggle': 'Control+Command+H',
  'juno.toggle': 'CommandOrControl+J',
  'palette.toggle': 'CommandOrControl+K',
  'edit.undo': 'CommandOrControl+Z',
  'settings.open': 'CommandOrControl+,',
  // Shown in the menu only: the page takes the key, so it also works where the menu does not see it (SPEC 20).
  'huddle.mute': 'Shift+CommandOrControl+Space',
} as const satisfies Partial<Record<MenuCommand, string>>

const keyGlyphs: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Plus: '+',
}
// macOS writes the modifiers in this order, whatever order the accelerator uses.
const modifierOrder = ['⌃', '⌥', '⇧', '⌘']

/** An accelerator as the Mac writes it: "Control+Command+S" is "⌃⌘S". */
export function shortcutKeys(accelerator: string): string {
  const parts = accelerator.split('+').map((part) => keyGlyphs[part] ?? part)
  const key = parts.at(-1) ?? ''
  const modifiers = parts.slice(0, -1).toSorted((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b))
  return [...modifiers, key].join('')
}

/** The keys of an app-menu command, as the Mac writes them ("⌘["). */
export function menuKeys(command: keyof typeof menuShortcuts): string {
  return shortcutKeys(menuShortcuts[command])
}
