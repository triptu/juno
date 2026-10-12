import { app, BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { BACKGROUND, type Launch } from './launch'
import { APP_URL } from './scheme'

/** Height of the drag strip drawn by the renderer. Keep in sync with --titlebar-height. */
const TITLEBAR_HEIGHT = 44
/** macOS traffic lights are 12px tall; centre them in the strip. */
const TRAFFIC_LIGHT_SIZE = 12

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
    minWidth: 720,
    minHeight: 480,
    backgroundColor: BACKGROUND[launch.theme],
  })

  // electron-vite sets ELECTRON_RENDERER_URL in dev for the Vite server.
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  void window.loadURL(devUrl || APP_URL)

  return window
}
