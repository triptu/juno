/** Atoms backed by main through the bridge, not the engine. */
import { Effect, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { AccentSchema, AppInfo, DEFAULT_ACCENT, ThemeSchema, type Accent, type Theme } from '@juno/contract'
import type { ContextMenuItem, JunoBridge, MenuCommand } from '@juno/contract/channels'

export type { Accent, Theme } from '@juno/contract'

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
const isAccent = Schema.is(AccentSchema)

/** One value of the page's query string, or undefined without a location (tests). */
function launchParam(name: string): string | undefined {
  const search = (globalThis as { readonly location?: { readonly search: string } }).location?.search ?? ''
  return new RegExp(`[?&]${name}=([^&]*)`).exec(search)?.[1]
}

/**
 * Main loads the page as `index.html?theme=<saved>&accent=<saved>`, so the
 * first render already uses the theme the window was painted in and the
 * saved accent (performance 2.1). Light and Coral when the page has no
 * location (tests) or no parameter.
 */
function savedTheme(): Theme {
  const theme = launchParam('theme')
  return isTheme(theme) ? theme : 'light'
}

function savedAccent(): Accent {
  const accent = launchParam('accent')
  return isAccent(accent) ? accent : DEFAULT_ACCENT
}

/** The current theme. Starts as the saved theme; the OS setting is not read yet. */
export const themeAtom = Atom.make<Theme>(savedTheme())

/** Tells main, so the next launch paints the window in this theme before the page loads. */
export function persistTheme(theme: Theme): void {
  window.juno.launch.setTheme(theme).catch(() => {})
}

/** The current accent. Starts as the saved accent. */
export const accentAtom = Atom.make<Accent>(savedAccent())

/** Tells main, so the next launch's first render already uses this accent. */
export function persistAccent(accent: Accent): void {
  window.juno.launch.setAccent(accent).catch(() => {})
}

/** Shows a native context menu at the pointer. Resolves with the chosen item's id, or undefined. */
export async function popupContextMenu(items: ReadonlyArray<ContextMenuItem>): Promise<string | undefined> {
  const chosen = await window.juno.contextMenu.popup(items).catch(() => null)
  return typeof chosen === 'string' && items.some((item) => item.id === chosen) ? chosen : undefined
}

/** Opens an http or https link in the browser. */
export function openExternal(url: string): void {
  window.juno.shell.openExternal(url).catch(() => {})
}

/** Calls `listener` for each app-menu command (⌘W, ⌘⇧], ⌘⇧[). Returns the unsubscribe. */
export function onMenuCommand(listener: (command: MenuCommand) => void): () => void {
  return window.juno.menu.onCommand(listener)
}
