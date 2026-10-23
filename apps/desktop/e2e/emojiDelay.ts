import type { Page } from '@playwright/test'

declare global {
  interface Window { emojiGate: { count: () => number; release: () => void } }
}

/** Hold only the local emoji subscription; every other engine request continues normally. */
export async function holdWorkspaceEmoji(win: Page): Promise<void> {
  await win.evaluate(() => {
    const post = MessagePort.prototype.postMessage
    const held: Array<() => void> = []
    let waiting = true
    MessagePort.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      const text = JSON.stringify(message, (_key, value: unknown) => typeof value === 'bigint' ? String(value) : value)
      const send = () => post.call(this, message, Array.isArray(options) ? { transfer: options } : options)
      if (waiting && text?.includes('mentions.emoji')) held.push(send)
      else send()
    }
    const socketSend = WebSocket.prototype.send
    WebSocket.prototype.send = function (data) {
      const send = () => socketSend.call(this, data)
      if (waiting && typeof data === 'string' && data.includes('mentions.emoji')) held.push(send)
      else send()
    }
    window.emojiGate = { count: () => held.length, release: () => { waiting = false; held.splice(0).forEach((send) => send()) } }
  })
}
