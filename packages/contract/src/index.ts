/**
 * The wire. Three contracts live here:
 *
 * - renderer <-> engine: `effect/rpc` route groups under `routes/` (ADR 0009),
 *   live-query helpers in `live.ts`, errors in `errors.ts`.
 * - renderer <-> main: `Channels` with input and output schemas in
 *   `ShellRoutes` (`shell.ts`).
 * - engine <-> main and the port handoff: `protocol.ts`.
 */
export { Channels, Events, PORT_HANDOFF_TAG, SIDEBAR_WIDTH, type Channel, type ContextMenuItem, type JunoBridge, type MenuCommand } from './channels'
export * from './errors'
export * from './live'
export * from './protocol'
export * from './routes/engine'
export * from './routes/session'
export * from './routes/topics'
export * from './routes/reads'
export * from './routes/messages'
export * from './body'
export * from './refs'
export { AllRoutes } from './routes/index'
export * from './shell'

export * from './routes/search'
export * from './routes/prefs'
export * from './routes/art'
export * from './routes/newChat'
