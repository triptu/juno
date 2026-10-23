/**
 * The window's one menu for messages and Juno's bubbles (SPEC 7, "Message
 * menu"). A topic or the Juno chat opens it with its rows and what each
 * does; this draws it where `Frame` mounts it, on demand. Only one is open
 * at a time: opening another closes the first.
 *
 * The menu, its icons, the emoji picker it turns into and what its rows do
 * are a chunk of their own (`MessageMenuPanel`), loaded when idle after a
 * topic or the Juno chat paints, so the first right-click does not wait and
 * the first bundle stays under its budget.
 */
import { Suspense, useSyncExternalStore } from 'react'
import { afterPaint, mark, measure } from '@juno/state/perf'
import type { MenuPoint, MessageMenuEntry } from '@juno/views'
import { chunk } from './chunks'

type Menus = typeof import('./MessageMenuPanel')
let menus: Menus | undefined
const menuChunk = chunk(() =>
  import('./MessageMenuPanel').then((loaded) => {
    menus = loaded
    return loaded
  }),
)
const MessageMenuPanel = menuChunk.component((module) => module.MessageMenuPanel)

/** Runs `open` with the menu's code: at once when it has loaded, else as soon as it has. */
export function withMenus(open: (loaded: Menus) => void): void {
  if (menus !== undefined) return open(menus)
  void menuChunk.load().then(open)
}

let preloaded = false
/** Fetches the menu's chunk and the workspace's emoji when idle after a list has painted, so the first right-click and More reactions do not wait. */
export function preloadMessageMenu(): void {
  if (preloaded) return
  preloaded = true
  afterPaint(() =>
    window.requestIdleCallback(() => {
      const started = mark('juno.emoji-preload')
      void menuChunk.load().then(async () => {
        const { workspaceEmojiReady } = await import('@juno/state/emoji')
        await workspaceEmojiReady
        measure('juno.emoji-preload', started)
      })
    }),
  )
}

/** An emoji as the grid shows it. */
export interface GridEmoji {
  readonly name: string
  readonly unicode: string
  readonly url?: string
}

export interface OpenMessageMenu {
  /** The pointer, or under the focused message's first line. */
  readonly anchor: MenuPoint
  readonly items: ReadonlyArray<MessageMenuEntry>
  /** Opens as the full emoji picker, at once, with its search focused (R on a focused message). */
  readonly picking?: boolean
  /** No grid: a message nobody can react to. */
  readonly noGrid?: boolean
  /** You already reacted with this emoji: its cell shows chosen. */
  readonly chosen?: (emoji: GridEmoji) => boolean
  /** A grid cell or an emoji picked after More reactions: its name, and its glyph or a custom emoji's image. */
  readonly onReact: (name: string, unicode: string | undefined, url: string | undefined) => void
  /** A row was chosen; `metaKey` with ⌘ held. */
  readonly onSelect: (id: string, how: { readonly metaKey: boolean }) => void
  /** It closed, chosen from or not: the message lets go of its open look. */
  readonly onClosed?: () => void
}

let open: { readonly menu: OpenMessageMenu; readonly n: number } | undefined
let opened = 0
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

/** Opens the menu, closing any other. The answer changes its rows while it is still open (rows that wait for the agent). */
export function openMessageMenu(menu: OpenMessageMenu): (change: Partial<OpenMessageMenu>) => void {
  const before = open
  const n = ++opened
  open = { menu, n }
  before?.menu.onClosed?.()
  changed()
  return (change) => {
    if (open?.n !== n) return
    open = { menu: { ...open.menu, ...change }, n }
    changed()
  }
}

export function closeMessageMenu(): void {
  const before = open
  if (before === undefined) return
  open = undefined
  changed()
  before.menu.onClosed?.()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A message menu is open: the selection's bar steps aside for it. */
export const useMessageMenuOpen = () => useSyncExternalStore(subscribe, () => open !== undefined)

/** Rendered once, in the window's overlay. */
export function MessageMenuHost() {
  const current = useSyncExternalStore(subscribe, () => open)
  const ready = menuChunk.useReady()
  if (current === undefined || !ready) return null
  const { menu } = current
  // Each action runs after the menu has closed, so the focus it moves (the composer, the edit field) stays there.
  const then = (action: () => void) => {
    closeMessageMenu()
    action()
  }
  return (
    <Suspense fallback={null}>
      <MessageMenuPanel
        key={current.n}
        menu={menu}
        onReact={(name, unicode, url) => then(() => menu.onReact(name, unicode, url))}
        onSelect={(id, how) => then(() => menu.onSelect(id, how))}
        onClose={closeMessageMenu}
      />
    </Suspense>
  )
}
