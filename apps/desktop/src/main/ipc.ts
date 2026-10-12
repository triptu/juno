import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { Schema } from 'effect'
import { Channels, Routes, type RouteInput, type RouteOutput } from '@juno/contract'
import type { EngineSupervisor } from './engine'
import type { Launch } from './launch'
import { APP_ORIGIN } from './scheme'

/**
 * Registers a request/response handler for one contract route. The input is
 * decoded and the output encoded through the route's schemas, so main never
 * trusts a renderer payload and never answers with a malformed one.
 */
function handle<C extends keyof Routes>(
  channel: C,
  handler: (input: RouteInput<C>, event: IpcMainInvokeEvent) => RouteOutput<C> | Promise<RouteOutput<C>>,
): void {
  const route = Routes[channel]
  const decodeInput = Schema.decodeUnknownSync(route.input)
  const encodeOutput = Schema.encodeUnknownSync(route.output)
  ipcMain.handle(channel, async (event, payload: unknown) => {
    assertTrustedSender(event)
    const input = decodeInput(payload) as RouteInput<C>
    return encodeOutput(await handler(input, event))
  })
}

/** Only the main frame of a window we created, showing our own page, may call into main. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || event.senderFrame !== event.sender.mainFrame || !isAppUrl(event.senderFrame?.url ?? '')) {
    throw new Error('IPC call from an untrusted frame')
  }
}

function isAppUrl(url: string): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  return Boolean(devUrl && url.startsWith(devUrl))
}

export interface IpcDeps {
  readonly supervisor: EngineSupervisor
  readonly setTheme: (theme: Launch['theme']) => void
}

export function registerIpc({ supervisor, setTheme }: IpcDeps): void {
  handle(Channels.appGetInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    electron: process.versions.electron ?? 'unknown',
  }))

  // The port cannot travel in the invoke answer; it goes out through
  // webContents.postMessage and the preload forwards it to the page.
  handle(Channels.engineRequestPort, (_input, event) => {
    supervisor.connect(event.sender)
  })

  handle(Channels.launchSetTheme, ({ theme }) => {
    setTheme(theme)
  })
}
