/**
 * Renderer ports a supervisor holds while its process is down: at most one
 * per renderer, handed over when the process is ready, closed when the
 * supervisor gives up or stops, and closed when the renderer is destroyed
 * while it waits. The `destroyed` listener leaves with its port, so a
 * long-lived window does not collect one per request.
 */
import type { MessagePortMain, WebContents } from 'electron'

export class PendingPorts {
  readonly #held = new Map<WebContents, { readonly port: MessagePortMain; readonly drop: () => void }>()

  /** Holds `port` for `target`; an earlier one for the same renderer is closed. */
  hold(target: WebContents, port: MessagePortMain): void {
    this.#forget(target)?.close()
    const drop = () => this.#forget(target)?.close()
    this.#held.set(target, { port, drop })
    target.once('destroyed', drop)
  }

  /** Hands every held port to `send` and holds none. */
  flush(send: (port: MessagePortMain) => void): void {
    for (const target of this.#held.keys()) send(this.#forget(target)!)
  }

  /** Closes every held port, so each renderer asks again. */
  close(): void {
    for (const target of this.#held.keys()) this.#forget(target)!.close()
  }

  /** Forgets `target`'s port, listener included, and answers it. Deleting the current key is safe while a Map is iterated. */
  #forget(target: WebContents): MessagePortMain | undefined {
    const held = this.#held.get(target)
    if (held === undefined) return undefined
    this.#held.delete(target)
    target.off('destroyed', held.drop)
    return held.port
  }
}
