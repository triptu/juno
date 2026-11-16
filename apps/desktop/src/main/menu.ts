/**
 * The app menu (architecture, shortcuts): Electron's default menu with the
 * tab, history and sidebar items, which the renderer acts on, and the zoom
 * items wired through `fitMinimumSizeToZoom`: the default roles change the
 * zoom without telling main, so the minimum size could not follow.
 *
 * On Windows the menu is set but not shown: the window has no frame for a
 * menu bar (`window.ts`), and the menu is there for its accelerators.
 * Settings and Exit go in File and About in Help, as Windows apps place
 * them; the Mac keeps them in the app menu.
 */
import { app, BrowserWindow, Menu, type BaseWindow, type MenuItemConstructorOptions } from 'electron'
import { menuAccelerator, type HuddleMenu, type MenuCommand, type menuShortcuts } from '@juno/contract'
import { fitMinimumSizeToZoom, reloadWindow, tabCommand } from './window'
import { refitWebPanel } from './webPanel'

const windows = process.platform === 'win32'

/** One step of View > Zoom In or Zoom Out, as in Chromium. Levels are powers of 1.2. */
const ZOOM_STEP = 0.5
/** Chromium's range, 25% to 500%. */
const ZOOM_LEVELS = { min: -7.5, max: 8.5 }

function zoom(window: BaseWindow | undefined, step: number | 'reset'): void {
  const target = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
  if (target === null) return
  const contents = target.webContents
  const level = step === 'reset' ? 0 : Math.min(ZOOM_LEVELS.max, Math.max(ZOOM_LEVELS.min, contents.getZoomLevel() + step))
  contents.setZoomLevel(level)
  fitMinimumSizeToZoom(target)
  refitWebPanel(target)
}

/** What the menu's labels follow: Hide or Show Sidebar, Hide or Show Message Text, and the Huddle menu's call. */
export interface MenuState {
  readonly sidebarHidden: boolean
  readonly privacy: boolean
  readonly huddle: HuddleMenu
}

/** The state the menu was built with; undefined until the first window. */
let menuState: MenuState | undefined

/** Rebuilds the app menu when the state its labels name changes, so View names the action it will take. */
function updateAppMenu(patch: Partial<MenuState>): void {
  if (menuState === undefined) return
  const next = { ...menuState, ...patch }
  if (next.sidebarHidden !== menuState.sidebarHidden || next.privacy !== menuState.privacy || next.huddle?.muted !== menuState.huddle?.muted || next.huddle?.sharing !== menuState.huddle?.sharing || next.huddle?.canShare !== menuState.huddle?.canShare) setAppMenu(next, true)
}

export function setSidebarHidden(sidebarHidden: boolean): void {
  updateAppMenu({ sidebarHidden })
}

export function setMenuPrivacy(privacy: boolean): void {
  updateAppMenu({ privacy })
}

export function setMenuHuddle(huddle: HuddleMenu): void {
  updateAppMenu({ huddle })
}

/** The app menu's Check for Updates…, set by index.ts once the updater exists. */
let checkForUpdates = () => {}

export function setMenuCheckForUpdates(check: () => void): void {
  checkForUpdates = check
}

/** A command's accelerator on this platform. */
const keys = (name: keyof typeof menuShortcuts) => menuAccelerator(name, windows ? 'windows' : 'mac')

/** A menu item that hands `command` to the focused app window. */
const command = (id: string, label: string, accelerator: string | undefined, menuCommand: MenuCommand, hidden = false): MenuItemConstructorOptions => ({
  id,
  label,
  ...(accelerator === undefined ? {} : { accelerator }),
  ...(hidden ? { visible: false, acceleratorWorksWhenHidden: true } : {}),
  click: (_item, window) => tabCommand(window, menuCommand),
})

const tabNumbers = [1, 2, 3, 4, 5, 6, 7, 8] as const

const viewItems = (state: MenuState): MenuItemConstructorOptions[] => [
  command('toggle-sidebar', state.sidebarHidden ? 'Show Sidebar' : 'Hide Sidebar', keys('sidebar.toggle'), 'sidebar.toggle'),
  // Privacy mode (SPEC section 5): blurs message text for screen sharing.
  command('toggle-privacy', state.privacy ? 'Show Message Text' : 'Hide Message Text', keys('privacy.toggle'), 'privacy.toggle'),
  // In a topic tab ⌘J opens or closes the Juno panel; elsewhere it opens the Juno tab.
  command('juno', 'Juno', keys('juno.toggle'), 'juno.toggle'),
  { type: 'separator' },
  { id: 'reload', label: 'Reload', accelerator: 'CommandOrControl+R', click: (_item, window) => reloadWindow(window, false) },
  { id: 'force-reload', label: 'Force Reload', accelerator: 'Shift+CommandOrControl+R', click: (_item, window) => reloadWindow(window, true) },
  { role: 'toggleDevTools' },
  { type: 'separator' },
  { id: 'zoom-reset', label: 'Actual Size', accelerator: 'CommandOrControl+0', click: (_item, window) => zoom(window, 'reset') },
  { id: 'zoom-in', label: 'Zoom In', accelerator: 'CommandOrControl+Plus', click: (_item, window) => zoom(window, ZOOM_STEP) },
  // Command-= without Shift, as browsers accept it.
  { label: 'Zoom In', accelerator: 'CommandOrControl+=', visible: false, acceleratorWorksWhenHidden: true, click: (_item, window) => zoom(window, ZOOM_STEP) },
  { id: 'zoom-out', label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: (_item, window) => zoom(window, -ZOOM_STEP) },
  { type: 'separator' },
  { role: 'togglefullscreen' },
]

// ⌘N writes a message from Home and ⌘T opens a new tab with Home (spec
  // sections 6 and 12). ⌘W closes the tab, not the window; ⌘⇧W closes the window.
const fileItems = (): MenuItemConstructorOptions[] => [
  command('new-message', 'New Message', keys('chat.new'), 'chat.new'),
  command('new-tab', 'New Tab', keys('tab.new'), 'tab.new'),
  command('reopen-tab', 'Reopen Closed Tab', keys('tab.reopen'), 'tab.reopen'),
  { type: 'separator' },
  command('close-tab', 'Close Tab', keys('tab.close'), 'tab.close'),
  { role: 'close', accelerator: 'CommandOrControl+Shift+W' },
  ...(windows
    ? [{ type: 'separator' }, command('settings', 'Settings…', keys('settings.open'), 'settings.open'), { type: 'separator' }, { role: 'quit' }] satisfies MenuItemConstructorOptions[]
    : []),
]

// Undo has no role: the renderer undoes typing in a text field that has
  // text, and otherwise Juno's last action (architecture, shortcuts).
const editItems = (): MenuItemConstructorOptions[] => [
  command('undo', 'Undo', keys('edit.undo'), 'edit.undo'),
  { role: 'redo' },
  { type: 'separator' },
  { role: 'cut' },
  { role: 'copy' },
  { role: 'paste' },
  { role: 'pasteAndMatchStyle' },
  { role: 'delete' },
  { role: 'selectAll' },
]

const goItems = (): MenuItemConstructorOptions[] => [
  command('back', 'Back', keys('history.back'), 'history.back'),
  command('forward', 'Forward', keys('history.forward'), 'history.forward'),
  { type: 'separator' },
  // ⌘K (SPEC section 10) opens the palette, and closes it again.
  command('search', 'Search and Commands…', keys('palette.toggle'), 'palette.toggle'),
  // The Search tab (SPEC 10a): ⌘⇧F everywhere, ⌘F scoped to the topic the tab shows.
  command('search-messages', 'Search Messages', keys('search.open'), 'search.open'),
  command('search-topic', 'Search in This Topic', keys('search.topic'), 'search.topic'),
]

// The Huddle menu (SPEC 20), dimmed while the user is in no huddle.
function huddleItems(state: MenuState): MenuItemConstructorOptions[] {
  const inHuddle = state.huddle !== null
  return [
    { ...command('huddle-show', 'Show Huddle', undefined, 'huddle.show'), enabled: inHuddle },
    // The page takes ⌘⇧Space itself, so the menu only shows it.
    {
      ...command('huddle-mute', state.huddle?.muted === true ? 'Unmute Microphone' : 'Mute Microphone', keys('huddle.mute'), 'huddle.mute'),
      registerAccelerator: false,
      enabled: inHuddle,
    },
    { ...command('huddle-share', state.huddle?.sharing === true ? 'Stop Sharing' : 'Share Screen…', undefined, 'huddle.share'), enabled: state.huddle?.sharing === true || state.huddle?.canShare === true },
    { type: 'separator' },
    { ...command('huddle-leave', 'Leave Huddle', undefined, 'huddle.leave'), enabled: inHuddle },
  ]
}

// Zoom and Bring All to Front are the Mac's alone.
const windowItems = (): MenuItemConstructorOptions[] => [
  { role: 'minimize' },
  ...(windows ? [] : [{ role: 'zoom' }] satisfies MenuItemConstructorOptions[]),
  { type: 'separator' },
  command('previous-tab', 'Show Previous Tab', keys('tab.previous'), 'tab.previous'),
  command('next-tab', 'Show Next Tab', keys('tab.next'), 'tab.next'),
  command('previous-tab-control', 'Show Previous Tab', 'Control+Shift+Tab', 'tab.previous', true),
  command('next-tab-control', 'Show Next Tab', 'Control+Tab', 'tab.next', true),
  // ⌘1 to ⌘8 by position, ⌘9 the last tab, as in browsers. Hidden, as Safari hides them.
  ...tabNumbers.map((n) => command(`tab-${n}`, `Show Tab ${n}`, `CommandOrControl+${n}`, `tab.select.${n}`, true)),
  command('tab-last', 'Show Last Tab', 'CommandOrControl+9', 'tab.select.9', true),
  ...(windows ? [] : [{ type: 'separator' }, { role: 'front' }] satisfies MenuItemConstructorOptions[]),
]

const helpItems = (): MenuItemConstructorOptions[] => [
  // The welcome card (SPEC 4, "The welcome"), again on Home whenever the owner wants it.
  { id: 'tour', label: 'Show the Tour', click: (_item, window) => tabCommand(window, 'tour.show') },
  // Settings › About, which has the version; Windows has no app menu for the Mac's About panel.
  ...(windows ? [{ type: 'separator' }, command('about', `About ${app.name}`, undefined, 'settings.about')] satisfies MenuItemConstructorOptions[] : []),
]

// The Mac's app menu.
const appItems = (): MenuItemConstructorOptions[] => [
  { role: 'about' },
  // Checks at once and opens Settings › About, where the result shows (SPEC 14).
  { id: 'check-for-updates', label: 'Check for Updates…', click: (_item, window) => { checkForUpdates(); tabCommand(window, 'settings.about') } },
  { type: 'separator' },
  command('settings', 'Settings…', keys('settings.open'), 'settings.open'),
  { type: 'separator' },
  { role: 'services' },
  { type: 'separator' },
  { role: 'hide' },
  { role: 'hideOthers' },
  { role: 'unhide' },
  { type: 'separator' },
  { role: 'quit' },
]

/** Builds the menu the first time; later calls are ignored unless `rebuild`, when a label's state changed. */
export function setAppMenu(state: MenuState, rebuild = false): void {
  if (menuState !== undefined && !rebuild) return
  menuState = state
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: app.name, submenu: appItems() }] : []),
      { label: 'File', submenu: fileItems() },
      { label: 'Edit', submenu: editItems() },
      { label: 'View', submenu: viewItems(state) },
      { label: 'Go', submenu: goItems() },
      { label: 'Huddle', submenu: huddleItems(state) },
      { role: 'window', submenu: windowItems() },
      { role: 'help', submenu: helpItems() },
    ]),
  )
}
