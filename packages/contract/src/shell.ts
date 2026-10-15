/**
 * renderer <-> main: the request/response routes behind `window.juno`, with
 * the schemas main decodes input and encodes output through. Channel names
 * live in channels.ts, which the preload bundles without any runtime import.
 */
import { Schema } from 'effect'
import { Channels, SIDEBAR_WIDTH } from './channels'

export const PlatformSchema = Schema.Literals(['darwin', 'win32', 'linux'])
export type Platform = typeof PlatformSchema.Type

/** The one theme value. `state`, `main` and `ui` all read it from here. */
export const ThemeSchema = Schema.Literals(['light', 'dark'])
export type Theme = typeof ThemeSchema.Type

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

/** renderer -> main request/response routes over `ipcRenderer.invoke`. */
export const ShellRoutes = {
  [Channels.appGetInfo]: { input: Schema.Void, output: AppInfo },
  [Channels.engineRequestPort]: { input: Schema.Void, output: PortRequestResult },
  [Channels.engineRestart]: { input: Schema.Void, output: Schema.Void },
  [Channels.launchSetTheme]: { input: Schema.Struct({ theme: ThemeSchema }), output: Schema.Void },
  [Channels.launchSetAccent]: { input: Schema.Struct({ accent: AccentSchema }), output: Schema.Void },
  [Channels.launchSetSidebar]: { input: SidebarLayout, output: Schema.Void },
  [Channels.contextMenuPopup]: { input: Schema.Struct({ items: ContextMenuItems, at: Schema.optionalKey(ContextMenuAt) }), output: Schema.NullOr(Schema.String) },
  [Channels.shellOpenExternal]: { input: Schema.Struct({ url: Schema.String }), output: Schema.Void },
  [Channels.shellOpenInSlack]: { input: SlackTarget, output: Schema.Void },
  [Channels.clipboardWriteText]: { input: Schema.Struct({ text: Schema.String.check(Schema.isMaxLength(2048)) }), output: Schema.Void },
  [Channels.shellEditUndo]: { input: Schema.Void, output: Schema.Void },
} as const

export type ShellRoutes = typeof ShellRoutes
export type ShellInput<C extends keyof ShellRoutes> = ShellRoutes[C]['input']['Type']
export type ShellOutput<C extends keyof ShellRoutes> = ShellRoutes[C]['output']['Type']
