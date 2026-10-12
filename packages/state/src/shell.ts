/** Atoms backed by main through the bridge, not the engine. */
import { Effect, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { AppInfo } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'

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

export type Theme = 'light' | 'dark'

/** The current theme. Light is the default; the OS setting is not read yet. */
export const themeAtom = Atom.make<Theme>('light')

/** Tells main, so the next launch paints the window in this theme before the page loads. */
export function persistTheme(theme: Theme): void {
  window.juno.launch.setTheme(theme).catch(() => {})
}
