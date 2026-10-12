/**
 * IPC channel names and the shape of the `window.juno` bridge.
 *
 * This file has no runtime dependencies on purpose. The preload script bundles
 * it, and a sandboxed preload should stay tiny. Schemas live in index.ts.
 */

export const Channels = {
  appGetInfo: 'app.getInfo',
  /** Renderer asks main for a fresh engine port. The port arrives on `Events.enginePort`. */
  engineRequestPort: 'engine.requestPort',
  /** Remember the theme so the next launch paints the window in it. */
  launchSetTheme: 'launch.setTheme',
} as const

export type Channel = (typeof Channels)[keyof typeof Channels]

/** main -> preload messages sent with `webContents.postMessage`. */
export const Events = {
  /** Carries one MessagePort in `ports[0]`. */
  enginePort: 'engine.port',
} as const

/** The tag the preload puts on the `window.postMessage` that forwards the port. */
export const PORT_HANDOFF_TAG = 'juno.enginePort'

export type Platform = 'darwin' | 'win32' | 'linux'

export type Theme = 'light' | 'dark'

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
  readonly engine: {
    /**
     * Asks main for a port to the engine. Resolves when main has sent it;
     * the port itself arrives as a `window` message tagged PORT_HANDOFF_TAG.
     */
    readonly requestPort: () => Promise<unknown>
  }
  readonly launch: {
    readonly setTheme: (theme: Theme) => Promise<unknown>
  }
}
