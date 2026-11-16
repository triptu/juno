/**
 * The app menu's commands and shortcuts, shared by main and the renderer.
 * No runtime dependencies, as `channels.ts`, which re-exports them.
 */

/**
 * The app-menu items main hands to the renderer (architecture, shortcuts):
 * the tab keys, Back and Forward (also the three-finger swipe), Hide
 * Sidebar, Hide Message Text (⌃⌘H), ⌘J for Juno, ⌘K for the palette, Edit › Undo, which undoes typing in a text field or else
 * Juno's last action, Settings (⌘,), which opens Settings, Check for
 * Updates…, which main starts and the renderer shows in Settings › About, Help › Show
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
  /** ⌘⇧F: the Search tab (SPEC 10a). Its field when a Search tab is active, else Search in the current tab. */
  | 'search.open'
  /** ⌘F: Search scoped to the topic the tab shows (a thread, or a Main's conversation). Elsewhere as ⌘⇧F. */
  | 'search.topic'
  | 'edit.undo'
  | 'settings.open'
  /** Juno › Check for Updates…: main has started the check; the renderer opens Settings › About to show it. */
  | 'settings.about'
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
 * The app menu's shortcuts on the Mac, in Electron's accelerator form. Main
 * registers them and the renderer labels them (`@juno/views`' `menuKeys`),
 * both through `menuAccelerator`, so a key changes in one place.
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
  'search.open': 'CommandOrControl+Shift+F',
  'search.topic': 'CommandOrControl+F',
  'edit.undo': 'CommandOrControl+Z',
  'settings.open': 'CommandOrControl+,',
  // Shown in the menu only: the page takes the key, so it also works where the menu does not see it (SPEC 20).
  'huddle.mute': 'Shift+CommandOrControl+Space',
} as const satisfies Partial<Record<MenuCommand, string>>

/**
 * Where Windows takes other keys than the Mac (decision D2). Ctrl+S is Save
 * in most Windows apps and Ctrl+H is Replace or History, so Hide Sidebar and
 * Hide Message Text add Shift there. Every other command's
 * `CommandOrControl` is Ctrl on Windows.
 */
const windowsShortcuts = {
  'sidebar.toggle': 'Control+Shift+S',
  'privacy.toggle': 'Control+Shift+H',
} as const satisfies Partial<Record<keyof typeof menuShortcuts, string>>

/** A menu command's accelerator on `platform`: main registers it and the page labels it, so the two cannot drift. */
export function menuAccelerator(command: keyof typeof menuShortcuts, platform: 'mac' | 'windows'): string {
  return (platform === 'windows' ? (windowsShortcuts as Partial<Record<keyof typeof menuShortcuts, string>>)[command] : undefined) ?? menuShortcuts[command]
}
