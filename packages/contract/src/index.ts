/**
 * The wire. Three contracts live here:
 *
 * - renderer <-> engine: `effect/rpc` route groups under `routes/` (ADR 0009),
 *   live-query helpers in `live.ts`, errors in `errors.ts`.
 * - renderer <-> main: `Channels` with input and output schemas in
 *   `ShellRoutes` (`shell.ts`).
 * - engine <-> main and the port handoff: `protocol.ts`.
 */
export {
  Channels,
  Events,
  SIDEBAR_WIDTH,
  JUNO_PANEL_WIDTH,
  menuShortcuts,
  type ContextMenuAt,
  type ContextMenuItem,
  type ContextMenuLeaf,
  type MenuCommand,
} from './channels'
export * from './errors'
export * from './live'
export * from './protocol'
export * from './routes/engine'
export * from './routes/ai'
export * from './routes/devLog'
export * from './routes/agentWrites'
export * from './routes/session'
export * from './routes/topics'
export * from './routes/allTopics'
export * from './routes/reads'
export * from './routes/messages'
export * from './routes/huddle'
export * from './routes/presence'
export * from './body'
export * from './refs'
export { AllRoutes } from './routes/index'
export * from './shell'
export * from './audience'
export * from './composer'
export * from './fileText'
export * from './menus'
export * from './ids'

export * from './routes/search'
export * from './routes/prefs'
export * from './routes/art'
export * from './routes/newChat'
export * from './routes/notifications'
export * from './routes/home'
export * from './routes/send'
export * from './routes/views'
export * from './routes/files'
export * from './routes/mentions'
export * from './views'
export * from './emoji'
