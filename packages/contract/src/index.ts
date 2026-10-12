/**
 * The wire. Three contracts live here:
 *
 * - renderer <-> engine: `effect/rpc` route groups under `routes/` (ADR 0009),
 *   live-query helpers in `live.ts`, errors in `errors.ts`.
 * - renderer <-> main: `Channels` with input and output schemas in `Routes`.
 * - engine <-> main and the port handoff: `protocol.ts`.
 */
import { Schema } from 'effect'
import { Channels, type AppInfo as AppInfoType } from './channels'

export { Channels, Events, PORT_HANDOFF_TAG, type Channel, type JunoBridge, type Platform, type Theme } from './channels'
export * from './errors'
export * from './live'
export * from './protocol'
export * from './routes/engine'
export { AllRoutes } from './routes/index'

export const PlatformSchema = Schema.Literals(['darwin', 'win32', 'linux'])

export const AppInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  platform: PlatformSchema,
  electron: Schema.String,
})

// Keep the hand-written interface in channels.ts and the schema in sync.
type _AppInfoMatches = AppInfoType extends typeof AppInfo.Type
  ? typeof AppInfo.Type extends AppInfoType
    ? true
    : never
  : never
const _check: _AppInfoMatches = true
void _check

/** renderer -> main request/response routes over `ipcRenderer.invoke`. */
export const ThemeSchema = Schema.Literals(['light', 'dark'])

export const Routes = {
  [Channels.appGetInfo]: { input: Schema.Void, output: AppInfo },
  [Channels.engineRequestPort]: { input: Schema.Void, output: Schema.Void },
  [Channels.launchSetTheme]: { input: Schema.Struct({ theme: ThemeSchema }), output: Schema.Void },
} as const

export type Routes = typeof Routes
export type RouteInput<C extends keyof Routes> = Routes[C]['input']['Type']
export type RouteOutput<C extends keyof Routes> = Routes[C]['output']['Type']
