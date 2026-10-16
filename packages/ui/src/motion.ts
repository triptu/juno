/**
 * A duration token (`--duration-appear`, ...) in milliseconds, read from the
 * root, for Web Animations, which take a number. The built CSS may write it
 * in seconds (`.24s` for 240ms), so the unit is read too.
 */
export function rootDuration(name: string): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount)) return 0
  return value.endsWith('ms') ? amount : value.endsWith('s') ? amount * 1000 : 0
}
