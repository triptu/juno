/**
 * Typed IPC contract shared by main, preload and renderer.
 *
 * Each route pairs a channel name with an input and an output schema. Main
 * decodes the input and encodes the output through these schemas, so a bad
 * payload fails in main. The renderer decodes the response again, so a wrong
 * answer fails at the edge, not deep inside the UI.
 */
import { Schema } from 'effect'
import { Channels, type AppInfo as AppInfoType } from './channels'

export { Channels, type Channel, type JunoBridge, type Platform } from './channels'

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

export const Routes = {
  [Channels.appGetInfo]: { input: Schema.Void, output: AppInfo },
} as const

export type Routes = typeof Routes
export type RouteInput<C extends keyof Routes> = Routes[C]['input']['Type']
export type RouteOutput<C extends keyof Routes> = Routes[C]['output']['Type']
