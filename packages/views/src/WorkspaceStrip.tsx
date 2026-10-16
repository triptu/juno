import * as stylex from '@stylexjs/stylex'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { House } from '@phosphor-icons/react/dist/icons/House'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Avatar, IconButton, Tab, TabStrip, TopicArt, type ActivateEvent, type PhosphorIcon } from '@juno/ui'
import { hueFor, initials } from './look'

/** The icon a tab shows: the channel kind for a topic, the page's own icon otherwise. */
export type WorkspaceTabIcon = 'hash' | 'lock' | 'user' | 'users' | 'new-chat' | 'home' | 'all-topics' | 'juno' | 'settings'

export interface WorkspaceTab {
  readonly id: string
  /** The topic title, the channel name for Main (no "#"), or the page name. */
  readonly title: string
  readonly icon: WorkspaceTabIcon
  /** What the 16px icon slot shows instead of `icon`. */
  readonly tile?: WorkspaceTabTile
  /** Pinned: first in the strip, icon only, no close button. */
  readonly pinned?: boolean
  /** The topic has unread messages: the soft grey dot, on inactive tabs only. */
  readonly unread?: boolean
}

/**
 * A tab's tile: the topic's art (its placeholder shape until the art is
 * drawn), or the other person's photo in a DM, its Main and its threads.
 * The photo is the URL the sidebar shows, so it is already loaded. `blank`
 * keeps the slot empty while a topic's header loads, so no glyph shows
 * that the art or photo then replaces.
 */
export type WorkspaceTabTile =
  | { readonly kind: 'blank' }
  | { readonly kind: 'art'; readonly topicId: string; readonly recipe?: string }
  | { readonly kind: 'person'; readonly id: string; readonly name: string; readonly color: string; readonly src?: string }

export interface WorkspaceStripProps {
  /** Default none: the strip is empty and the page shows the empty state. */
  readonly tabs?: ReadonlyArray<WorkspaceTab>
  readonly activeId?: string | undefined
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onSelectTab?: ((id: string, event: ActivateEvent) => void) | undefined
  readonly onCloseTab?: ((id: string) => void) | undefined
  /** The "+" button: a new tab, with a New chat or Home (Settings › General). */
  readonly onNewTab?: (() => void) | undefined
  /** The "+" button's name, after what a new tab opens. Default "New chat". */
  readonly newTabLabel?: string
  /**
   * A tab dragged, or moved with ⌃⇧← and ⌃⇧→, to `index` in the strip. The
   * strip keeps pinned tabs among themselves; the owner clamps too.
   */
  readonly onMoveTab?: ((id: string, index: number) => void) | undefined
  /** Right-click on a tab: the tab menu. */
  readonly onTabContextMenu?: ((id: string, event: MouseEvent<HTMLDivElement>) => void) | undefined
  /** Before the tabs while the sidebar is hidden: Show sidebar, Back and Forward. */
  readonly leading?: ReactNode
}

const icons: Record<WorkspaceTabIcon, PhosphorIcon> = {
  hash: Hash,
  lock: Lock,
  user: User,
  users: Users,
  'new-chat': NotePencil,
  home: House,
  'all-topics': ListBullets,
  juno: Sparkle,
  settings: Gear,
}

const keyboard: ActivateEvent = { metaKey: false, shiftKey: false, altKey: false, source: 'keyboard' }

/** ⌃⇧← and ⌃⇧→ move the focused tab, as Firefox's ⌃⇧Page Up and Page Down do (which work too). */
function moveStep(event: KeyboardEvent<HTMLDivElement>): -1 | 1 | undefined {
  if (!event.ctrlKey || !event.shiftKey || event.metaKey || event.altKey) return undefined
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') return -1
  if (event.key === 'ArrowRight' || event.key === 'PageDown') return 1
  return undefined
}

/** The places `index` can move to: among the pinned tabs, or after them. */
function groupOf(tabs: ReadonlyArray<WorkspaceTab>, index: number): { readonly first: number; readonly last: number } {
  const pinned = tabs.filter((tab) => tab.pinned === true).length
  return tabs[index]?.pinned === true ? { first: 0, last: pinned - 1 } : { first: pinned, last: tabs.length - 1 }
}

function TabTile({ tile }: { readonly tile: WorkspaceTabTile }) {
  if (tile.kind === 'blank') return null
  if (tile.kind === 'art') return <TopicArt topicId={tile.topicId} recipe={tile.recipe} size={16} />
  return <Avatar label={initials(tile.name)} size={16} hue={hueFor(tile.color, tile.id)} {...(tile.src === undefined ? {} : { src: tile.src })} />
}

/** The tab the arrow keys select from `index`: Left and Right wrap, Home and End go to the ends. */
function stepIndex(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowLeft':
      return index <= 0 ? count - 1 : index - 1
    case 'ArrowRight':
      return index < 0 || index >= count - 1 ? 0 : index + 1
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return undefined
  }
}

/**
 * The tab strip over the workspace. Tabs carry the topic's art, a DM
 * person's photo or the page's icon in a fixed slot, the title, the unread
 * dot and a close button; pinned tabs come first as icons. "+" sits right
 * after the last tab and opens a new tab. While the sidebar is hidden,
 * `leading` holds its controls. The strip is an APG tablist: the active tab
 * is the one Tab stop, the arrow keys select its neighbours, Delete closes
 * it, and ⌃⇧← and ⌃⇧→ move it, which a screen reader hears as its new
 * position. A tab also drags to a new place.
 */
export function WorkspaceStrip({ tabs = [], activeId, onSelectTab, onCloseTab, onNewTab, newTabLabel = 'New chat', onMoveTab, onTabContextMenu, leading }: WorkspaceStripProps) {
  const status = useRef<HTMLSpanElement>(null)
  // The tab a move asked for and how many moves there were, so the same position is read again after a second move.
  const [moved, setMoved] = useState<{ readonly id: string; readonly count: number } | undefined>(undefined)
  const refocus = useRef(false)
  const latest = useRef(tabs)
  const move = useCallback(
    (id: string, index: number) => {
      onMoveTab?.(id, index)
      setMoved((last) => ({ id, count: (last?.count ?? 0) + 1 }))
    },
    [onMoveTab],
  )
  const onDrop = useCallback((from: number, to: number) => {
    const tab = latest.current[from]
    if (tab !== undefined) move(tab.id, to)
  }, [move])
  // React moves the tabs' nodes to their new order, which can take focus off the moved tab; it gets it back.
  useLayoutEffect(() => {
    latest.current = tabs
    if (!refocus.current) return
    refocus.current = false
    status.current?.parentElement?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })
  })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return
    const step = moveStep(event)
    if (step !== undefined) {
      event.preventDefault()
      const at = tabs.findIndex((tab) => tab.id === activeId)
      const { first, last } = groupOf(tabs, at)
      const to = Math.min(Math.max(at + step, first), last)
      if (at < 0 || onMoveTab === undefined || to === at) return
      refocus.current = true
      move(tabs[at]!.id, to)
      return
    }
    if (onSelectTab === undefined) return
    const next = stepIndex(event.key, tabs.findIndex((tab) => tab.id === activeId), tabs.length)
    const target = next === undefined ? undefined : tabs[next]
    if (target === undefined) return
    event.preventDefault()
    onSelectTab(target.id, keyboard)
  }
  return (
    <>
      <TabStrip onKeyDown={onKeyDown} {...(onMoveTab === undefined ? {} : { onMove: onDrop })} leading={leading} trailing={<IconButton icon={Plus} label={`${newTabLabel} ⌘T`} size={28} iconSize={16} tone="muted" onClick={onNewTab} />}>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            icon={icons[tab.icon]}
            leading={tab.tile === undefined ? undefined : <TabTile tile={tab.tile} />}
            movable={onMoveTab !== undefined}
            label={tab.title}
            active={tab.id === activeId}
            pinned={tab.pinned === true}
            unread={tab.unread === true}
            onSelect={onSelectTab === undefined ? undefined : (event) => onSelectTab(tab.id, event)}
            onClose={onCloseTab === undefined || tab.pinned === true ? undefined : () => onCloseTab(tab.id)}
            onContextMenu={onTabContextMenu === undefined ? undefined : (event) => onTabContextMenu(tab.id, event)}
          />
        ))}
      </TabStrip>
      {/* A live region without the status role, so it is not taken for the app's toasts. */}
      <span ref={status} aria-live="polite" aria-atomic="true" data-tab-announce="" {...stylex.props(styles.announce)}>
        {movedText(tabs, moved)}
      </span>
    </>
  )
}

/** What a screen reader hears after a move: the tab's new position. A trailing space on every other move makes a repeat read again. */
function movedText(tabs: ReadonlyArray<WorkspaceTab>, moved: { readonly id: string; readonly count: number } | undefined): string {
  if (moved === undefined) return ''
  const at = tabs.findIndex((tab) => tab.id === moved.id)
  if (at < 0) return ''
  return `Moved to position ${at + 1} of ${tabs.length}.${moved.count % 2 === 0 ? '\u00a0' : ''}`
}

const styles = stylex.create({
  // Read by screen readers only.
  announce: {
    position: 'absolute',
    width: '1px', // tokens-allow: The smallest box a screen reader still reads.
    height: '1px', // tokens-allow: The smallest box a screen reader still reads.
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
})
