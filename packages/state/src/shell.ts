/** Atoms backed by main through the bridge, not the engine. */
import { Effect, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { AccentSchema, AppInfo, DEFAULT_ACCENT, DEFAULT_DENSITY, DEFAULT_SIDEBAR, DEFAULT_THEME, DensitySchema, NotificationPermission, NotificationTarget, PrivacyState, SharingSetting, SIDEBAR_WIDTH, ThemeSchema, type Accent, type Density, type ResolvedTheme, type SidebarLayout, type SlackTarget, type Theme } from '@juno/contract'
import type { ContextMenuAt, ContextMenuItem, JunoBridge, MenuCommand } from '@juno/contract/channels'

export type { Accent, Density, ResolvedTheme, Theme } from '@juno/contract'

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
const isDensity = Schema.is(DensitySchema)

/** One value of the page's query string, or undefined without a location (tests). */
export function launchParam(name: string): string | undefined {
  const search = (globalThis as { readonly location?: { readonly search: string } }).location?.search ?? ''
  return new RegExp(`[?&]${name}=([^&]*)`).exec(search)?.[1]
}

/**
 * Main loads the page as `index.html?theme=<saved>&accent=<saved>&density=<saved>`,
 * so the first render already uses the theme the window was painted in,
 * the saved accent and the density (performance 2.1). System, Coral and
 * Compact when the page has no location (tests) or no parameter.
 */
function savedTheme(): Theme {
  const theme = launchParam('theme')
  return isTheme(theme) ? theme : DEFAULT_THEME
}

function savedDensity(): Density {
  const density = launchParam('density')
  return isDensity(density) ? density : DEFAULT_DENSITY
}

function savedAccent(): Accent {
  const accent = launchParam('accent')
  return isAccent(accent) ? accent : DEFAULT_ACCENT
}

/** The theme the owner picked. Starts as the saved one. */
export const themeAtom = Atom.make<Theme>(savedTheme())

/** The part of `MediaQueryList` the theme reads; the state package has no DOM types. */
interface DarkQuery {
  readonly matches: boolean
  addEventListener(type: 'change', listener: (event: { readonly matches: boolean }) => void): void
  removeEventListener(type: 'change', listener: (event: { readonly matches: boolean }) => void): void
}

/** Whether macOS is in dark mode now, and on every change. Light without a window (tests). */
const systemDarkAtom = Atom.make((get) => {
  const media = (globalThis as { readonly matchMedia?: (query: string) => DarkQuery }).matchMedia?.('(prefers-color-scheme: dark)')
  if (media === undefined) return false
  const onChange = (event: { readonly matches: boolean }) => get.setSelf(event.matches)
  media.addEventListener('change', onChange)
  get.addFinalizer(() => media.removeEventListener('change', onChange))
  return media.matches
})

/** The theme the window shows: System resolved against macOS. */
export const resolvedThemeAtom = Atom.make((get): ResolvedTheme => {
  const theme = get(themeAtom)
  return theme === 'system' ? (get(systemDarkAtom) ? 'dark' : 'light') : theme
})

/** Comfortable or Compact. Starts as the saved one. */
export const densityAtom = Atom.make<Density>(savedDensity())

/**
 * Privacy mode (SPEC section 5): message text is blurred, for screen sharing.
 * Starts as saved (`?privacy=on`, or `sharing`), so a relaunch mid-share never shows text.
 */
/** The welcome card shows by itself (SPEC 4, "The welcome"); main turns that off for tests that do not ask for it. */
export const tourOpensItself = launchParam('tour') !== 'manual'

export const privacyAtom = Atom.make<boolean>(launchParam('privacy') === 'on' || launchParam('privacy') === 'sharing')

/** Privacy mode is on because main saw the screen being shared, and the user has not touched it since. */
export const privacySharingAtom = Atom.make<boolean>(launchParam('privacy') === 'sharing')

/** Tells main, which remembers it for the next launch and hides notification text while it is on. */
export function persistPrivacy(privacy: boolean): void {
  window.juno.launch.setPrivacy(privacy).catch(() => {})
}

const decodePrivacy = Schema.decodeUnknownOption(PrivacyState)

/** Calls `listener` each time main turns privacy mode on or off because sharing started or ended. Returns the unsubscribe. */
export function onSharingPrivacy(listener: (state: PrivacyState) => void): () => void {
  return window.juno.launch.onPrivacy((value) => {
    const state = decodePrivacy(value)
    if (state._tag === 'Some') listener(state.value)
  })
}

/**
 * The window is in macOS full screen, where the traffic lights are hidden. Starts as main loaded the page
 * (`?fullscreen=1` on a reload in full screen); `onFullScreen` follows it after that.
 */
export const fullScreenAtom = Atom.make<boolean>(launchParam('fullscreen') === '1')

const decodeFullScreen = Schema.decodeUnknownOption(Schema.Boolean)

/** Calls `listener` each time the window enters or leaves full screen. Returns the unsubscribe. */
export function onFullScreen(listener: (fullScreen: boolean) => void): () => void {
  return window.juno.window.onFullScreen((value) => {
    const fullScreen = decodeFullScreen(value)
    if (fullScreen._tag === 'Some') listener(fullScreen.value)
  })
}

const decodeSharing = Schema.decodeUnknownOption(SharingSetting)

/** "Hide message text while sharing the screen", as main holds it; undefined if main did not answer. */
export async function getSharingSetting(): Promise<SharingSetting | undefined> {
  const decoded = decodeSharing(await window.juno.sharing.get().catch(() => undefined))
  return decoded._tag === 'Some' ? decoded.value : undefined
}

/** Turns hiding while sharing on or off; resolves with the setting after, or undefined if main did not answer. */
export async function setSharingSetting(hide: boolean): Promise<SharingSetting | undefined> {
  const decoded = decodeSharing(await window.juno.sharing.set(hide).catch(() => undefined))
  return decoded._tag === 'Some' ? decoded.value : undefined
}

/** Tells main, so the next launch's first render already uses this density. */
export function persistDensity(density: Density): void {
  window.juno.launch.setDensity(density).catch(() => {})
}

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
  void writeClipboardText(text).catch(() => {})
}

export async function writeClipboardText(text: string): Promise<void> {
  await window.juno.clipboard.writeText(text)
}

/** Opens a conversation in the Slack app. */
export function openInSlack(target: SlackTarget): void {
  window.juno.shell.openInSlack(target).catch(() => {})
}

/** Undo in the focused text field. */
export function editUndo(): void {
  window.juno.shell.editUndo().catch(() => {})
}

/** Opens an http, https or mailto link outside the app (main refuses any other). */
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

/** Posts Settings › Notifications' test notification, the way a message's is posted. */
export function sendTestNotification(): void {
  window.juno.notifications.test().catch(() => {})
}

const decodePermission = Schema.decodeUnknownOption(NotificationPermission)
const permissionOf = (raw: unknown): NotificationPermission => {
  const decoded = decodePermission(raw)
  return decoded._tag === 'Some' ? decoded.value : 'unknown'
}

/** Whether macOS lets Juno notify; `unknown` if main could not tell. */
export async function getNotificationPermission(): Promise<NotificationPermission> {
  return permissionOf(await window.juno.notifications.permission().catch(() => undefined))
}

/** Shows the macOS prompt while permission is not determined; resolves with the permission after. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return permissionOf(await window.juno.notifications.requestPermission().catch(() => undefined))
}

/** Opens System Settings at Juno's notifications. */
export function openNotificationSettings(): void {
  window.juno.notifications.openSettings().catch(() => {})
}
