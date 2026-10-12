/**
 * Getting a port in the renderer: ask main through the bridge, then wait for
 * the preload to forward it with `window.postMessage`. The page accepts the
 * message only from itself (`event.source === window`) and only with the
 * handoff tag, so no other frame can hand it a port.
 *
 * Typed against the few window members used, not the DOM lib, so the state
 * package typechecks under Node as well.
 */
import { Schema } from 'effect'
import { PORT_HANDOFF_TAG, type JunoBridge } from '@juno/contract/channels'
import { PortRequestResult } from '@juno/contract'
import type { PortLike } from './transport'

interface HandoffEvent {
  readonly source: unknown
  readonly data: unknown
  readonly ports: ReadonlyArray<PortLike>
}

interface WindowLike {
  readonly juno: JunoBridge
  addEventListener(type: 'message', listener: (event: HandoffEvent) => void): void
  removeEventListener(type: 'message', listener: (event: HandoffEvent) => void): void
}

const PORT_TIMEOUT_MS = 10_000

/** Main's supervisor has given up on the engine; no port will come. */
export class EngineFailed extends Error {
  override readonly name = 'EngineFailed'
  constructor() {
    super('the engine failed and will not restart')
  }
}

const decodeResult = Schema.decodeUnknownSync(PortRequestResult)

export function acquireRendererPort(): Promise<PortLike> {
  const win = globalThis as unknown as WindowLike
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      win.removeEventListener('message', onMessage)
      reject(new Error('main did not send an engine port in time'))
    }, PORT_TIMEOUT_MS)
    const fail = (cause: unknown) => {
      clearTimeout(timer)
      win.removeEventListener('message', onMessage)
      reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
    const onMessage = (event: HandoffEvent) => {
      if (event.source !== win) return
      const data = event.data as { _tag?: unknown } | null
      if (!data || data._tag !== PORT_HANDOFF_TAG) return
      const port = event.ports[0]
      if (!port) return
      clearTimeout(timer)
      win.removeEventListener('message', onMessage)
      resolve(port)
    }
    win.addEventListener('message', onMessage)
    win.juno.engine.requestPort().then((answer) => {
      if (decodeResult(answer) === 'failed') fail(new EngineFailed())
    }, fail)
  })
}
