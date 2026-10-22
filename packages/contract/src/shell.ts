/**
 * renderer <-> main: the schemas of the request/response routes behind
 * `window.juno`, which main decodes input and encodes output through. The map
 * of routes is in shellRoutes.ts; channel names live in channels.ts, which the
 * preload bundles without any runtime import.
 */
import { Schema } from 'effect'
import { SIDEBAR_WIDTH } from './channels'
import { SyncFailure } from './routes/engine'

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
 * The updater as main sees it. `unavailable`: no releases repository (development,
 * tests). Otherwise `enabled` is the "Download updates automatically" setting and
 * `kind` is what About's update line shows: nothing (`idle`), a check the owner
 * asked for (`checking`, then `current` or `failed` with `details` for Copy
 * details), a signed build's downloaded update that installs on Restart to update
 * (`ready`), or a newer version (`available`). An unsigned build downloads that as a DMG; `download`
 * tracks it, and a signed build's download in place, with `progress` from 0 to 1 when known.
 */
export const UpdateState = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unavailable') }),
  Schema.Struct({ kind: Schema.Literals(['idle', 'checking', 'current']), enabled: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal('failed'), enabled: Schema.Boolean, details: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('ready'), enabled: Schema.Boolean, version: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('available'),
    enabled: Schema.Boolean,
    version: Schema.String,
    download: Schema.Literals(['none', 'downloading', 'failed']),
    progress: Schema.optionalKey(Schema.Number),
  }),
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
 * A page's huddle media generation (routes/huddle.ts), and whether it runs the
 * fake media session instead of Chime: only under JUNO_E2E, so no test talks to Chime.
 */
export const HuddleRegistration = Schema.Struct({ generation: Schema.Number, fakeMedia: Schema.Boolean })
export type HuddleRegistration = typeof HuddleRegistration.Type

/** What the Huddle menu follows: null while the user is in no huddle, else whether they are muted, share their screen, and may share (not while two others do) (SPEC 20). */
export const HuddleMenu = Schema.NullOr(Schema.Struct({ muted: Schema.Boolean, sharing: Schema.Boolean, canShare: Schema.Boolean }))
export type HuddleMenu = typeof HuddleMenu.Type

/**
 * Whether macOS lets Juno record the screen (SPEC 20, Screen share). macOS
 * answers only allowed or not, so `unknown` means not allowed and Juno has
 * not asked yet; `denied`, not allowed after it asked.
 */
export const ScreenPermission = Schema.Literals(['unknown', 'denied', 'granted'])
export type ScreenPermission = typeof ScreenPermission.Type

/** A screen or window the user may share, from `desktopCapturer`. Juno's own windows are left out. */
export const ShareSource = Schema.Struct({
  /** The `chromeMediaSourceId` to capture it with: "screen:1:0", "window:4242:0". */
  id: Schema.String,
  /** The display's name for a screen ("Built-in Retina Display"), a window's title. */
  name: Schema.String,
  kind: Schema.Literals(['screen', 'window']),
  /** A JPEG data URL, at most 480 by 300; absent when macOS gave none. */
  thumbnail: Schema.optionalKey(Schema.String),
  /** A window's app icon as a PNG data URL. */
  appIcon: Schema.optionalKey(Schema.String),
})
export type ShareSource = typeof ShareSource.Type

/** The share sheet's content: the permission, and the sources once it is granted (else none). */
export const ShareSources = Schema.Struct({ permission: ScreenPermission, sources: Schema.Array(ShareSource) })
export type ShareSources = typeof ShareSources.Type

/**
 * Whether macOS lets Juno post notifications (Settings › Notifications). `unknown` when main
 * could not ask: the page then offers Open Notification Settings anyway.
 */
export const NotificationAuthorization = Schema.Literals(['allowed', 'denied', 'notDetermined', 'unknown'])
export type NotificationAuthorization = typeof NotificationAuthorization.Type
export const NotificationPermission = Schema.Struct({
  authorization: NotificationAuthorization,
  badges: Schema.Literals(['enabled', 'disabled', 'unknown']),
})
export const unknownNotificationPermission: NotificationPermission = { authorization: 'unknown', badges: 'unknown' }
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

/**
 * Copy diagnostics: the report the window builds (versions, processes, view,
 * outbox counts). Main adds the logs, so they never pass through the window,
 * and the window's clipboard route stays short.
 */
export const DiagnosticsCopy = Schema.Struct({ report: Schema.String.check(Schema.isMaxLength(16 * 1024)) })
export type DiagnosticsCopy = typeof DiagnosticsCopy.Type
/** What the sync notice's Copy log names: the engine phase's tag and, when it failed, why. */
export const SyncLogInput = Schema.Struct({
  phase: Schema.String.check(Schema.isPattern(/^[a-z-]{1,32}$/)),
  reason: Schema.optionalKey(SyncFailure),
})
export type SyncLogInput = typeof SyncLogInput.Type
