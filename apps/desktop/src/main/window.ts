import { app, BrowserWindow, Menu, screen, shell, type BaseWindow, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { DEFAULT_ACCENT } from '@juno/contract'
import { BACKGROUND, type Launch } from './launch'
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

export function createMainWindow(launch: Launch): BrowserWindow {
  const window = createWindow({
    title: 'Juno',
    width: 1200,
    height: 800,
    ...launch.bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: BACKGROUND[launch.theme],
  })

  setAppMenu()
  // Zoom outlives a reload (Chromium keeps it per origin), and pinch or
  // Control-scroll can change it without the menu.
  window.webContents.on('did-finish-load', () => fitMinimumSizeToZoom(window))
  window.webContents.on('zoom-changed', () => setImmediate(() => fitMinimumSizeToZoom(window)))

  // electron-vite sets ELECTRON_RENDERER_URL in dev for the Vite server.
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  void window.loadURL(pageUrl(devUrl || APP_URL, launch))

  return window
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

let menuSet = false

/**
 * Electron's default menu, with the zoom items wired through
 * `fitMinimumSizeToZoom`: the default roles change the zoom without telling
 * main, so the minimum size could not follow.
 */
function setAppMenu(): void {
  if (menuSet) return
  menuSet = true
  const view: MenuItemConstructorOptions[] = [
    { role: 'reload' },
    { role: 'forceReload' },
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
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' } satisfies MenuItemConstructorOptions] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: view },
      { role: 'windowMenu' },
    ]),
  )
}

/** The page reads `?theme=` and `?accent=` so its first render matches the window background and the saved accent. */
function pageUrl(base: string, launch: Launch): string {
  const url = new URL(base)
  url.searchParams.set('theme', launch.theme)
  url.searchParams.set('accent', launch.accent ?? DEFAULT_ACCENT)
  return url.toString()
}
