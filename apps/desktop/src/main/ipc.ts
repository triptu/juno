import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { Schema } from 'effect'
import { release } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { logFolder, warningLines } from '../logging'
import { Channels, ShellRoutes, type AppState, type Diagnostics, type DownloadResult, type NotificationPermission, type SharingSetting, type ShellInput, type ShellOutput } from '@juno/contract'
import type { AgentSupervisor } from './agent'
import type { BackupSecrets } from './backupSecrets'
import { openInBrowser } from './browser'
import type { CodexHome } from './codex'
import { popupContextMenu } from './contextMenu'
import type { EngineSupervisor } from './engine'
import { watchHuddlePages } from './huddlePages'
import type { ProviderStore } from './providers'
import type { Updates } from './updates'
import type { Launch } from './launch'
import { APP_ORIGIN } from './scheme'
import { closeWebPanel, hideWebPanel, setWebPanelBounds, showWebPanel } from './webPanel'

/**
 * Registers a request/response handler for one contract route. The input is
 * decoded and the output encoded through the route's schemas, so main never
 * trusts a renderer payload and never answers with a malformed one.
 */
function handle<C extends keyof ShellRoutes>(
  channel: C,
  handler: (input: ShellInput<C>, event: IpcMainInvokeEvent) => ShellOutput<C> | Promise<ShellOutput<C>>,
): void {
  const route = ShellRoutes[channel]
  const decodeInput = Schema.decodeUnknownSync(route.input)
  const encodeOutput = Schema.encodeUnknownSync(route.output)
  ipcMain.handle(channel, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = decodeInput(payload) as ShellInput<C>
    return encodeOutput(await handler(input, event))
  })
}

/** Only the main frame of a window we created, showing our own page, may call into main. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || event.senderFrame !== event.sender.mainFrame || !isAppUrl(event.senderFrame?.url ?? '')) {
    throw new Error('IPC call from an untrusted frame')
  }
}

function isAppUrl(url: string): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  return Boolean(devUrl && url.startsWith(devUrl))
}

// The other test seams main's index reads, beside this file's own.
export { browserLinksForTests } from './browser'
export { contextMenuForTests } from './contextMenu'
export { webPanelForTests } from './webPanel'

/** Under JUNO_E2E the folder picker is out of Playwright's reach too: a test sets the folder the next one picks. */
export const folderForTests: { next: string | null | undefined } = { next: undefined }

/** Under JUNO_E2E, links for the Slack app are recorded here instead of opening it. */
export const slackLinksForTests: string[] = []
const e2e = process.env.JUNO_E2E === '1'
export const logsForTests = { opened: 0 }

export interface IpcDeps {
  readonly updates: Updates
  readonly supervisor: EngineSupervisor
  /** The agent's supervisor; absent while the agent is off. */
  readonly agent: AgentSupervisor
  readonly providers: ProviderStore
  /** Local Codex in Juno's own Codex home, for the "Set up Juno" step. */
  readonly codex: CodexHome
  /** The backup's secrets: the phrase shown once after an export, and one typed for a restore. */
  readonly backupSecrets: BackupSecrets
  readonly setTheme: (theme: Launch['theme']) => void
  readonly setAccent: (accent: NonNullable<Launch['accent']>) => void
  readonly setTopicTitleLines: (lines: NonNullable<Launch['topicTitleLines']>) => void
  readonly setDensity: (density: NonNullable<Launch['density']>) => void
  readonly setPrivacy: (privacy: boolean) => void
  readonly setSidebar: (sidebar: NonNullable<Launch['sidebar']>) => void
  /** "Hide message text while sharing the screen" (screenWatch.ts). */
  readonly sharing: { readonly get: () => SharingSetting; readonly set: (hide: boolean) => SharingSetting }
  /** The topic the window shows, or null while it shows none or is not focused. */
  readonly setViewing: (topicId: string | null) => void
  /** Settings › Notifications: the test notification, macOS's permission and its settings (notificationPermission.ts). */
  readonly notifications: {
    readonly test: () => void
    readonly permission: () => Promise<NotificationPermission>
    readonly requestPermission: () => Promise<NotificationPermission>
    readonly openSettings: () => Promise<void>
  }
  /** Download (files.ts), with the hosts it may fetch from already bound. */
  readonly downloadFile: (file: { readonly url: string; readonly name: string }) => Promise<DownloadResult>
  /** Open in the viewer (files.ts), bound the same way. */
  readonly openFile: (file: { readonly url: string; readonly name: string }) => Promise<DownloadResult>
  /** Copy image in the viewer (files.ts), bound the same way. */
  readonly copyImage: (src: string) => Promise<'copied' | 'failed'>
  /** Settings › About's diagnostics, and the renderer's view and sync for the idle CPU check (processWatch.ts). */
  readonly processes: { readonly diagnostics: () => Diagnostics; readonly reportState: (state: AppState) => void }
}

export function registerIpc({ updates, supervisor, agent, providers, codex, backupSecrets, setTheme, setAccent, setDensity, setTopicTitleLines, setPrivacy, setSidebar, sharing, setViewing, notifications, downloadFile, openFile, copyImage, processes }: IpcDeps): void {
  handle(Channels.updatesGet, () => updates.get())
  handle(Channels.updatesSet, ({ enabled }) => updates.set(enabled))
  handle(Channels.updatesRestart, () => updates.restart())
  handle(Channels.updatesDownload, () => updates.download())
  handle(Channels.updatesNotes, ({ scope }) => updates.notes(scope))
  handle(Channels.appGetInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    electron: process.versions.electron ?? 'unknown',
  }))
  handle(Channels.appDiagnostics, () => processes.diagnostics())
  handle(Channels.appLogDiagnostics, async () => ({ osVersion: process.platform === 'darwin' ? `macOS ${process.getSystemVersion()}` : `${process.platform} ${release()}`, logs: await warningLines() }))
  handle(Channels.appShowLogs, async () => {
    await mkdir(logFolder(), { recursive: true })
    if (e2e) { logsForTests.opened++; return }
    const error = await shell.openPath(logFolder())
    if (error) throw new Error('Could not open logs')
  })
  handle(Channels.appReportState, (state) => processes.reportState(state))

  // The port cannot travel in the invoke answer; it goes out through
  // webContents.postMessage and the preload forwards it to the page. The
  // answer says whether one will come at all.
  handle(Channels.engineRequestPort, (_input, event) => supervisor.connect(event.sender))
  // The same for the Juno Agent; `failed` while it is off.
  handle(Channels.agentRequestPort, (_input, event) => agent.connect(event.sender))
  // Keys go to the keychain and the agent, never to a file or a log (providers.ts).
  handle(Channels.agentSetOpenRouterKey, ({ key }) => providers.set({ _tag: 'openRouter', key }))
  handle(Channels.agentProvider, async () => {
    await providers.load()
    return providers.state
  })
  handle(Channels.agentSetProvider, (change) => providers.set(change))
  // Local Codex in Juno's own Codex home; a sign-in that worked starts the agent.
  handle(Channels.agentCodex, () => codex.status())
  handle(Channels.agentCodexSignIn, async () => {
    const after = await codex.signIn()
    if (after === 'signedIn') agent.codexSignedIn()
    return after
  })
  // The backup folder, or a backup to restore from (SPEC 13.8). The agent checks the path again.
  handle(Channels.agentChooseFolder, async ({ purpose }, event) => {
    if (e2e && folderForTests.next !== undefined) {
      const next = folderForTests.next
      folderForTests.next = undefined
      return next
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Choose',
      message: purpose === 'backup' ? 'Choose a folder for Juno’s backup.' : 'Choose the folder with the backup to restore.',
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  // Once after an export; never logged (backupSecrets.ts).
  handle(Channels.agentRecoveryPhrase, async () => (await backupSecrets.takePhrase()) ?? null)
  handle(Channels.agentTypeRecoveryPhrase, ({ phrase }) => backupSecrets.typePhrase(phrase))

  // The sidebar's Restart, after the supervisor gave up on the engine.
  handle(Channels.engineRestart, () => {
    supervisor.restart()
  })

  handle(Channels.launchSetTheme, ({ theme }) => {
    setTheme(theme)
  })

  handle(Channels.launchSetAccent, ({ accent }) => {
    setAccent(accent)
  })

  handle(Channels.launchSetTopicTitleLines, ({ topicTitleLines }) => {
    setTopicTitleLines(topicTitleLines)
  })
  handle(Channels.launchSetDensity, ({ density }) => {
    setDensity(density)
  })

  handle(Channels.launchSetPrivacy, ({ privacy }) => {
    setPrivacy(privacy)
  })

  handle(Channels.launchSetSidebar, (sidebar) => {
    setSidebar(sidebar)
  })

  handle(Channels.notificationsTest, () => notifications.test())
  handle(Channels.notificationsPermission, () => notifications.permission())
  handle(Channels.notificationsRequestPermission, () => notifications.requestPermission())
  handle(Channels.notificationsOpenSettings, () => notifications.openSettings())

  // Huddle media generations for the engine (huddlePages.ts).
  const huddlePages = watchHuddlePages(supervisor)
  // Under JUNO_E2E the page runs the fake media session, so no test talks to Chime.
  handle(Channels.huddleRegister, (_input, event) => ({ generation: huddlePages.register(event.sender.id), fakeMedia: e2e }))

  handle(Channels.sharingGet, () => sharing.get())
  handle(Channels.sharingSet, ({ hide }) => sharing.set(hide))

  // A native menu at the pointer, or at `at`. The answer is the chosen item's id, or null.
  handle(Channels.contextMenuPopup, ({ items, at }, event) => popupContextMenu(items, BrowserWindow.fromWebContents(event.sender) ?? undefined, at))

  handle(Channels.shellOpenExternal, ({ url }) => openInBrowser(url))

  // Built here from ids, so the renderer can never open an arbitrary slack:// link.
  handle(Channels.shellOpenInSlack, ({ teamId, channelId }) => {
    const url = new URL('slack://channel')
    url.searchParams.set('team', teamId)
    url.searchParams.set('id', channelId)
    if (e2e) slackLinksForTests.push(url.toString())
    else void shell.openExternal(url.toString())
  })

  handle(Channels.shellDownloadFile, (file) => downloadFile(file))
  handle(Channels.shellOpenFile, (file) => openFile(file))
  handle(Channels.clipboardWriteImage, ({ src }) => copyImage(src))

  handle(Channels.clipboardWriteText, ({ text }) => {
    clipboard.writeText(text)
  })

  handle(Channels.shellEditUndo, (_input, event) => {
    event.sender.undo()
  })

  handle(Channels.notificationsViewing, ({ topicId }) => {
    setViewing(topicId)
  })

  // The web panel of the calling window (webPanel.ts).
  handle(Channels.webPanelShow, ({ url, bounds }, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) showWebPanel(window, url, bounds)
  })
  handle(Channels.webPanelBounds, (bounds, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) setWebPanelBounds(window, bounds)
  })
  handle(Channels.webPanelHide, (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) hideWebPanel(window)
  })
  handle(Channels.webPanelClose, (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) closeWebPanel(window)
  })
}
