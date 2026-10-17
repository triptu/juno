import { chunk } from './chunks'

/**
 * The check bar's chunk (`SendCheckPanel.tsx`), shared by the topic composer
 * and Home's. The bar only shows after Enter, so it stays out of the start
 * bundle.
 */
export const sendCheck = chunk(() => import('./SendCheckPanel'))
export const SendCheckPanel = sendCheck.component((module) => module.default)

/** Fetch the bar's chunk once a composer has mounted, so the first bar does not wait for it. */
let barLoaded = false
export function preloadBar(): void {
  if (barLoaded) return
  barLoaded = true
  window.requestIdleCallback(() => void sendCheck.load())
}
