import { app, BrowserWindow, Menu, screen, shell, type BaseWindow, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions, type Rectangle } from 'electron'
import { join } from 'node:path'
import { DEFAULT_ACCENT, DEFAULT_DENSITY, DEFAULT_SIDEBAR, Events, type MenuCommand } from '@juno/contract'
import { BACKGROUND, backgroundFor, type Launch } from './launch'
import { APP_URL } from './scheme'

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

/** Each app window's way to read the current launch values, for a reload. */
const launchOf = new WeakMap<BaseWindow, () => Launch>()

/**
 * `launch` reads the current launch values: the page takes its first state
 * (theme, privacy, sidebar) from its URL, so a reload builds the URL again
 * rather than loading the one the window opened with.
 */
export function createMainWindow(currentLaunch: () => Launch): BrowserWindow {
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
  setAppMenu({ sidebarHidden: launch.sidebar?.collapsed ?? false, privacy: launch.privacy === true })
  // The three-finger swipe (Electron does not see the two-finger one): left is Back, as in Safari.
  window.on('swipe', (_event, direction) => {
    if (direction === 'left') tabCommand(window, 'history.back')
    else if (direction === 'right') tabCommand(window, 'history.forward')
  })
  // Zoom outlives a reload (Chromium keeps it per origin), and pinch or
  // Control-scroll can change it without the menu.
  window.webContents.on('did-finish-load', () => fitMinimumSizeToZoom(window))
  window.webContents.on('zoom-changed', () => setImmediate(() => fitMinimumSizeToZoom(window)))

  void window.loadURL(appPageUrl(launch))

  return window
}

/** The app page for `launch`. electron-vite sets ELECTRON_RENDERER_URL in dev for the Vite server. */
function appPageUrl(launch: Launch): string {
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  return pageUrl(devUrl || APP_URL, launch)
}

/**
 * View › Reload. The app page loads again with the current launch values,
 * so a setting changed since the window opened, privacy mode above all,
 * is not undone by a reload. Other windows reload as they are.
 */
function reload(window: BaseWindow | undefined, ignoringCache: boolean): void {
  if (window === undefined || window.isDestroyed() || !(window instanceof BrowserWindow)) return
  const launch = launchOf.get(window)
  if (launch !== undefined) void window.loadURL(appPageUrl(launch()), ignoringCache ? { extraHeaders: 'pragma: no-cache\n' } : {})
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

/** What the View menu's labels follow: Hide or Show Sidebar, Hide or Show Message Text. */
interface MenuState {
  readonly sidebarHidden: boolean
  readonly privacy: boolean
}

/** The state the menu was built with; undefined until the first window. */
let menuState: MenuState | undefined

/** Rebuilds the app menu when the state its labels name changes, so View names the action it will take. */
function updateAppMenu(patch: Partial<MenuState>): void {
  if (menuState === undefined) return
  const next = { ...menuState, ...patch }
  if (next.sidebarHidden !== menuState.sidebarHidden || next.privacy !== menuState.privacy) setAppMenu(next, true)
}

export function setSidebarHidden(sidebarHidden: boolean): void {
  updateAppMenu({ sidebarHidden })
}

export function setMenuPrivacy(privacy: boolean): void {
  updateAppMenu({ privacy })
}

/** A menu item that hands `command` to the focused app window. */
const command = (id: string, label: string, accelerator: string, menuCommand: MenuCommand, hidden = false): MenuItemConstructorOptions => ({
  id,
  label,
  accelerator,
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
    command('toggle-sidebar', state.sidebarHidden ? 'Show Sidebar' : 'Hide Sidebar', 'Control+Command+S', 'sidebar.toggle'),
    // Privacy mode (SPEC section 5): blurs message text for screen sharing.
    command('toggle-privacy', state.privacy ? 'Show Message Text' : 'Hide Message Text', 'Control+Command+H', 'privacy.toggle'),
    // In a topic tab ⌘J opens or closes the Juno panel; elsewhere it opens the Juno tab.
    command('juno', 'Juno', 'CommandOrControl+J', 'juno.toggle'),
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
  // ⌘N and ⌘T both open a new tab (a New chat, spec section 9). ⌘W closes
  // the tab, not the window; ⌘⇧W closes the window.
  const file: MenuItemConstructorOptions[] = [
    command('new-chat', 'New Chat', 'CommandOrControl+N', 'tab.new'),
    command('new-tab', 'New Tab', 'CommandOrControl+T', 'tab.new'),
    command('reopen-tab', 'Reopen Closed Tab', 'CommandOrControl+Shift+T', 'tab.reopen'),
    { type: 'separator' },
    command('close-tab', 'Close Tab', 'CommandOrControl+W', 'tab.close'),
    { role: 'close', accelerator: 'CommandOrControl+Shift+W' },
  ]
  // Undo has no role: the renderer undoes typing in a text field that has
  // text, and otherwise Juno's last action (architecture, shortcuts).
  const edit: MenuItemConstructorOptions[] = [
    command('undo', 'Undo', 'CommandOrControl+Z', 'edit.undo'),
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
    command('back', 'Back', 'CommandOrControl+[', 'history.back'),
    command('forward', 'Forward', 'CommandOrControl+]', 'history.forward'),
    { type: 'separator' },
    // ⌘K (SPEC section 10) opens the palette, and closes it again.
    command('search', 'Search…', 'CommandOrControl+K', 'palette.toggle'),
  ]
  const windowItems: MenuItemConstructorOptions[] = [
    { role: 'minimize' },
    { role: 'zoom' },
    { type: 'separator' },
    command('previous-tab', 'Show Previous Tab', 'CommandOrControl+Shift+[', 'tab.previous'),
    command('next-tab', 'Show Next Tab', 'CommandOrControl+Shift+]', 'tab.next'),
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
                { type: 'separator' },
                command('settings', 'Settings…', 'CommandOrControl+,', 'settings.open'),
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
      { role: 'window', submenu: windowItems },
    ]),
  )
}

/**
 * The page reads `?theme=`, `?accent=`, `?density=`, `?privacy=` and `?sidebar=` so its first render matches the window background, the saved
 * accent, density and privacy mode, and the saved sidebar.
 */
function pageUrl(base: string, launch: Launch): string {
  const url = new URL(base)
  url.searchParams.set('theme', launch.theme)
  url.searchParams.set('accent', launch.accent ?? DEFAULT_ACCENT)
  url.searchParams.set('density', launch.density ?? DEFAULT_DENSITY)
  if (launch.privacy === true) url.searchParams.set('privacy', 'on')
  const sidebar = launch.sidebar ?? DEFAULT_SIDEBAR
  url.searchParams.set('sidebar', `${sidebar.width}${sidebar.collapsed ? '-hidden' : ''}`)
  return url.toString()
}
