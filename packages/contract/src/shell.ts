/**
 * renderer <-> main: the request/response routes behind `window.juno`, with
 * the schemas main decodes input and encodes output through. Channel names
 * live in channels.ts, which the preload bundles without any runtime import.
 */
import { Schema } from 'effect'
import { Channels, SIDEBAR_WIDTH } from './channels'

export const PlatformSchema = Schema.Literals(['darwin', 'win32', 'linux'])
export type Platform = typeof PlatformSchema.Type

/** The theme the owner picks; System follows macOS. `state`, `main` and `ui` all read it from here. */
export const ThemeSchema = Schema.Literals(['system', 'light', 'dark'])
export type Theme = typeof ThemeSchema.Type
/** The theme a window paints in: System resolved against macOS. */
export type ResolvedTheme = Exclude<Theme, 'system'>
export const DEFAULT_THEME: Theme = 'system'

/** Preferences › Appearance › Density (inventory 3.3). */
export const DensitySchema = Schema.Literals(['comfortable', 'compact'])
export type Density = typeof DensitySchema.Type
export const DEFAULT_DENSITY: Density = 'comfortable'

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

/** The sidebar's width in CSS pixels (280 to 480) and whether it is hidden (spec section 4). */
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
    accelerator: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ separator: Schema.Literal(true) }),
])

export const ContextMenuItems = Schema.Array(
  Schema.Union([ContextMenuLeaf, Schema.Struct({ label: Schema.String, submenu: Schema.Array(ContextMenuLeaf).check(Schema.isMaxLength(20)) })]),
).check(Schema.isMaxLength(20))

/** Where the menu opens, in CSS pixels from the window's top left. */
export const ContextMenuAt = Schema.Struct({ x: Schema.Number, y: Schema.Number })

export const UpdateState = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['unavailable', 'disabled', 'idle']) }),
  Schema.Struct({ kind: Schema.Literal('ready'), version: Schema.String }),
])
export type UpdateState = typeof UpdateState.Type

/** A download: `saved` once the file is in ~/Downloads and shown in Finder, `failed` when Slack did not send it. */
export const DownloadResult = Schema.Literals(['saved', 'failed'])
export type DownloadResult = typeof DownloadResult.Type

/** renderer -> main request/response routes over `ipcRenderer.invoke`. */
export const ShellRoutes = {
  [Channels.updatesGet]: { input: Schema.Void, output: UpdateState },
  [Channels.updatesSet]: { input: Schema.Struct({ enabled: Schema.Boolean }), output: UpdateState },
  [Channels.updatesRestart]: { input: Schema.Void, output: Schema.Void },
  [Channels.appGetInfo]: { input: Schema.Void, output: AppInfo },
  [Channels.engineRequestPort]: { input: Schema.Void, output: PortRequestResult },
  [Channels.engineRestart]: { input: Schema.Void, output: Schema.Void },
  [Channels.agentRequestPort]: { input: Schema.Void, output: PortRequestResult },
  [Channels.agentSetOpenRouterKey]: {
    input: Schema.Struct({ key: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))) }),
    output: ProviderResult,
  },
  [Channels.agentProvider]: { input: Schema.Void, output: ProviderState },
  [Channels.agentSetProvider]: { input: ProviderChange, output: ProviderResult },
  [Channels.agentChooseFolder]: { input: Schema.Struct({ purpose: Schema.Literals(['backup', 'restore']) }), output: Schema.NullOr(Schema.String) },
  [Channels.agentRecoveryPhrase]: { input: Schema.Void, output: Schema.NullOr(Schema.String) },
  [Channels.agentTypeRecoveryPhrase]: {
    input: Schema.Struct({ phrase: Schema.String.check(Schema.isMaxLength(256)) }),
    output: Schema.Literals(['saved', 'invalid', 'failed']),
  },
  [Channels.launchSetTheme]: { input: Schema.Struct({ theme: ThemeSchema }), output: Schema.Void },
  [Channels.launchSetAccent]: { input: Schema.Struct({ accent: AccentSchema }), output: Schema.Void },
  [Channels.launchSetDensity]: { input: Schema.Struct({ density: DensitySchema }), output: Schema.Void },
  [Channels.launchSetPrivacy]: { input: Schema.Struct({ privacy: Schema.Boolean }), output: Schema.Void },
  [Channels.launchSetSidebar]: { input: SidebarLayout, output: Schema.Void },
  [Channels.contextMenuPopup]: { input: Schema.Struct({ items: ContextMenuItems, at: Schema.optionalKey(ContextMenuAt) }), output: Schema.NullOr(Schema.String) },
  [Channels.shellOpenExternal]: { input: Schema.Struct({ url: Schema.String }), output: Schema.Void },
  [Channels.shellOpenInSlack]: { input: SlackTarget, output: Schema.Void },
  [Channels.shellDownloadFile]: {
    input: Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(4096)), name: Schema.String.check(Schema.isMaxLength(512)) }),
    output: DownloadResult,
  },
  [Channels.clipboardWriteText]: { input: Schema.Struct({ text: Schema.String.check(Schema.isMaxLength(2048)) }), output: Schema.Void },
  [Channels.shellEditUndo]: { input: Schema.Void, output: Schema.Void },
  [Channels.notificationsViewing]: { input: Schema.Struct({ topicId: Schema.NullOr(Schema.String) }), output: Schema.Void },
} as const

export type ShellRoutes = typeof ShellRoutes
export type ShellInput<C extends keyof ShellRoutes> = ShellRoutes[C]['input']['Type']
export type ShellOutput<C extends keyof ShellRoutes> = ShellRoutes[C]['output']['Type']
