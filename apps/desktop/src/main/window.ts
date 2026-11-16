import { app, BrowserWindow, nativeTheme, screen, shell, type BaseWindow, type BrowserWindowConstructorOptions, type Rectangle } from 'electron'
import { join } from 'node:path'
import { Events, type MenuCommand, type Theme } from '@juno/contract'
import { BACKGROUND, pageUrl, TAB_STRIP, type Launch, type PageLaunch } from './launch'
import { APP_URL } from './scheme'
import { startupMark } from './startupMarks'
import { wireTextMenu } from './textMenu'

/** The colour scheme a theme shows now. System follows the system's appearance. */
const schemeFor = (theme: Theme): 'light' | 'dark' => (theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme)

/** The background a window paints in before the page loads. */
const backgroundFor = (theme: Theme): string => BACKGROUND[schemeFor(theme)]

/** Height of the drag strip drawn by the renderer. Keep in sync with --titlebar-height. */
const TITLEBAR_HEIGHT = 44
/** macOS traffic lights are 12px tall; centre them in the strip. */
const TRAFFIC_LIGHT_SIZE = 12

/**
 * The title bar is Juno's own: the page draws it, and the system's window
 * buttons sit in it. The Mac's traffic lights are centred in the strip at
 * its left. Windows draws minimise, maximise and close at its right, on the
 * tab strip's colour, one pixel short so the strip's bottom border runs
 * under them; the page keeps room for them (`--titlebar-controls-inset`).
 */
function titleBar(theme: Theme): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') return { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: Math.round((TITLEBAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2) } }
  if (process.platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: { ...TAB_STRIP[schemeFor(theme)], height: TITLEBAR_HEIGHT - 1 } }
  return {}
}

/** Windows' window buttons follow a theme change, or the system's appearance under System. */
export function refreshTitleBar(): void {
  if (process.platform !== 'win32') return
  const window = appWindow()
  const launch = window === undefined ? undefined : launchOf.get(window)
  if (window !== undefined && launch !== undefined) window.setTitleBarOverlay(TAB_STRIP[schemeFor(launch().theme)])
}

/** The smallest main window at 100% zoom, in CSS pixels: the 384px sidebar and a usable workspace. */
const MIN_WIDTH = 720
const MIN_HEIGHT = 480

/**
 * The only way windows get created. Secure web preferences are fixed here and
 * cannot be overridden by callers.
 */
export function createWindow(options: BrowserWindowConstructorOptions = {}): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    backgroundColor: BACKGROUND.light,
    ...options,
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
    ...titleBar(launch.theme),
  })

  mainWindows.add(window)
  launchOf.set(window, currentLaunch)
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
  // Full screen hides the window buttons (the traffic lights, or Windows' controls), so the title bars drop the room they keep for them.
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
export function reloadWindow(window: BaseWindow | undefined, ignoringCache: boolean): void {
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

/** Hands a menu command to the app page of `window`. In any other window ⌘W closes it and ⌘Z is the plain undo. */
export function tabCommand(window: BaseWindow | undefined, command: MenuCommand): void {
  if (window === undefined || window.isDestroyed()) return
  if (!mainWindows.has(window) || !(window instanceof BrowserWindow)) {
    if (command === 'tab.close') window.close()
    if (command === 'edit.undo' && window instanceof BrowserWindow) window.webContents.undo()
    return
  }
  window.webContents.send(Events.menuCommand, command)
}
