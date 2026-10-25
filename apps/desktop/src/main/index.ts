// First, so coverage (test runs only) starts before the rest of the bundle runs.
import { flushAllCoverage, recordWindowCoverage } from '../coverage'
import { app, BrowserWindow, Notification, powerMonitor, shell } from 'electron'
import { Events, type NotificationTarget, type PrivacyState } from '@juno/contract'
import { join } from 'node:path'
import { createDockBadge, createDockBounce } from './dockBadge'
import { testNotificationPermission } from './notificationTestHooks'
import { createActivityWatch } from './activity'
import { createAgentSupervisor } from './agent'
import { appBackupSecrets } from './backupSecrets'
import { codexHome } from './codex'
import { appMcpCredentials } from './mcpCredentials'
import { createSupervisor } from './engine'
import { createEngineTestHooks } from './engineTestHooks'
import { createHuddleQuit } from './huddleQuit'
import { clearTemporaryFiles, copyImage, downloadFile, fileTestHooks, openFile, quickLook } from './files'
import { browserLinksForTests, contextMenuForTests, folderForTests, registerIpc, logsForTests, huddleSettingsForTests, slackLinksForTests, webPanelForTests } from './ipc'
import { CUSTOM_ITEM, macKeychain, memoryKeychain, OPENROUTER_ITEM } from './keychain'
import { ProviderStore } from './providers'
import { launchWriter, readLaunch, withSession, type Launch } from './launch'
import { registerMediaPermissions } from './media'
import { registerAppScheme, serveAppScheme } from './scheme'
import { SecretsStore } from './secrets'
import { SessionHost } from './session'
import { slackKeychainReads } from './slackImport'
import { Notifier, type ShownNotification } from './notifier'
import { createNotificationPermission, loadPermissionBridge, openSettings } from './notificationPermission'
import { mainLog as processLog } from './logging'
import { createProcessWatch } from './processWatch'
import { createScreenWatch, loadScreenProbe, writeProbeForTests, type ScreenProbe } from './screenWatch'
import { loadUpdateConfig } from './releaseFeed'
import { createUpdates } from './updates'
import { appWindow, createMainWindow, setMenuCheckForUpdates, setMenuPrivacy, setSidebarHidden } from './window'

app.enableSandbox()

const e2e = process.env.JUNO_E2E === '1'
// Under JUNO_E2E_COVERAGE, record which renderer functions run (../coverage.ts).
if (e2e) recordWindowCoverage(app)

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

const updates = createUpdates(launch.autoUpdate === true, (autoUpdate) => updateLaunch({ autoUpdate }), loadUpdateConfig(e2e), e2e)

// Test seams (architecture 13): the fake Slack to sign in against, a fixture
// Slack-app directory to import from, and a stand-in keychain password.
// Read only under JUNO_E2E so a real run can never be pointed elsewhere.
const fakeSlackUrl = e2e ? process.env.JUNO_FAKE_SLACK_URL : undefined
const slackAppDir = e2e ? process.env.JUNO_SLACK_APP_DIR : undefined
const keychainPassword = e2e ? process.env.JUNO_SLACK_SAFE_STORAGE_PASSWORD : undefined

const engineTests = createEngineTestHooks(e2e, (message) => supervisor.send(message))
const supervisor = createSupervisor({
  ...(fakeSlackUrl === undefined ? {} : { fakeSlackUrl }),
  onMessage: (message) => {
    if (!engineTests.handle(message) && !notifier.handle(message) && !sessionHost.handle(message) && !huddleQuit.handle(message)) console.warn(`main: unhandled engine message ${message._tag}`)
  },
})
const huddleQuit = createHuddleQuit(e2e, appWindow)
supervisor.onFailed(() => { huddleQuit.engineFailed(); dockBadge.set('') })

/** Under JUNO_E2E notifications are recorded, not shown; a test clicks them through `junoTest`. */
const notificationsForTests: Array<{ readonly title: string; readonly body: string; readonly silent?: boolean; click: () => void }> = []
let badgeForTests = ''
const dockBounce = createDockBounce(e2e, () => BrowserWindow.getFocusedWindow() !== null, () => app.dock?.bounce('informational'))

/** A clicked notification: the app window comes forward, or opens. */
function focusWindow(): BrowserWindow {
  const window = appWindow() ?? openWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return window
}

/** A clicked message or huddle notification: the window comes forward and the renderer opens the target. */
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
    const shown = new Notification({ title: options.title, body: options.body, silent: options.silent === true })
    return { show: () => shown.show(), close: () => shown.close(), onClick: (f) => shown.on('click', f) }
  },
  setBadge: (text) => dockBadge.set(text),
  bounce: dockBounce.bounce,
  open: openTarget,
  focus: () => void focusWindow(),
  send: (message) => supervisor.send(message),
  privacy: privacyOn,
})
supervisor.onReady(() => notifier.engineReady())

/**
 * Whether the owner is at the Mac, so Slack shows them active (activity.ts). Under JUNO_E2E the idle
 * time is 0, a user at the Mac; apps/desktop/test/activity.test.ts drives the watch with other times.
 */
let screenLocked = false
const activity = createActivityWatch({
  idleSeconds: () => (e2e ? 0 : powerMonitor.getSystemIdleTime()),
  locked: () => screenLocked,
  send: (message) => supervisor.send(message),
})
// A new engine hears at once, not at the next poll.
supervisor.onReady(() => activity.poll())

/** Native notification permission, or the e2e stand-in. */
const permissionForTests = testNotificationPermission()
let notificationSettingsOpenedForTests = 0
const notificationPermission = e2e ? permissionForTests : createNotificationPermission(loadPermissionBridge)
const dockBadge = createDockBadge(notificationPermission, (text) => {
  badgeForTests = text
  if (!e2e) app.dock?.setBadge(text)
}, {
  enabled: app.isPackaged || (e2e && process.env.JUNO_E2E_DEV_NOTIFICATIONS !== '1'),
  asked: () => launch.notificationPermissionAsked === true,
  remember: async () => { updateLaunch({ notificationPermissionAsked: true }); await launchFile.pending() },
})
const refreshDockBadge = () => void dockBadge.refresh()

/** System Settings at Juno's notifications; the Notifications pane if macOS refuses the entry's link. */
const openNotificationSettings = async () => (e2e ? void (notificationSettingsOpenedForTests += 1) : openSettings(app.isPackaged))

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
// Each process's CPU and memory for Settings › About, and the idle CPU self-check (processWatch.ts).
const processes = createProcessWatch({ supervisor, agent, window: appWindow })
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
  importOptions: { ...(slackAppDir === undefined ? {} : { slackDir: slackAppDir }), ...(keychainPassword === undefined ? {} : { keychainPassword }) },
  saveSession: (session) => void (launch = withSession(launch, session, launchFile)),
})

app.whenReady().then(() => {
  processLog.log('INFO', 'process ready')
  // A packaged app gets its icon from the bundle. In dev the Dock would show Electron's. Not under
  // tests: decoding the 1,024 px icon holds main for about 80 ms before the window opens, a cost the
  // packaged app does not have, so the start-up scenarios would measure something that never ships.
  if (process.platform === 'darwin' && !app.isPackaged && !e2e) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  serveAppScheme(join(__dirname, '../renderer'), fakeSlackUrl === undefined ? undefined : new URL(fakeSlackUrl).origin)
  void clearTemporaryFiles(e2e)
  registerMediaPermissions()
  powerMonitor.on('resume', () => { notifier.wake(); refreshDockBadge() })
  app.on('browser-window-focus', refreshDockBadge)
  powerMonitor.on('lock-screen', () => {
    screenLocked = true
  })
  powerMonitor.on('unlock-screen', () => {
    screenLocked = false
    activity.poll()
  })
  const fakeSlackOrigin = fakeSlackUrl === undefined ? undefined : new URL(fakeSlackUrl).origin
  registerIpc({
    updates: { ...updates, restart: () => void huddleQuit.confirm('restart').then((ok) => ok && updates.restart()) },
    supervisor,
    downloadFile: (file) => downloadFile(file, fakeSlackOrigin, e2e),
    openFile: (file) => openFile(file, fakeSlackOrigin, e2e),
    quickLook: (file, window) => quickLook(file, window, fakeSlackOrigin, e2e),
    copyImage: (src) => copyImage(src, fakeSlackOrigin, e2e),
    processes,
    setViewing: (topicId) => notifier.setViewing(topicId),
    notifications: {
      contentShown: () => dockBadge.contentShown(),
      test: () => notifier.test(),
      permission: notificationPermission.read,
      requestPermission: dockBadge.request,
      openSettings: openNotificationSettings,
    },
    agent,
    providers,
    codex: codexHome(agent.agentDir, e2e),
    backupSecrets,
    setTheme: (theme) => updateLaunch({ theme }),
    setAccent: (accent) => updateLaunch({ accent }),
    setTopicTitleLines: (topicTitleLines) => updateLaunch({ topicTitleLines }),
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
  activity.start()
  void providers.load()
  openWindow()
  setMenuCheckForUpdates(() => void updates.check())
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
  processes.watch(window)
  window.on('close', () => updateLaunch({ bounds: window.getNormalBounds() }))
  window.on('closed', () => screenWatch.stop())
  return window
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** The engine finishing its last requests as the app quits; undefined once it has exited. */
let engineStopping: Promise<void> | undefined

app.on('before-quit', (event) => {
  if (event.defaultPrevented) return // held for the huddle question (huddleQuit.ts)
  activity.stop()
  screenWatch.stop()
  updates.stop()
  engineStopping ??= supervisor.stop()?.finally(() => {
    engineStopping = undefined
  })
  agent.stop()
})

// The window's close writes its bounds as the app quits; a process that
// exits mid-write would leave launch.json empty and lose every choice in it.
// The engine may still be writing too: a preference set just before ⌘Q.
app.on('will-quit', (event) => {
  const pending = [launchFile.pending(), engineStopping].filter((each) => each !== undefined)
  if (pending.length === 0) return
  event.preventDefault()
  void Promise.all(pending).then(() => app.quit())
})

// The packaged smoke test (JUNO_E2E_SCREEN_PROBE, screenWatch.ts).
if (e2e && process.env.JUNO_E2E_SCREEN_PROBE === '1') void app.whenReady().then(() => writeProbeForTests(app.getPath('userData')))

// Test hooks. Playwright reaches main through app.evaluate; the engine itself
// is out of reach, so main exposes what tests need to know about it.
if (e2e) {
  Object.assign(globalThis, {
    junoTest: {
      enginePid: () => supervisor.pid,
      logsOpened: () => logsForTests.opened,
      ...engineTests.hooks,
      engineState: () => supervisor.currentState,
      failEngine: () => supervisor.giveUp(),
      contextMenu: contextMenuForTests,
      folder: folderForTests,
      slackLinks: slackLinksForTests,
      browserLinks: browserLinksForTests,
      webPanel: () => webPanelForTests(appWindow()),
      ...fileTestHooks,
      agentState: () => agent.currentState,
      agentHost: () => agent.host?.host,
      agentPid: () => agent.pid,
      ...processes.testHooks,
      notifications: () => notificationsForTests.map(({ title, body, silent }) => ({ title, body, ...(silent === true ? { silent } : {}) })),
      clickNotification: (index = 0) => notificationsForTests[index]?.click(),
      dockBadge: () => badgeForTests,
      clearDockBadge: () => dockBadge.set(''),
      ...huddleQuit.testHooks, ...dockBounce.testHooks,
      notificationPermission: permissionForTests.set,
      notificationSettingsOpened: () => notificationSettingsOpenedForTests,
      notificationRequests: permissionForTests.requests,
      ...huddleSettingsForTests,
      slackKeychainReads,
      wake: () => { notifier.wake(); refreshDockBadge() },
      // The screen watch's seam: says whether another app is capturing the screen, and polls at once.
      screenShared: (shared: boolean) => {
        sharedForTests = shared
        return screenWatch.poll()
      },
      screenWatchElapse: (ms: number) => {
        screenClockForTests += ms
      },
      flushCoverage: () => flushAllCoverage(),
      rejectInMain: () => void Promise.reject(new Error('rejected for a test')),
    },
  })
}
