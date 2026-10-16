import { app, BrowserWindow, Notification, powerMonitor, shell } from 'electron'
import { Events, type NotificationPermission, type NotificationTarget, type PrivacyState } from '@juno/contract'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createAgentSupervisor } from './agent'
import { appBackupSecrets } from './backupSecrets'
import { codexHome } from './codex'
import { appMcpCredentials } from './mcpCredentials'
import { createSupervisor } from './engine'
import { downloadFile, downloadsForTests } from './files'
import { browserLinksForTests, contextMenuForTests, folderForTests, registerIpc, slackLinksForTests } from './ipc'
import { CUSTOM_ITEM, macKeychain, memoryKeychain, OPENROUTER_ITEM } from './keychain'
import { ProviderStore } from './providers'
import { launchWriter, readLaunch, type Launch } from './launch'
import { registerAppScheme, serveAppScheme } from './scheme'
import { SecretsStore } from './secrets'
import { SessionHost } from './session'
import { slackKeychainReads } from './slackImport'
import { Notifier, type ShownNotification } from './notifier'
import { createNotificationPermission, loadPermissionBridge, settingsUrls } from './notificationPermission'
import { createScreenWatch, loadScreenProbe, type ScreenProbe } from './screenWatch'
import { createUpdates } from './updates'
import { appWindow, createMainWindow, setMenuPrivacy, setSidebarHidden } from './window'

// Every renderer runs in the Chromium sandbox. Must be called before ready.
app.enableSandbox()

const e2e = process.env.JUNO_E2E === '1'

// Keep dev data apart from a packaged install. JUNO_USER_DATA lets tests
// point at a throwaway directory. Both must be set before ready.
const userData = process.env.JUNO_USER_DATA ?? (app.isPackaged ? undefined : join(app.getPath('appData'), 'JunoDev'))
if (userData) app.setPath('userData', userData)

// One app per user-data directory: two would run two engines on the same
// databases and post every notification twice. The lock is per directory,
// so a second launch hands over to the first, which shows its window.
if (!app.requestSingleInstanceLock()) process.exit(0)

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

/**
 * The screen watch turned privacy mode on and the user has not touched it since. Kept in memory
 * only: on launch the mode is what the user left it as (`launch.privacy`).
 */
let privacyBySharing = false

/** Privacy mode now: the user's choice, or on because sharing started. */
const privacyOn = () => launch.privacy === true || privacyBySharing

/** The user toggled privacy mode: it is theirs now, saved for the next launch. */
function setUserPrivacy(privacy: boolean): void {
  privacyBySharing = false
  updateLaunch({ privacy })
  setMenuPrivacy(privacy)
}

/** Sharing started or ended (screenWatch.ts): the mode changes without being saved, and the app window is told. */
function setSharingPrivacy(bySharing: boolean): void {
  privacyBySharing = bySharing
  setMenuPrivacy(privacyOn())
  const state: PrivacyState = { privacy: privacyOn(), sharing: bySharing }
  appWindow()?.webContents.send(Events.privacyChanged, state)
}

/** Under JUNO_E2E a test says whether the screen is shared (`junoTest.screenShared`); the real probe never runs. */
let sharedForTests = e2e && process.env.JUNO_E2E_SCREEN_SHARED === '1'
/** And moves the screen watch's clock on (`junoTest.screenWatchElapse`), to reach the always-on limit. */
let screenClockForTests = 0

const screenWatch = createScreenWatch({
  load: e2e ? () => Promise.resolve<ScreenProbe>(() => sharedForTests) : () => loadScreenProbe().then((loaded) => loaded?.probe),
  enabled: () => launch.hideWhileSharing !== false,
  privacy: () => ({ on: privacyOn(), bySharing: privacyBySharing }),
  setPrivacy: (_privacy, bySharing) => setSharingPrivacy(bySharing),
  now: () => Date.now() + screenClockForTests,
})

const updates = createUpdates(launch.autoUpdate === true, (autoUpdate) => updateLaunch({ autoUpdate }))

// Test seams (architecture 13): the fake Slack to sign in against, a fixture
// Slack-app directory to import from, and a stand-in keychain password.
// Read only under JUNO_E2E so a real run can never be pointed elsewhere.
const fakeSlackUrl = e2e ? process.env.JUNO_FAKE_SLACK_URL : undefined
const slackAppDir = e2e ? process.env.JUNO_SLACK_APP_DIR : undefined
const keychainPassword = e2e ? process.env.JUNO_SLACK_SAFE_STORAGE_PASSWORD : undefined

const aiCallsForTests: Record<string, number> = {}
const supervisor = createSupervisor({
  ...(fakeSlackUrl === undefined ? {} : { fakeSlackUrl }),
  onMessage: (message) => {
    if (message._tag === 'aiCall') {
      if (e2e) aiCallsForTests[message.task] = (aiCallsForTests[message.task] ?? 0) + 1
      return
    }
    if (!notifier.handle(message) && !sessionHost.handle(message)) console.warn(`main: unhandled engine message ${message._tag}`)
  },
})

/** Under JUNO_E2E notifications are recorded, not shown; a test clicks them through `junoTest`. */
const notificationsForTests: Array<{ readonly title: string; readonly body: string; click: () => void }> = []
let badgeForTests = ''

/** A clicked notification: the app window comes forward, or opens. */
function focusWindow(): BrowserWindow {
  const window = appWindow() ?? openWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return window
}

/** A clicked message notification: the window comes forward and the renderer opens the target. */
function openTarget(target: NotificationTarget): void {
  focusWindow().webContents.send(Events.notificationOpen, target)
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
  focus: () => void focusWindow(),
  send: (message) => supervisor.send(message),
  privacy: privacyOn,
})
supervisor.onReady(() => notifier.engineReady())

/**
 * Whether macOS lets Juno notify (notificationPermission.ts). Under JUNO_E2E a test sets it
 * (`junoTest.notificationPermission`); a request then answers allowed, as if the user clicked Allow.
 */
let permissionForTests: NotificationPermission = 'allowed'
let notificationSettingsOpenedForTests = 0
const notificationPermission = e2e
  ? {
      preload: () => {},
      read: () => Promise.resolve(permissionForTests),
      request: () => {
        if (permissionForTests === 'notDetermined') permissionForTests = 'allowed'
        return Promise.resolve(permissionForTests)
      },
    }
  : createNotificationPermission(loadPermissionBridge)

/** System Settings at Juno's notifications; the Notifications pane if macOS refuses the entry's link. */
async function openNotificationSettings(): Promise<void> {
  if (e2e) return void (notificationSettingsOpenedForTests += 1)
  // Packaged, macOS knows Juno by its bundle id; in development the app is Electron.
  const [entry, pane] = settingsUrls(app.isPackaged ? 'app.juno.desktop' : 'com.github.Electron')
  await shell.openExternal(entry).catch(() => shell.openExternal(pane))
}

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
supervisor.onReady(() => {
  agent.linkHost()
  if (appWindow()?.isVisible()) supervisor.send({ _tag: 'painted' })
})

// The providers: keys in the keychain (in memory under tests), OPENROUTER_API_KEY as a development override.
const providers = new ProviderStore(
  app.getPath('userData'),
  e2e ? { openRouter: memoryKeychain(), custom: memoryKeychain() } : { openRouter: macKeychain(OPENROUTER_ITEM), custom: macKeychain(CUSTOM_ITEM) },
  // Under JUNO_E2E only the test seam: a test launches with a key, never the developer's.
  e2e ? process.env.JUNO_E2E_OPENROUTER_KEY : app.isPackaged ? undefined : process.env.OPENROUTER_API_KEY,
  (state, provider, engineKey) => {
    supervisor.setAiKey(engineKey)
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
  const fakeSlackOrigin = fakeSlackUrl === undefined ? undefined : new URL(fakeSlackUrl).origin
  registerIpc({
    updates,
    supervisor,
    downloadFile: (file) => downloadFile(file, fakeSlackOrigin, e2e),
    setViewing: (topicId) => notifier.setViewing(topicId),
    notifications: {
      test: () => notifier.test(),
      permission: notificationPermission.read,
      requestPermission: notificationPermission.request,
      openSettings: openNotificationSettings,
    },
    agent,
    providers,
    codex: codexHome(agent.agentDir, e2e),
    backupSecrets,
    setTheme: (theme) => updateLaunch({ theme }),
    setAccent: (accent) => updateLaunch({ accent }),
    setDensity: (density) => updateLaunch({ density }),
    // The user's own choice: sharing no longer owns the mode, so it stays as they set it.
    setPrivacy: setUserPrivacy,
    setSidebar: (sidebar) => {
      updateLaunch({ sidebar })
      setSidebarHidden(sidebar.collapsed)
    },
    sharing: {
      get: () => ({ hide: launch.hideWhileSharing !== false, detection: screenWatch.detection() }),
      set: (hide) => {
        updateLaunch({ hideWhileSharing: hide })
        return { hide, detection: screenWatch.detection() }
      },
    },
  })

  // Fork the engine and open the window in the same tick; neither waits.
  supervisor.start()
  void providers.load()
  openWindow()
  updates.start()

  // The Dock icon, or a second launch: the app window comes back even while another window (sign-in) is open.
  app.on('activate', () => {
    if (appWindow() === undefined) openWindow()
  })
  app.on('second-instance', () => {
    const window = appWindow()
    if (window === undefined) return void openWindow()
    if (window.isMinimized()) window.restore()
    window.focus()
  })
})

function openWindow(): BrowserWindow {
  const window = createMainWindow(() => ({ ...launch, privacy: privacyOn(), privacySharing: privacyBySharing }))
  window.once('ready-to-show', () => {
    supervisor.send({ _tag: 'painted' })
    // After the first paint, so loading koffi never delays it. Only while the window is open.
    screenWatch.start()
    notificationPermission.preload()
  })
  window.on('close', () => updateLaunch({ bounds: window.getNormalBounds() }))
  window.on('closed', () => screenWatch.stop())
  return window
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  screenWatch.stop()
  updates.stop()
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

// The packaged smoke test (JUNO_E2E_SCREEN_PROBE): the real probe loads once from the asar and
// writes which symbol it called, since tests otherwise use the seam above.
if (e2e && process.env.JUNO_E2E_SCREEN_PROBE === '1') {
  void app.whenReady().then(async () => {
    const loaded = await loadScreenProbe()
    const result = loaded === undefined ? { symbol: null } : { symbol: loaded.symbol, value: typeof loaded.probe() }
    await writeFile(join(app.getPath('userData'), 'screen-watch-probe.json'), JSON.stringify(result))
  })
}

// Test hooks. Playwright reaches main through app.evaluate; the engine itself
// is out of reach, so main exposes what tests need to know about it.
if (e2e) {
  Object.assign(globalThis, {
    junoTest: {
      enginePid: () => supervisor.pid,
      aiCalls: () => ({ ...aiCallsForTests }),
      engineState: () => supervisor.currentState,
      failEngine: () => supervisor.giveUp(),
      contextMenu: contextMenuForTests,
      folder: folderForTests,
      slackLinks: slackLinksForTests,
      browserLinks: browserLinksForTests,
      downloads: downloadsForTests,
      agentState: () => agent.currentState,
      agentHost: () => agent.host?.host,
      agentPid: () => agent.pid,
      notifications: () => notificationsForTests.map(({ title, body }) => ({ title, body })),
      clickNotification: (index = 0) => notificationsForTests[index]?.click(),
      dockBadge: () => badgeForTests,
      notificationPermission: (permission: NotificationPermission) => {
        permissionForTests = permission
      },
      notificationSettingsOpened: () => notificationSettingsOpenedForTests,
      slackKeychainReads,
      wake: () => notifier.wake(),
      // The screen watch's seam: says whether another app is capturing the screen, and polls at once.
      screenShared: (shared: boolean) => {
        sharedForTests = shared
        return screenWatch.poll()
      },
      screenWatchElapse: (ms: number) => {
        screenClockForTests += ms
      },
    },
  })
}
