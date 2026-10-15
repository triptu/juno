import type { Page } from '@playwright/test'

/**
 * The rows that flash from now on, by their text. `flashChatRow` animates the
 * row it flashes, for topic messages and Juno bubbles alike, so this wraps
 * `Element.prototype.animate` in the page.
 */
export async function watchFlashes(win: Page): Promise<() => Promise<string[]>> {
  await win.evaluate(() => {
    const flashed: string[] = []
    ;(globalThis as unknown as { flashedRows: string[] }).flashedRows = flashed
    const animate = Element.prototype.animate
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if (this.matches('[data-message-row], [data-chat-juno]')) flashed.push(this.textContent ?? '')
      return animate.apply(this, args)
    }
  })
  return () => win.evaluate(() => (globalThis as unknown as { flashedRows: string[] }).flashedRows)
}
