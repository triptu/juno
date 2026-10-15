import { isT3ThreadUrl } from '@juno/agent-contract'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { Schema } from 'effect'
import { Channels, ShellRoutes, type ContextMenuLeaf, type DownloadResult, type ShellInput, type ShellOutput } from '@juno/contract'
import type { AgentSupervisor } from './agent'
import type { BackupSecrets } from './backupSecrets'
import type { EngineSupervisor } from './engine'
import type { ProviderStore } from './providers'
import type { Updates } from './updates'
import type { Launch } from './launch'
import { APP_ORIGIN } from './scheme'

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

/**
 * Native menus are out of Playwright's reach. Under JUNO_E2E a test sets the
 * item the next context menu picks; that menu answers at once without
 * showing, and keeps the labels it was asked to show and where.
 */
/** How a test reads a menu item: "-" for a separator, "(label)" when disabled, "label ✓" when checked; submenu items start with "> ". */
function testLabel(item: ContextMenuLeaf): string {
  if ('separator' in item) return '-'
  const label = item.enabled === false ? `(${item.label})` : item.label
  return item.checked === true ? `${label} ✓` : label
}

export const contextMenuForTests: { next: string | null | undefined; lastLabels: ReadonlyArray<string>; lastAt: { readonly x: number; readonly y: number } | null } = {
  next: undefined,
  lastLabels: [],
  lastAt: null,
}

/** Under JUNO_E2E the folder picker is out of Playwright's reach too: a test sets the folder the next one picks. */
export const folderForTests: { next: string | null | undefined } = { next: undefined }

/** Under JUNO_E2E, links for the Slack app are recorded here instead of opening it. */
export const slackLinksForTests: string[] = []
const e2e = process.env.JUNO_E2E === '1'

export interface IpcDeps {
  readonly updates: Updates
  readonly supervisor: EngineSupervisor
  /** The agent's supervisor; absent while the agent is off. */
  readonly agent: AgentSupervisor
  readonly providers: ProviderStore
  /** The backup's secrets: the phrase shown once after an export, and one typed for a restore. */
  readonly backupSecrets: BackupSecrets
  readonly setTheme: (theme: Launch['theme']) => void
  readonly setAccent: (accent: NonNullable<Launch['accent']>) => void
  readonly setDensity: (density: NonNullable<Launch['density']>) => void
  readonly setPrivacy: (privacy: boolean) => void
  readonly setSidebar: (sidebar: NonNullable<Launch['sidebar']>) => void
  /** The topic the window shows, or null while it shows none or is not focused. */
  readonly setViewing: (topicId: string | null) => void
  /** Download (files.ts), with the hosts it may fetch from already bound. */
  readonly downloadFile: (file: { readonly url: string; readonly name: string }) => Promise<DownloadResult>
}

export function registerIpc({ updates, supervisor, agent, providers, backupSecrets, setTheme, setAccent, setDensity, setPrivacy, setSidebar, setViewing, downloadFile }: IpcDeps): void {
  handle(Channels.updatesGet, () => updates.get())
  handle(Channels.updatesSet, ({ enabled }) => updates.set(enabled))
  handle(Channels.updatesRestart, () => updates.restart())
  handle(Channels.appGetInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    electron: process.versions.electron ?? 'unknown',
  }))

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

  handle(Channels.launchSetDensity, ({ density }) => {
    setDensity(density)
  })

  handle(Channels.launchSetPrivacy, ({ privacy }) => {
    setPrivacy(privacy)
  })

  handle(Channels.launchSetSidebar, (sidebar) => {
    setSidebar(sidebar)
  })

  // A native menu at the pointer, or at `at`. The answer is the chosen item's id, or null.
  handle(
    Channels.contextMenuPopup,
    ({ items, at }, event) =>
      new Promise<string | null>((resolve) => {
        if (contextMenuForTests.next !== undefined) {
          const next = contextMenuForTests.next
          contextMenuForTests.next = undefined
          contextMenuForTests.lastAt = at ?? null
          contextMenuForTests.lastLabels = items.flatMap((item) => ('submenu' in item ? [item.label, ...item.submenu.map((sub) => `> ${testLabel(sub)}`)] : [testLabel(item)]))
          return resolve(next)
        }
        let chosen: string | null = null
        const leaf = (item: ContextMenuLeaf): MenuItemConstructorOptions =>
          'separator' in item
            ? { type: 'separator' }
            : {
                label: item.label,
                enabled: item.enabled ?? true,
                ...(item.checked === undefined ? {} : { type: 'checkbox', checked: item.checked }),
                // Shown only: the app menu owns the shortcut.
                ...(item.accelerator === undefined ? {} : { accelerator: item.accelerator, registerAccelerator: false }),
                click: () => (chosen = item.id),
              }
        const menu = Menu.buildFromTemplate(items.map((item) => ('submenu' in item ? { label: item.label, submenu: item.submenu.map(leaf) } : leaf(item))))
        const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const point = at === undefined ? {} : { x: Math.round(at.x), y: Math.round(at.y) }
        // The item's click runs before the menu reports it closed.
        menu.popup({ ...(window === undefined ? {} : { window }), ...point, callback: () => setImmediate(() => resolve(chosen)) })
      }),
  )

  handle(Channels.shellOpenExternal, ({ url }) => {
    if (isWebUrl(url) || isT3ThreadUrl(url)) void shell.openExternal(url)
  })

  // Built here from ids, so the renderer can never open an arbitrary slack:// link.
  handle(Channels.shellOpenInSlack, ({ teamId, channelId }) => {
    const url = new URL('slack://channel')
    url.searchParams.set('team', teamId)
    url.searchParams.set('id', channelId)
    if (e2e) slackLinksForTests.push(url.toString())
    else void shell.openExternal(url.toString())
  })

  handle(Channels.shellDownloadFile, (file) => downloadFile(file))

  handle(Channels.clipboardWriteText, ({ text }) => {
    clipboard.writeText(text)
  })

  handle(Channels.shellEditUndo, (_input, event) => {
    event.sender.undo()
  })

  handle(Channels.notificationsViewing, ({ topicId }) => {
    setViewing(topicId)
  })
}

/** Links from messages open in the browser only when they are http or https. */
function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
