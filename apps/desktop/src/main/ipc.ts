import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { Schema } from 'effect'
import { Channels, Routes, type RouteInput, type RouteOutput } from '@juno/contract'

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

/** Only the main frame of a window we created may call into main. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('IPC call from an untrusted frame')
  }
}

export function registerIpc(): void {
  handle(Channels.appGetInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    electron: process.versions.electron ?? 'unknown',
  }))
}
