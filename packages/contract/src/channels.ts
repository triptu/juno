/**
 * IPC channel names and the shape of the `window.juno` bridge.
 *
 * This file has no runtime dependencies on purpose. The preload script bundles
 * it, and a sandboxed preload should stay tiny. Schemas live in shell.ts; the
 * types below are imported from them, which is erased at compile time.
 */
import type { Accent, Theme } from './shell'

export type { Accent, AppInfo, Platform, Theme } from './shell'

export const Channels = {
  appGetInfo: 'app.getInfo',
  /** Renderer asks main for a fresh engine port. The port arrives on `Events.enginePort`. */
  engineRequestPort: 'engine.requestPort',
  /** Starts the engine again after the supervisor gave up on it. */
  engineRestart: 'engine.restart',
  /** Remember the theme so the next launch paints the window in it. */
  launchSetTheme: 'launch.setTheme',
  /** Remember the accent so the next launch's first render already uses it. */
  launchSetAccent: 'launch.setAccent',
} as const

export type Channel = (typeof Channels)[keyof typeof Channels]

/** main -> preload messages sent with `webContents.postMessage`. */
export const Events = {
  /** Carries one MessagePort in `ports[0]`. */
  enginePort: 'engine.port',
} as const

/** The tag the preload puts on the `window.postMessage` that forwards the port. */
export const PORT_HANDOFF_TAG = 'juno.enginePort'

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
     * Asks main for a port to the engine. Resolves with a `PortRequestResult`;
     * on `sent` the port itself arrives as a `window` message tagged
     * PORT_HANDOFF_TAG.
     */
    readonly requestPort: () => Promise<unknown>
    /** Starts the engine again after main's supervisor gave up on it. A renderer waiting for a port then gets one. */
    readonly restart: () => Promise<unknown>
  }
  readonly launch: {
    readonly setTheme: (theme: Theme) => Promise<unknown>
    readonly setAccent: (accent: Accent) => Promise<unknown>
  }
}
