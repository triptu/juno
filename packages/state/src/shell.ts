/** Atoms backed by main through the bridge, not the engine. */
import { Effect, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { AppInfo, ThemeSchema, type Theme } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'

export type { Theme } from '@juno/contract'

declare const window: { readonly juno: JunoBridge }

/**
 * Asks main for the app info once and validates the answer against the
 * contract. Components read it as an AsyncResult through useAtomValue.
 */
export const appInfoAtom = Atom.make(
  Effect.tryPromise({
    try: () => window.juno.app.getInfo(),
    catch: (cause) => new Error('app.getInfo failed', { cause }),
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(AppInfo))),
)

const isTheme = Schema.is(ThemeSchema)

/**
 * Main loads the page as `index.html?theme=<saved theme>`, so the first
 * render already uses the theme the window was painted in (performance 2.1).
 * Light when the page has no location (tests) or no theme.
 */
function savedTheme(): Theme {
  const search = (globalThis as { readonly location?: { readonly search: string } }).location?.search ?? ''
  const match = /[?&]theme=([^&]*)/.exec(search)
  const theme = match?.[1]
  return isTheme(theme) ? theme : 'light'
}

/** The current theme. Starts as the saved theme; the OS setting is not read yet. */
export const themeAtom = Atom.make<Theme>(savedTheme())

/** Tells main, so the next launch paints the window in this theme before the page loads. */
export function persistTheme(theme: Theme): void {
  window.juno.launch.setTheme(theme).catch(() => {})
}
