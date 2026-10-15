/** Atoms backed by main through the bridge, not the engine. */
import { Effect, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { AccentSchema, AppInfo, DEFAULT_ACCENT, DEFAULT_SIDEBAR, NotificationTarget, SIDEBAR_WIDTH, ThemeSchema, type Accent, type SidebarLayout, type SlackTarget, type Theme } from '@juno/contract'
import type { ContextMenuAt, ContextMenuItem, JunoBridge, MenuCommand } from '@juno/contract/channels'

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

/**
 * The saved sidebar from the page's `?sidebar=<width>` or
 * `?sidebar=<width>-hidden`, so the first render already has it.
 */
function savedSidebar(): SidebarLayout {
  const match = /^(\d+)(-hidden)?$/.exec(launchParam('sidebar') ?? '')
  if (match === null) return DEFAULT_SIDEBAR
  const width = Number(match[1])
  return { width: width >= SIDEBAR_WIDTH.min && width <= SIDEBAR_WIDTH.max ? width : SIDEBAR_WIDTH.default, collapsed: match[2] !== undefined }
}

/** The sidebar's width and hidden state. The width changes only when a drag ends; during the drag only a CSS variable moves. */
export const sidebarLayoutAtom = Atom.make<SidebarLayout>(savedSidebar()).pipe(Atom.keepAlive)

/** Tells main, so the next launch's first render has this sidebar and View › Hide Sidebar names the right action. */
export function persistSidebar(sidebar: SidebarLayout): void {
  window.juno.launch.setSidebar(sidebar).catch(() => {})
}

/** Shows a native context menu at the pointer, or at `at`. Resolves with the chosen item's id, or undefined. */
export async function popupContextMenu(items: ReadonlyArray<ContextMenuItem>, at?: ContextMenuAt): Promise<string | undefined> {
  const chosen = await window.juno.contextMenu.popup(items, at).catch(() => null)
  const ids = items.flatMap((item) => ('submenu' in item ? item.submenu : [item])).flatMap((item) => ('id' in item ? [item.id] : []))
  return typeof chosen === 'string' && ids.includes(chosen) ? chosen : undefined
}

/** Puts text on the clipboard. */
export function copyText(text: string): void {
  window.juno.clipboard.writeText(text).catch(() => {})
}

/** Opens a conversation in the Slack app. */
export function openInSlack(target: SlackTarget): void {
  window.juno.shell.openInSlack(target).catch(() => {})
}

/** Undo in the focused text field. */
export function editUndo(): void {
  window.juno.shell.editUndo().catch(() => {})
}

/** Opens an http or https link in the browser. */
export function openExternal(url: string): void {
  window.juno.shell.openExternal(url).catch(() => {})
}

/** Calls `listener` for each app-menu command (the tab keys, Back and Forward, Hide Sidebar). Returns the unsubscribe. */
export function onMenuCommand(listener: (command: MenuCommand) => void): () => void {
  return window.juno.menu.onCommand(listener)
}

/** Tells main which topic the window shows, or null. Main adds the window's focus; a notification for it is not shown. */
export function setViewing(topicId: string | null): void {
  window.juno.notifications.setViewing(topicId).catch(() => {})
}

const decodeTarget = Schema.decodeUnknownOption(NotificationTarget)

/** Calls `listener` with what a clicked notification opens. Returns the unsubscribe. */
export function onNotificationOpen(listener: (target: NotificationTarget) => void): () => void {
  return window.juno.notifications.onOpen((raw) => {
    const target = decodeTarget(raw)
    if (target._tag === 'Some') listener(target.value)
  })
}
