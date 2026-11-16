/**
 * Which keys and words the page uses: the Mac's (⌘, "this Mac") or
 * Windows' (Ctrl, "this PC"). Main puts `?platform=<process.platform>` in
 * the page's address, so this is known before the first render. Linux runs
 * only in tests, which drive the Mac's keys, so everything but Windows is
 * Mac. The gallery shows a component's Windows look with `?platform=win32`.
 */
export type KeyPlatform = 'mac' | 'windows'

function read(): KeyPlatform {
  const search = (globalThis as { readonly location?: { readonly search: string } }).location?.search ?? ''
  return /[?&]platform=win32(&|$)/.test(search) ? 'windows' : 'mac'
}

export const keyPlatform: KeyPlatform = read()
export const isWindows = keyPlatform === 'windows'
