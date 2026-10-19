/**
 * renderer <-> main: the request/response routes behind `window.juno`, with
 * the schemas main decodes input and encodes output through. Channel names
 * live in channels.ts, which the preload bundles without any runtime import.
 */
import { Schema } from 'effect'
import { Channels, SIDEBAR_WIDTH } from './channels'

export const PlatformSchema = Schema.Literals(['darwin', 'win32', 'linux'])

/** The theme the owner picks; System follows macOS. `state`, `main` and `ui` all read it from here. */
export const ThemeSchema = Schema.Literals(['system', 'light', 'dark'])
export type Theme = typeof ThemeSchema.Type
/** The theme a window paints in: System resolved against macOS. */
export type ResolvedTheme = Exclude<Theme, 'system'>
export const DEFAULT_THEME: Theme = 'system'

/** The sections of Settings (SPEC 14), in the order its list shows them. */
export const SettingsSectionSchema = Schema.Literals(['general', 'appearance', 'notifications', 'ignored', 'tidy-up', 'juno', 'ai-activity', 'connections', 'backup', 'about'])
export type SettingsSection = typeof SettingsSectionSchema.Type

/** Maximum title lines in topic lists. One line unless chosen otherwise. */
export const TopicTitleLinesSchema = Schema.Literals(['one', 'two'])
export type TopicTitleLines = typeof TopicTitleLinesSchema.Type

/** Settings › Appearance › Density (inventory 3.3). Compact unless the user chose one: `launch.json` keeps only a chosen density. */
export const DensitySchema = Schema.Literals(['comfortable', 'compact'])
export type Density = typeof DensitySchema.Type
export const DEFAULT_DENSITY: Density = 'compact'

/**
 * The accent names, in the order the picker shows them. Coral is the
 * default. The colours themselves live in `@juno/tokens/themes.stylex`,
 * which must list the same names.
 */
export const AccentSchema = Schema.Literals(['coral', 'ink', 'marigold', 'teal', 'midnight', 'emerald', 'claret', 'cyan'])
export type Accent = typeof AccentSchema.Type
export const DEFAULT_ACCENT: Accent = 'coral'

export const AppInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  platform: PlatformSchema,
  electron: Schema.String,
})
export type AppInfo = typeof AppInfo.Type

/** Juno's name for a process: main, the window's renderer, the engine, the agent, the GPU process, the network service, or another Chromium helper. */
export const ProcessKind = Schema.Literals(['main', 'window', 'engine', 'agent', 'graphics', 'network', 'other'])
export type ProcessKind = typeof ProcessKind.Type

/** One process for the diagnostics: CPU as a share of one core over the last few seconds, memory as its resident size. */
export const ProcessReading = Schema.Struct({
  kind: ProcessKind,
  /** "Engine", "Juno agent", "Window", "Graphics", "Network", "Main", or Chromium's name for another helper. */
  name: Schema.String,
  /** Electron's type: Browser, Tab, Utility, GPU. */
  type: Schema.String,
  pid: Schema.Int,
  cpu: Schema.Number,
  memoryMb: Schema.Number,
})
export type ProcessReading = typeof ProcessReading.Type

/** What main knows for Settings › About's diagnostics. */
export const Diagnostics = Schema.Struct({
  processes: Schema.Array(ProcessReading),
  /** The engine supervisor's state: starting, ready, restarting, failed, stopped. */
  engine: Schema.String,
  /** The agent supervisor's state; stopped while no provider is set up. */
  agent: Schema.String,
  /** Seconds since launch. */
  uptime: Schema.Number,
  /** "window focused", "window hidden", "window minimized". */
  window: Schema.String,
  /** Main's last idle CPU line (processes.ts), if a process stayed busy while the app was idle. */
  busyWhileIdle: Schema.optionalKey(Schema.String),
})
export type Diagnostics = typeof Diagnostics.Type

/** What the renderer tells main for its idle CPU check: a view kind ("topic", "home", "juno"), never a title or an id. */
export const AppState = Schema.Struct({
  view: Schema.String.check(Schema.isMaxLength(40)),
  syncing: Schema.Boolean,
})
export type AppState = typeof AppState.Type

/**
 * Main's answer to a port request. `sent` means the port is on its way (or
 * queued until the engine reports ready); `failed` means the engine supervisor
 * has given up and no port will ever come.
 */
export const PortRequestResult = Schema.Literals(['sent', 'failed'])
export type PortRequestResult = typeof PortRequestResult.Type

/**
 * Juno Agent's model provider, as main holds it (SPEC 13.10). One is active
 * at a time; `null` means none is set up, and then the agent does not run.
 * Keys never leave main: only whether each one is set.
 */
export const ProviderKind = Schema.Literals(['openRouter', 'custom'])
export type ProviderKind = typeof ProviderKind.Type
export const ProviderState = Schema.Struct({
  active: Schema.NullOr(ProviderKind),
  openRouter: Schema.Struct({ key: Schema.Literals(['missing', 'set']) }),
  /** An OpenAI-compatible endpoint. `baseUrl` is empty until one is set; its key may stay missing (a local model). */
  custom: Schema.Struct({ baseUrl: Schema.String, key: Schema.Literals(['missing', 'set']) }),
})
export type ProviderState = typeof ProviderState.Type

/**
 * A change from Settings › Juno. Setting a provider up makes it active. For
 * `custom`, `key` absent keeps the stored key and `null` removes it.
 * `use` switches to a provider already set up, or to none.
 */
export const ProviderChange = Schema.Union([
  Schema.TaggedStruct('openRouter', { key: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))) }),
  Schema.TaggedStruct('custom', {
    baseUrl: Schema.String.check(Schema.isMaxLength(2048)),
    key: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024)))),
  }),
  Schema.TaggedStruct('use', { provider: Schema.NullOr(ProviderKind) }),
])
export type ProviderChange = typeof ProviderChange.Type

/** `invalid`: not a key, or not an http(s) address; nothing was stored. `failed`: the keychain refused. */
export const ProviderResult = Schema.Literals(['saved', 'removed', 'invalid', 'failed'])
export type ProviderResult = typeof ProviderResult.Type

/** Local Codex for the Juno Agent: not installed, or signed in or out in Juno's own Codex home (not the owner's). */
export const CodexSetup = Schema.Literals(['missing', 'signedOut', 'signedIn'])
export type CodexSetup = typeof CodexSetup.Type

/** The sidebar's width in CSS pixels (312 to 480) and whether it is hidden (spec section 4). */
export const SidebarLayout = Schema.Struct({
  width: Schema.Int.check(Schema.isBetween({ minimum: SIDEBAR_WIDTH.min, maximum: SIDEBAR_WIDTH.max })),
  collapsed: Schema.Boolean,
})
export type SidebarLayout = typeof SidebarLayout.Type
export const DEFAULT_SIDEBAR: SidebarLayout = { width: SIDEBAR_WIDTH.default, collapsed: false }

/** A conversation for Open in Slack. Main builds the `slack://` link from it. */
export const SlackTarget = Schema.Struct({ teamId: Schema.String, channelId: Schema.String })
export type SlackTarget = typeof SlackTarget.Type

const ContextMenuLeaf = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    enabled: Schema.optionalKey(Schema.Boolean),
    checked: Schema.optionalKey(Schema.Boolean),
    sublabel: Schema.optionalKey(Schema.String),
    accelerator: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ separator: Schema.Literal(true) }),
])

export const ContextMenuItems = Schema.Array(
  Schema.Union([ContextMenuLeaf, Schema.Struct({ label: Schema.String, submenu: Schema.Array(ContextMenuLeaf).check(Schema.isMaxLength(20)) })]),
).check(Schema.isMaxLength(20))

/** Where the menu opens, in CSS pixels from the window's top left. */
export const ContextMenuAt = Schema.Struct({ x: Schema.Number, y: Schema.Number })

/**
 * The updater as main sees it. `ready`: a signed build downloaded the update and
 * installs it on Restart to update. `available`: an unsigned build found a newer
 * version, which the owner downloads as a DMG (`download` tracks that).
 */
export const UpdateState = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['unavailable', 'disabled', 'idle']) }),
  Schema.Struct({ kind: Schema.Literal('ready'), version: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('available'), version: Schema.String, download: Schema.Literals(['none', 'downloading', 'failed']) }),
])
export type UpdateState = typeof UpdateState.Type

/** One version's changelog section, as plain lines. */
export const ReleaseNote = Schema.Struct({
  version: Schema.String,
  date: Schema.NullOr(Schema.String),
  lines: Schema.Array(Schema.String),
})
export type ReleaseNote = typeof ReleaseNote.Type

/**
 * "What's new": the ten newest sections, newest first, with the running version
 * identified for the view. `failed` when the changelog
 * could not be fetched.
 */
export const ReleaseNotes = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('notes'), installedVersion: Schema.String, availableVersions: Schema.Array(Schema.String), entries: Schema.Array(ReleaseNote) }),
  Schema.Struct({ kind: Schema.Literal('failed') }),
])
export type ReleaseNotes = typeof ReleaseNotes.Type

/**
 * Privacy mode as main set it when sharing started or ended (SPEC section 5):
 * `sharing` is true while the mode is on because the screen is shared, so
 * the sidebar footer says why.
 */
export const PrivacyState = Schema.Struct({ privacy: Schema.Boolean, sharing: Schema.Boolean })
export type PrivacyState = typeof PrivacyState.Type

/**
 * "Hide message text while sharing the screen", and whether Juno can tell: `missing` where the
 * call is not there, `alwaysOn` while another app captures the screen all the time.
 */
export const SharingSetting = Schema.Struct({ hide: Schema.Boolean, detection: Schema.Literals(['available', 'missing', 'alwaysOn']) })
export type SharingSetting = typeof SharingSetting.Type

/**
 * Whether macOS lets Juno post notifications (Settings › Notifications). `unknown` when main
 * could not ask: the page then offers Open Notification Settings anyway.
 */
export const NotificationPermission = Schema.Literals(['allowed', 'denied', 'notDetermined', 'unknown'])
export type NotificationPermission = typeof NotificationPermission.Type

/** A download: `saved` once the file is in ~/Downloads and shown in Finder, `failed` when Slack did not send it. */
export const DownloadResult = Schema.Literals(['saved', 'failed'])
export type DownloadResult = typeof DownloadResult.Type

/** Where the web panel sits, in CSS pixels from the window's top left. Main scales it by the page zoom. */
export const WebPanelBounds = Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number })
export type WebPanelBounds = typeof WebPanelBounds.Type

/** What the web panel's page shows now. `favicon` is the page's icon url, or null before it has one. */
export const WebPanelState = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  favicon: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
})
export type WebPanelState = typeof WebPanelState.Type

/** Google refuses sign-in in embedded browsers, so its apps open in the browser. */
const BROWSER_ONLY_HOSTS = ['accounts.google.com', 'docs.google.com', 'drive.google.com', 'mail.google.com', 'calendar.google.com', 'meet.google.com']

/**
 * Whether a link may open in the web panel: https, or http on this Mac, and
 * not a site that only works in a real browser. Others open in the browser.
 */
export function webPanelCanShow(url: string): boolean {
  const match = /^(https?):\/\/([a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i.exec(url)
  if (match === null) return false
  const [, scheme, host] = match as unknown as [string, string, string]
  const hostname = host.toLowerCase().replace(/\.$/, '')
  const local = hostname === 'localhost' || hostname === '127.0.0.1'
  if (scheme.toLowerCase() !== 'https' && !local) return false
  return !BROWSER_ONLY_HOSTS.includes(hostname)
}

/** renderer -> main request/response routes over `ipcRenderer.invoke`. */
export const LogDiagnostics = Schema.Struct({
  osVersion: Schema.String,
  logs: Schema.Array(Schema.Struct({ process: Schema.Literals(['main', 'engine', 'agent']), lines: Schema.Array(Schema.String) })),
})
export const ShellRoutes = {
  [Channels.appLogDiagnostics]: { input: Schema.Void, output: LogDiagnostics },
  [Channels.appShowLogs]: { input: Schema.Void, output: Schema.Void },
  [Channels.updatesGet]: { input: Schema.Void, output: UpdateState },
  [Channels.updatesSet]: { input: Schema.Struct({ enabled: Schema.Boolean }), output: UpdateState },
  [Channels.updatesRestart]: { input: Schema.Void, output: Schema.Void },
  [Channels.updatesDownload]: { input: Schema.Void, output: UpdateState },
  [Channels.updatesNotes]: { input: Schema.Struct({ scope: Schema.Literals(['installed', 'update']) }), output: ReleaseNotes },
  [Channels.appGetInfo]: { input: Schema.Void, output: AppInfo },
  [Channels.appDiagnostics]: { input: Schema.Void, output: Diagnostics },
  [Channels.appReportState]: { input: AppState, output: Schema.Void },
  [Channels.engineRequestPort]: { input: Schema.Void, output: PortRequestResult },
  [Channels.engineRestart]: { input: Schema.Void, output: Schema.Void },
  [Channels.agentRequestPort]: { input: Schema.Void, output: PortRequestResult },
  [Channels.agentSetOpenRouterKey]: {
    input: Schema.Struct({ key: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))) }),
    output: ProviderResult,
  },
  [Channels.agentProvider]: { input: Schema.Void, output: ProviderState },
  [Channels.agentSetProvider]: { input: ProviderChange, output: ProviderResult },
  [Channels.agentCodex]: { input: Schema.Void, output: CodexSetup },
  [Channels.agentCodexSignIn]: { input: Schema.Void, output: CodexSetup },
  [Channels.agentChooseFolder]: { input: Schema.Struct({ purpose: Schema.Literals(['backup', 'restore']) }), output: Schema.NullOr(Schema.String) },
  [Channels.agentRecoveryPhrase]: { input: Schema.Void, output: Schema.NullOr(Schema.String) },
  [Channels.agentTypeRecoveryPhrase]: {
    input: Schema.Struct({ phrase: Schema.String.check(Schema.isMaxLength(256)) }),
    output: Schema.Literals(['saved', 'invalid', 'failed']),
  },
  [Channels.launchSetTheme]: { input: Schema.Struct({ theme: ThemeSchema }), output: Schema.Void },
  [Channels.launchSetAccent]: { input: Schema.Struct({ accent: AccentSchema }), output: Schema.Void },
  [Channels.launchSetTopicTitleLines]: { input: Schema.Struct({ topicTitleLines: TopicTitleLinesSchema }), output: Schema.Void },
  [Channels.launchSetDensity]: { input: Schema.Struct({ density: DensitySchema }), output: Schema.Void },
  [Channels.launchSetPrivacy]: { input: Schema.Struct({ privacy: Schema.Boolean }), output: Schema.Void },
  [Channels.launchSetSidebar]: { input: SidebarLayout, output: Schema.Void },
  [Channels.sharingGet]: { input: Schema.Void, output: SharingSetting },
  [Channels.sharingSet]: { input: Schema.Struct({ hide: Schema.Boolean }), output: SharingSetting },
  [Channels.huddleRegister]: { input: Schema.Struct({ generation: Schema.String }), output: Schema.Void },
  [Channels.contextMenuPopup]: { input: Schema.Struct({ items: ContextMenuItems, at: Schema.optionalKey(ContextMenuAt) }), output: Schema.NullOr(Schema.String) },
  [Channels.shellOpenExternal]: { input: Schema.Struct({ url: Schema.String }), output: Schema.Void },
  [Channels.shellOpenInSlack]: { input: SlackTarget, output: Schema.Void },
  [Channels.shellDownloadFile]: {
    input: Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(4096)), name: Schema.String.check(Schema.isMaxLength(512)) }),
    output: DownloadResult,
  },
  [Channels.shellOpenFile]: {
    input: Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(4096)), name: Schema.String.check(Schema.isMaxLength(512)) }),
    output: DownloadResult,
  },
  [Channels.clipboardWriteImage]: { input: Schema.Struct({ src: Schema.String.check(Schema.isMaxLength(8192)) }), output: Schema.Literals(['copied', 'failed']) },
  [Channels.clipboardWriteText]: { input: Schema.Struct({ text: Schema.String.check(Schema.isMaxLength(2048)) }), output: Schema.Void },
  [Channels.shellEditUndo]: { input: Schema.Void, output: Schema.Void },
  [Channels.notificationsViewing]: { input: Schema.Struct({ topicId: Schema.NullOr(Schema.String) }), output: Schema.Void },
  [Channels.notificationsTest]: { input: Schema.Void, output: Schema.Void },
  [Channels.notificationsPermission]: { input: Schema.Void, output: NotificationPermission },
  [Channels.notificationsRequestPermission]: { input: Schema.Void, output: NotificationPermission },
  [Channels.notificationsOpenSettings]: { input: Schema.Void, output: Schema.Void },
  [Channels.webPanelShow]: { input: Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(8192)), bounds: WebPanelBounds }), output: Schema.Void },
  [Channels.webPanelBounds]: { input: WebPanelBounds, output: Schema.Void },
  [Channels.webPanelHide]: { input: Schema.Void, output: Schema.Void },
  [Channels.webPanelClose]: { input: Schema.Void, output: Schema.Void },
} as const

export type ShellRoutes = typeof ShellRoutes
export type ShellInput<C extends keyof ShellRoutes> = ShellRoutes[C]['input']['Type']
export type ShellOutput<C extends keyof ShellRoutes> = ShellRoutes[C]['output']['Type']
