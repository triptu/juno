/**
 * IPC channel names and the shape of the `window.juno` bridge.
 *
 * This file has no runtime dependencies on purpose. The preload script bundles
 * it, and a sandboxed preload should stay tiny. Schemas live in index.ts.
 */

export const Channels = {
  appGetInfo: 'app.getInfo',
} as const

export type Channel = (typeof Channels)[keyof typeof Channels]

export type Platform = 'darwin' | 'win32' | 'linux'

export interface AppInfo {
  readonly name: string
  readonly version: string
  readonly platform: Platform
  readonly electron: string
}

/**
 * What the preload exposes to the renderer as `window.juno`.
 * Keep this surface small and typed. Never expose ipcRenderer itself.
 */
export interface JunoBridge {
  readonly app: {
    /** Name, version and platform of the running app, answered by main. */
    readonly getInfo: () => Promise<unknown>
  }
}
