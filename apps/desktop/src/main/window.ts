import { app, BrowserWindow, Menu, nativeTheme, screen, shell, type BaseWindow, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions, type Rectangle } from 'electron'
import { join } from 'node:path'
import { DEFAULT_ACCENT, DEFAULT_DENSITY, DEFAULT_SIDEBAR, Events, menuShortcuts, type HuddleMenu, type MenuCommand, type Theme } from '@juno/contract'
import { BACKGROUND, type Launch } from './launch'
import { APP_URL } from './scheme'
import { startupMark } from './startupMarks'
import { wireTextMenu } from './textMenu'
import { refitWebPanel } from './webPanel'

/** The background a window paints in before the page loads. System follows macOS. */
const backgroundFor = (theme: Theme): string => BACKGROUND[theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme]

/** Height of the drag strip drawn by the renderer. Keep in sync with --titlebar-height. */
const TITLEBAR_HEIGHT = 44
/** macOS traffic lights are 12px tall; centre them in the strip. */
const TRAFFIC_LIGHT_SIZE = 12

/** The smallest main window at 100% zoom, in CSS pixels: the 384px sidebar and a usable workspace. */
const MIN_WIDTH = 720
const MIN_HEIGHT = 480
/** One step of View > Zoom In or Zoom Out, as in Chromium. Levels are powers of 1.2. */
const ZOOM_STEP = 0.5
/** Chromium's range, 25% to 500%. */
const ZOOM_LEVELS = { min: -7.5, max: 8.5 }

/**
 * The only way windows get created. Secure web preferences are fixed here and
 * cannot be overridden by callers.
 */
export function createWindow(options: BrowserWindowConstructorOptions = {}): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    backgroundColor: BACKGROUND.light,
    ...options,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 14, y: Math.round((TITLEBAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2) },
        }
      : {}),
    webPreferences: {
      ...options.webPreferences,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: true,
      // Cache the bundle's compiled code on the first run, not after a heat check.
      v8CacheOptions: 'bypassHeatCheck',
    },
  })

  // The renderer never navigates away from the app and never opens windows.
  // External links go to the system browser.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Cut, Copy, Paste and spelling for fields and selections no Juno menu takes.
  wireTextMenu(window)

  // ready-to-show fires after the first paint; the shell paints with no data.
  window.once('ready-to-show', () => window.show())
  return window
}

/** Windows that show the app page, which take the tab commands. Others (sign-in) just close on ⌘W. */
const mainWindows = new WeakSet<BaseWindow>()

/** The window that shows the app page, if one is open. */
export function appWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((window) => mainWindows.has(window) && !window.isDestroyed())
}

/**
 * What the page starts with: the saved launch values, with privacy mode as it is now. The screen
 * watch may have turned it on (`privacySharing`), which is not saved, so only a reload sees it.
 */
export type PageLaunch = Launch & { readonly privacySharing?: boolean }

/** Each app window's way to read the current launch values, for a reload. */
const launchOf = new WeakMap<BaseWindow, () => PageLaunch>()

/**
 * `launch` reads the current launch values: the page takes its first state
 * (theme, privacy, sidebar) from its URL, so a reload builds the URL again
 * rather than loading the one the window opened with.
 */
export function createMainWindow(currentLaunch: () => PageLaunch): BrowserWindow {
  startupMark('window')
  const launch = currentLaunch()
  const window = createWindow({
    title: 'Juno',
    width: 1200,
    height: 800,
    ...onScreen(launch.bounds),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: backgroundFor(launch.theme),
  })

  mainWindows.add(window)
  launchOf.set(window, currentLaunch)
  setAppMenu({ sidebarHidden: launch.sidebar?.collapsed ?? false, privacy: launch.privacy === true, huddle: null })
  // The three-finger swipe (Electron does not see the two-finger one): left is Back, as in Safari.
  window.on('swipe', (_event, direction) => {
    if (direction === 'left') tabCommand(window, 'history.back')
    else if (direction === 'right') tabCommand(window, 'history.forward')
  })
  // Esc in the media viewer's PDF or HTML frame stays in the frame; the page closes the viewer when a frame of it has focus.
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') window.webContents.send(Events.menuCommand, 'frame.escape')
  })
  // Zoom outlives a reload (Chromium keeps it per origin), and pinch or
  // Control-scroll can change it without the menu.
  window.webContents.on('did-finish-load', () => fitMinimumSizeToZoom(window))
  window.webContents.on('zoom-changed', () => setImmediate(() => fitMinimumSizeToZoom(window)))
  // macOS hides the traffic lights in full screen, so the title bars drop the room they keep for them.
  // Both events come as the animation ends: the lights are already gone on entry, and come back on exit.
  window.on('enter-full-screen', () => window.webContents.send(Events.windowFullScreen, true))
  window.on('leave-full-screen', () => window.webContents.send(Events.windowFullScreen, false))

  void window.loadURL(appPageUrl(launch))
  startupMark('window-made')
  window.once('ready-to-show', () => startupMark('shown'))

  return window
}

/** The app page for `launch`. electron-vite sets ELECTRON_RENDERER_URL in dev for the Vite server. */
function appPageUrl(launch: PageLaunch, fullScreen = false): string {
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  return pageUrl(devUrl || APP_URL, launch, fullScreen)
}

/**
 * View › Reload. The app page loads again with the current launch values,
 * so a setting changed since the window opened, privacy mode above all,
 * is not undone by a reload. Other windows reload as they are.
 */
function reload(window: BaseWindow | undefined, ignoringCache: boolean): void {
  if (window === undefined || window.isDestroyed() || !(window instanceof BrowserWindow)) return
  const launch = launchOf.get(window)
  if (launch !== undefined) void window.loadURL(appPageUrl(launch(), window.isFullScreen()), ignoringCache ? { extraHeaders: 'pragma: no-cache\n' } : {})
  else if (ignoringCache) window.webContents.reloadIgnoringCache()
  else window.webContents.reload()
}

/**
 * The saved bounds, when they still show on a display. A window saved on a
 * display that is gone opens centred on the main one, at its saved size
 * within that display.
 */
function onScreen(bounds: Launch['bounds']): Partial<Rectangle> {
  if (bounds === undefined) return {}
  const visible = screen.getAllDisplays().some(({ workArea }) => {
    const width = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x)
    const height = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y)
    // Enough of the window, including its title strip, to grab and move it.
    return width >= 100 && height >= TITLEBAR_HEIGHT && bounds.y >= workArea.y - TITLEBAR_HEIGHT / 2
  })
  if (visible) return bounds
  const { workArea } = screen.getPrimaryDisplay()
  return { width: Math.min(bounds.width, workArea.width), height: Math.min(bounds.height, workArea.height) }
}

/**
 * Keeps the minimum window size fixed in CSS pixels, so at 200% zoom the
 * window can never be narrower than the sidebar. Zooming out keeps the
 * 100% minimum. A window smaller than the new minimum grows to it, within
 * the screen.
 */
export function fitMinimumSizeToZoom(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  const factor = Math.max(1, window.webContents.getZoomFactor())
  const { workArea } = screen.getDisplayMatching(window.getBounds())
  const width = Math.min(Math.round(MIN_WIDTH * factor), workArea.width)
  const height = Math.min(Math.round(MIN_HEIGHT * factor), workArea.height)
  window.setMinimumSize(width, height)
  const [currentWidth = width, currentHeight = height] = window.getSize()
  if (currentWidth < width || currentHeight < height) window.setSize(Math.max(currentWidth, width), Math.max(currentHeight, height))
}

function zoom(window: BaseWindow | undefined, step: number | 'reset'): void {
  const target = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
  if (target === null) return
  const contents = target.webContents
  const level = step === 'reset' ? 0 : Math.min(ZOOM_LEVELS.max, Math.max(ZOOM_LEVELS.min, contents.getZoomLevel() + step))
  contents.setZoomLevel(level)
  fitMinimumSizeToZoom(target)
  refitWebPanel(target)
}

/** Hands a menu command to the app page of `window`. In any other window ⌘W closes it and ⌘Z is the plain undo. */
function tabCommand(window: BaseWindow | undefined, command: MenuCommand): void {
  if (window === undefined || window.isDestroyed()) return
  if (!mainWindows.has(window) || !(window instanceof BrowserWindow)) {
    if (command === 'tab.close') window.close()
    if (command === 'edit.undo' && window instanceof BrowserWindow) window.webContents.undo()
    return
  }
  window.webContents.send(Events.menuCommand, command)
}

/** What the menu's labels follow: Hide or Show Sidebar, Hide or Show Message Text, and the Huddle menu's call. */
interface MenuState {
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

/** A menu item that hands `command` to the focused app window. */
const command = (id: string, label: string, accelerator: string | undefined, menuCommand: MenuCommand, hidden = false): MenuItemConstructorOptions => ({
  id,
  label,
  ...(accelerator === undefined ? {} : { accelerator }),
  ...(hidden ? { visible: false, acceleratorWorksWhenHidden: true } : {}),
  click: (_item, window) => tabCommand(window, menuCommand),
})

const tabNumbers = [1, 2, 3, 4, 5, 6, 7, 8] as const

/**
 * The app menu (architecture, shortcuts): Electron's default menu with the
 * tab, history and sidebar items, which the renderer acts on, and the zoom
 * items wired through `fitMinimumSizeToZoom`: the default roles change the
 * zoom without telling main, so the minimum size could not follow.
 */
function setAppMenu(state: MenuState, rebuild = false): void {
  if (menuState !== undefined && !rebuild) return
  menuState = state
  const view: MenuItemConstructorOptions[] = [
    command('toggle-sidebar', state.sidebarHidden ? 'Show Sidebar' : 'Hide Sidebar', menuShortcuts['sidebar.toggle'], 'sidebar.toggle'),
    // Privacy mode (SPEC section 5): blurs message text for screen sharing.
    command('toggle-privacy', state.privacy ? 'Show Message Text' : 'Hide Message Text', menuShortcuts['privacy.toggle'], 'privacy.toggle'),
    // In a topic tab ⌘J opens or closes the Juno panel; elsewhere it opens the Juno tab.
    command('juno', 'Juno', menuShortcuts['juno.toggle'], 'juno.toggle'),
    { type: 'separator' },
    { id: 'reload', label: 'Reload', accelerator: 'CommandOrControl+R', click: (_item, window) => reload(window, false) },
    { id: 'force-reload', label: 'Force Reload', accelerator: 'Shift+CommandOrControl+R', click: (_item, window) => reload(window, true) },
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
  const file: MenuItemConstructorOptions[] = [
    command('new-message', 'New Message', menuShortcuts['chat.new'], 'chat.new'),
    command('new-tab', 'New Tab', menuShortcuts['tab.new'], 'tab.new'),
    command('reopen-tab', 'Reopen Closed Tab', menuShortcuts['tab.reopen'], 'tab.reopen'),
    { type: 'separator' },
    command('close-tab', 'Close Tab', menuShortcuts['tab.close'], 'tab.close'),
    { role: 'close', accelerator: 'CommandOrControl+Shift+W' },
  ]
  // Undo has no role: the renderer undoes typing in a text field that has
  // text, and otherwise Juno's last action (architecture, shortcuts).
  const edit: MenuItemConstructorOptions[] = [
    command('undo', 'Undo', menuShortcuts['edit.undo'], 'edit.undo'),
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'pasteAndMatchStyle' },
    { role: 'delete' },
    { role: 'selectAll' },
  ]
  const go: MenuItemConstructorOptions[] = [
    command('back', 'Back', menuShortcuts['history.back'], 'history.back'),
    command('forward', 'Forward', menuShortcuts['history.forward'], 'history.forward'),
    { type: 'separator' },
    // ⌘K (SPEC section 10) opens the palette, and closes it again.
    command('search', 'Search and Commands…', menuShortcuts['palette.toggle'], 'palette.toggle'),
    // The Search tab (SPEC 10a): ⌘⇧F everywhere, ⌘F scoped to the topic the tab shows.
    command('search-messages', 'Search Messages', menuShortcuts['search.open'], 'search.open'),
    command('search-topic', 'Search in This Topic', menuShortcuts['search.topic'], 'search.topic'),
  ]
  // The Huddle menu (SPEC 20), dimmed while the user is in no huddle.
  const inHuddle = state.huddle !== null
  const huddle: MenuItemConstructorOptions[] = [
    { ...command('huddle-show', 'Show Huddle', undefined, 'huddle.show'), enabled: inHuddle },
    // The page takes ⌘⇧Space itself, so the menu only shows it.
    {
      ...command('huddle-mute', state.huddle?.muted === true ? 'Unmute Microphone' : 'Mute Microphone', menuShortcuts['huddle.mute'], 'huddle.mute'),
      registerAccelerator: false,
      enabled: inHuddle,
    },
    { ...command('huddle-share', state.huddle?.sharing === true ? 'Stop Sharing' : 'Share Screen…', undefined, 'huddle.share'), enabled: state.huddle?.sharing === true || state.huddle?.canShare === true },
    { type: 'separator' },
    { ...command('huddle-leave', 'Leave Huddle', undefined, 'huddle.leave'), enabled: inHuddle },
  ]
  const windowItems: MenuItemConstructorOptions[] = [
    { role: 'minimize' },
    { role: 'zoom' },
    { type: 'separator' },
    command('previous-tab', 'Show Previous Tab', menuShortcuts['tab.previous'], 'tab.previous'),
    command('next-tab', 'Show Next Tab', menuShortcuts['tab.next'], 'tab.next'),
    command('previous-tab-control', 'Show Previous Tab', 'Control+Shift+Tab', 'tab.previous', true),
    command('next-tab-control', 'Show Next Tab', 'Control+Tab', 'tab.next', true),
    // ⌘1 to ⌘8 by position, ⌘9 the last tab, as in browsers. Hidden, as Safari hides them.
    ...tabNumbers.map((n) => command(`tab-${n}`, `Show Tab ${n}`, `CommandOrControl+${n}`, `tab.select.${n}`, true)),
    command('tab-last', 'Show Last Tab', 'CommandOrControl+9', 'tab.select.9', true),
    { type: 'separator' },
    { role: 'front' },
  ]
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about' },
                // Checks at once and opens Settings › About, where the result shows (SPEC 14).
                { id: 'check-for-updates', label: 'Check for Updates…', click: (_item, window) => { checkForUpdates(); tabCommand(window, 'settings.about') } },
                { type: 'separator' },
                command('settings', 'Settings…', menuShortcuts['settings.open'], 'settings.open'),
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            } satisfies MenuItemConstructorOptions,
          ]
        : []),
      { label: 'File', submenu: file },
      { label: 'Edit', submenu: edit },
      { label: 'View', submenu: view },
      { label: 'Go', submenu: go },
      { label: 'Huddle', submenu: huddle },
      { role: 'window', submenu: windowItems },
      // The welcome card (SPEC 4, "The welcome"), again on Home whenever the owner wants it.
      { role: 'help', submenu: [{ id: 'tour', label: 'Show the Tour', click: (_item, window) => tabCommand(window, 'tour.show') }] },
    ]),
  )
}

/**
 * The page reads `?theme=`, `?accent=`, `?density=`, `?privacy=` and `?sidebar=` so its first render matches the window background, the saved
 * accent, density and privacy mode, and the saved sidebar. `?session=` is the last verified session, so a relaunch renders the shell first. `?fullscreen=1` is a reload in full screen, so the title bars start without the
 * traffic lights' room. `?tour=manual` (tests only) keeps the welcome card from showing by itself.
 */
function pageUrl(base: string, launch: PageLaunch, fullScreen: boolean): string {
  const url = new URL(base)
  url.searchParams.set('theme', launch.theme)
  url.searchParams.set('accent', launch.accent ?? DEFAULT_ACCENT)
  url.searchParams.set('density', launch.density ?? DEFAULT_DENSITY)
  if (launch.topicTitleLines !== undefined) url.searchParams.set('topicTitleLines', launch.topicTitleLines)
  // `sharing` when it is on because the screen is shared, so the footer says why from the first frame.
  if (launch.privacy === true) url.searchParams.set('privacy', launch.privacySharing === true ? 'sharing' : 'on')
  const sidebar = launch.sidebar ?? DEFAULT_SIDEBAR
  url.searchParams.set('sidebar', `${sidebar.width}${sidebar.collapsed ? '-hidden' : ''}`)
  if (launch.session !== undefined) url.searchParams.set('session', JSON.stringify(launch.session))
  if (fullScreen) url.searchParams.set('fullscreen', '1')
  // Under JUNO_E2E the welcome card shows only when asked, unless the test wants it to show by itself (JUNO_E2E_TOUR).
  if (process.env.JUNO_E2E === '1' && process.env.JUNO_E2E_TOUR !== '1') url.searchParams.set('tour', 'manual')
  return url.toString()
}
