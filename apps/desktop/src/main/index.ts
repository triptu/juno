import { app, BrowserWindow, Notification, powerMonitor, shell } from 'electron'
import { Events, type NotificationTarget } from '@juno/contract'
import { join } from 'node:path'
import { createAgentSupervisor } from './agent'
import { appBackupSecrets } from './backupSecrets'
import { appMcpCredentials } from './mcpCredentials'
import { createSupervisor } from './engine'
import { contextMenuForTests, folderForTests, registerIpc, slackLinksForTests } from './ipc'
import { CUSTOM_ITEM, macKeychain, memoryKeychain, OPENROUTER_ITEM } from './keychain'
import { ProviderStore } from './providers'
import { launchWriter, readLaunch, type Launch } from './launch'
import { registerAppScheme, serveAppScheme } from './scheme'
import { SecretsStore } from './secrets'
import { SessionHost } from './session'
import { Notifier, type ShownNotification } from './notifier'
import { appWindow, createMainWindow, setSidebarHidden } from './window'

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
const launchFile = launchWriter(app.getPath('userData'))

/** The one place launch.json changes, so a theme change and a window close never overwrite each other. */
function updateLaunch(patch: Partial<Launch>): void {
  launch = { ...launch, ...patch }
  launchFile.write(launch)
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
    if (!notifier.handle(message) && !sessionHost.handle(message)) console.warn(`main: unhandled engine message ${message._tag}`)
  },
})

/** Under JUNO_E2E notifications are recorded, not shown; a test clicks them through `junoTest`. */
const notificationsForTests: Array<{ readonly title: string; readonly body: string; click: () => void }> = []
let badgeForTests = ''

/** A clicked notification: the app window comes forward, or opens, and the renderer opens the target. */
function openTarget(target: NotificationTarget): void {
  const window = appWindow() ?? openWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  window.webContents.send(Events.notificationOpen, target)
}

const notifier = new Notifier({
  create: (options): ShownNotification => {
    if (e2e) {
      const recorded = { ...options, click: () => {} }
      notificationsForTests.push(recorded)
      return { show: () => {}, close: () => {}, onClick: (f) => { recorded.click = f } }
    }
    const shown = new Notification({ title: options.title, body: options.body })
    return { show: () => shown.show(), close: () => shown.close(), onClick: (f) => shown.on('click', f) }
  },
  setBadge: (text) => {
    badgeForTests = text
    if (!e2e) app.dock?.setBadge(text)
  },
  open: openTarget,
  send: (message) => supervisor.send(message),
})
supervisor.onReady(() => notifier.engineReady())

// The backup's secrets in the keychain (memory under tests), WP21.
const backupSecrets = appBackupSecrets(e2e)

// The agent runs whenever a model provider is set up (ADR 0012, SPEC 13.10).
const agent = createAgentSupervisor(
  (port) => supervisor.send({ _tag: 'agentPort' }, [port]),
  () => supervisor.currentState === 'ready',
  // MCP sign-in: OAuth state in the keychain (memory under tests), sign-in pages in the system browser.
  appMcpCredentials(e2e, (url) => shell.openExternal(url)),
  backupSecrets.answer,
)
supervisor.onReady(() => agent.linkHost())

// The providers: keys in the keychain (in memory under tests), OPENROUTER_API_KEY as a development override.
const providers = new ProviderStore(
  app.getPath('userData'),
  e2e ? { openRouter: memoryKeychain(), custom: memoryKeychain() } : { openRouter: macKeychain(OPENROUTER_ITEM), custom: macKeychain(CUSTOM_ITEM) },
  // Under JUNO_E2E only the test seam: a test launches with a key, never the developer's.
  e2e ? process.env.JUNO_E2E_OPENROUTER_KEY : process.env.OPENROUTER_API_KEY,
  (state, provider) => {
    agent.setProvider(provider)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(Events.agentProviderChanged, state)
    }
  },
)

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
  // A packaged app gets its icon from the bundle. In dev the Dock would show Electron's. Not under
  // tests: decoding the 1,024 px icon holds main for about 80 ms before the window opens, a cost the
  // packaged app does not have, so the start-up scenarios would measure something that never ships.
  if (process.platform === 'darwin' && !app.isPackaged && !e2e) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  serveAppScheme(join(__dirname, '../renderer'), fakeSlackUrl === undefined ? undefined : new URL(fakeSlackUrl).origin)
  powerMonitor.on('resume', () => notifier.wake())
  registerIpc({
    supervisor,
    setViewing: (topicId) => notifier.setViewing(topicId),
    agent,
    providers,
    backupSecrets,
    setTheme: (theme) => updateLaunch({ theme }),
    setAccent: (accent) => updateLaunch({ accent }),
    setDensity: (density) => updateLaunch({ density }),
    setSidebar: (sidebar) => {
      updateLaunch({ sidebar })
      setSidebarHidden(sidebar.collapsed)
    },
  })

  // Fork the engine and open the window in the same tick; neither waits.
  supervisor.start()
  void providers.load()
  openWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

function openWindow(): BrowserWindow {
  const window = createMainWindow(launch)
  window.on('close', () => updateLaunch({ bounds: window.getNormalBounds() }))
  return window
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  supervisor.stop()
  agent.stop()
})

// The window's close writes its bounds as the app quits; a process that
// exits mid-write would leave launch.json empty and lose every choice in it.
app.on('will-quit', (event) => {
  const pending = launchFile.pending()
  if (pending === undefined) return
  event.preventDefault()
  void pending.then(() => app.quit())
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
      folder: folderForTests,
      slackLinks: slackLinksForTests,
      agentState: () => agent.currentState,
      agentHost: () => agent.host?.host,
      agentPid: () => agent.pid,
      notifications: () => notificationsForTests.map(({ title, body }) => ({ title, body })),
      clickNotification: (index = 0) => notificationsForTests[index]?.click(),
      dockBadge: () => badgeForTests,
      wake: () => notifier.wake(),
    },
  })
}
