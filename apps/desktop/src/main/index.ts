import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createAgentSupervisor } from './agent'
import { createSupervisor } from './engine'
import { contextMenuForTests, registerIpc, slackLinksForTests } from './ipc'
import { readLaunch, writeLaunch, type Launch } from './launch'
import { registerAppScheme, serveAppScheme } from './scheme'
import { SecretsStore } from './secrets'
import { SessionHost } from './session'
import { createMainWindow, setSidebarHidden } from './window'

// Every renderer runs in the Chromium sandbox. Must be called before ready.
app.enableSandbox()

const e2e = process.env.JUNO_E2E === '1'

// Keep dev data apart from a packaged install. JUNO_USER_DATA lets tests
// point at a throwaway directory. Both must be set before ready.
const userData = process.env.JUNO_USER_DATA ?? (app.isPackaged ? undefined : join(app.getPath('appData'), 'JunoDev'))
if (userData) app.setPath('userData', userData)

// Scheme privileges must be registered before ready. launch.json is the one
// synchronous read: theme and bounds for a window that paints right first.
registerAppScheme()
let launch = readLaunch(app.getPath('userData'))

/** The one place launch.json changes, so a theme change and a window close never overwrite each other. */
function updateLaunch(patch: Partial<Launch>): void {
  launch = { ...launch, ...patch }
  void writeLaunch(app.getPath('userData'), launch)
}

// Test seams (architecture 13): the fake Slack to sign in against, a fixture
// Slack-app directory to import from, and a stand-in keychain password.
// Read only under JUNO_E2E so a real run can never be pointed elsewhere.
const fakeSlackUrl = e2e ? process.env.JUNO_FAKE_SLACK_URL : undefined
const slackAppDir = e2e ? process.env.JUNO_SLACK_APP_DIR : undefined
const keychainPassword = e2e ? process.env.JUNO_SLACK_SAFE_STORAGE_PASSWORD : undefined

const supervisor = createSupervisor({
  ...(fakeSlackUrl === undefined ? {} : { fakeSlackUrl }),
  onMessage: (message) => {
    if (!sessionHost.handle(message)) console.warn(`main: unhandled engine message ${message._tag}`)
  },
})

// The agent process starts only on request until the chat ships (ADR 0012, M2).
const agent = process.env.JUNO_AGENT === '1' ? createAgentSupervisor((port) => supervisor.send({ _tag: 'agentPort' }, [port])) : undefined
supervisor.onReady(() => agent?.linkHost())

const sessionHost = new SessionHost({
  secrets: new SecretsStore(app.getPath('userData'), { plaintext: e2e }),
  send: (message) => supervisor.send(message),
  signInWindow:
    fakeSlackUrl === undefined ? {} : { startUrl: `${fakeSlackUrl}/signin`, extraHosts: [new URL(fakeSlackUrl).hostname] },
  importOptions: {
    ...(slackAppDir === undefined ? {} : { slackDir: slackAppDir }),
    ...(keychainPassword === undefined ? {} : { keychainPassword }),
  },
})

app.whenReady().then(() => {
  // A packaged app gets its icon from the bundle. In dev the Dock would show Electron's.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  serveAppScheme(join(__dirname, '../renderer'), fakeSlackUrl === undefined ? undefined : new URL(fakeSlackUrl).origin)
  registerIpc({
    supervisor,
    setTheme: (theme) => updateLaunch({ theme }),
    setAccent: (accent) => updateLaunch({ accent }),
    setSidebar: (sidebar) => {
      updateLaunch({ sidebar })
      setSidebarHidden(sidebar.collapsed)
    },
  })

  // Fork the engine and open the window in the same tick; neither waits.
  supervisor.start()
  agent?.start()
  openWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

function openWindow(): void {
  const window = createMainWindow(launch)
  window.on('close', () => updateLaunch({ bounds: window.getNormalBounds() }))
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  supervisor.stop()
  agent?.stop()
})

// Test hooks. Playwright reaches main through app.evaluate; the engine itself
// is out of reach, so main exposes what tests need to know about it.
if (e2e) {
  Object.assign(globalThis, {
    junoTest: {
      enginePid: () => supervisor.pid,
      engineState: () => supervisor.currentState,
      failEngine: () => supervisor.giveUp(),
      contextMenu: contextMenuForTests,
      slackLinks: slackLinksForTests,
      agentState: () => agent?.currentState ?? 'stopped',
      agentHost: () => agent?.host?.host,
    },
  })
}
