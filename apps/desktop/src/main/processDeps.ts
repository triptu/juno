/**
 * What the supervisors (`engine.ts`, `agent.ts`) ask of Electron: forking a
 * utility process and making a channel. `supervisors.ts` passes the real
 * ones; the unit tests pass fakes, so a supervisor runs under bun test.
 */
import type { MessagePortMain, UtilityProcess } from 'electron'

export interface ProcessDeps {
  /** Forks `script` from main's folder as a utility process. */
  readonly fork: (script: 'engine.js' | 'agent.js', options: { readonly serviceName: string; readonly partition?: string }) => UtilityProcess
  /** A new channel, one end for each side. */
  readonly channel: () => { readonly port1: MessagePortMain; readonly port2: MessagePortMain }
}
