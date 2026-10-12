/**
 * renderer <-> main: the request/response routes behind `window.juno`, with
 * the schemas main decodes input and encodes output through. Channel names
 * live in channels.ts, which the preload bundles without any runtime import.
 */
import { Schema } from 'effect'
import { Channels } from './channels'

export const PlatformSchema = Schema.Literals(['darwin', 'win32', 'linux'])
export type Platform = typeof PlatformSchema.Type

/** The one theme value. `state`, `main` and `ui` all read it from here. */
export const ThemeSchema = Schema.Literals(['light', 'dark'])
export type Theme = typeof ThemeSchema.Type

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

/** renderer -> main request/response routes over `ipcRenderer.invoke`. */
export const ShellRoutes = {
  [Channels.appGetInfo]: { input: Schema.Void, output: AppInfo },
  [Channels.engineRequestPort]: { input: Schema.Void, output: PortRequestResult },
  [Channels.launchSetTheme]: { input: Schema.Struct({ theme: ThemeSchema }), output: Schema.Void },
} as const

export type ShellRoutes = typeof ShellRoutes
export type ShellInput<C extends keyof ShellRoutes> = ShellRoutes[C]['input']['Type']
export type ShellOutput<C extends keyof ShellRoutes> = ShellRoutes[C]['output']['Type']
