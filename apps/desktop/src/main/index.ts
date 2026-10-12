import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createSupervisor } from './engine'
import { registerIpc } from './ipc'
import { readLaunch, writeLaunch } from './launch'
import { registerAppScheme, serveAppScheme } from './scheme'
import { createMainWindow } from './window'

// Every renderer runs in the Chromium sandbox. Must be called before ready.
app.enableSandbox()

// Keep dev data apart from a packaged install. JUNO_USER_DATA lets tests
// point at a throwaway directory. Both must be set before ready.
const userData = process.env.JUNO_USER_DATA ?? (app.isPackaged ? undefined : join(app.getPath('appData'), 'JunoDev'))
if (userData) app.setPath('userData', userData)

// Scheme privileges must be registered before ready. launch.json is the one
// synchronous read: theme and bounds for a window that paints right first.
registerAppScheme()
const launch = readLaunch(app.getPath('userData'))

const supervisor = createSupervisor()

app.whenReady().then(() => {
  serveAppScheme(join(__dirname, '../renderer'))
  registerIpc({
    supervisor,
    setTheme: (theme) => void writeLaunch(app.getPath('userData'), { ...launch, theme }),
  })

  // Fork the engine and open the window in the same tick; neither waits.
  supervisor.start()
  openWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

function openWindow(): void {
  const window = createMainWindow(launch)
  window.on('close', () => {
    void writeLaunch(app.getPath('userData'), { ...launch, bounds: window.getNormalBounds() })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => supervisor.stop())

// Test hooks. Playwright reaches main through app.evaluate; the engine itself
// is out of reach, so main exposes what tests need to know about it.
if (process.env.JUNO_E2E === '1') {
  Object.assign(globalThis, {
    junoTest: {
      enginePid: () => supervisor.pid,
      engineState: () => supervisor.currentState,
    },
  })
}
