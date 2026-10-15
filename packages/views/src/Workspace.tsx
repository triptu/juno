import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
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
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { colors, layout, z } from '@juno/tokens/tokens.stylex'
import { EmptyState, IconButton, Tab, TabStrip, type ActivateEvent, type PhosphorIcon } from '@juno/ui'

/** The icon a tab shows: the channel kind for a topic, the page's own icon otherwise. */
export type WorkspaceTabIcon = 'hash' | 'lock' | 'user' | 'users' | 'new-chat' | 'home' | 'all-topics' | 'juno' | 'notifications' | 'preferences'

export interface WorkspaceTab {
  readonly id: string
  /** The topic title, the channel name for Main (no "#"), or the page name. */
  readonly title: string
  readonly icon: WorkspaceTabIcon
  /** The topic's art, drawn in the 15px icon slot instead of the icon. */
  readonly art?: ReactNode
  /** Pinned: first in the strip, icon only, no close button. */
  readonly pinned?: boolean
  /** The topic has unread messages: the soft grey dot, on inactive tabs only. */
  readonly unread?: boolean
}

export interface WorkspaceProps {
  /** Default none: the strip is empty and the page shows the empty state. */
  readonly tabs?: ReadonlyArray<WorkspaceTab>
  readonly activeId?: string
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onSelectTab?: (id: string, event: ActivateEvent) => void
  readonly onCloseTab?: (id: string) => void
  /** The "+" button: a new tab, with a New chat or Home (Settings › General). */
  readonly onNewTab?: () => void
  /** The "+" button's name, after what a new tab opens. Default "New chat". */
  readonly newTabLabel?: string
  /** Right-click on a tab: the tab menu. */
  readonly onTabContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
  /** Before the tabs while the sidebar is hidden: Show sidebar, Back and Forward. */
  readonly leading?: ReactNode
  /** The open pages, the hidden ones included. Nothing here shows the empty state. */
  readonly children?: ReactNode
  /** Shows the empty state over hidden pages: no tab is open, or the active tab has no page yet. */
  readonly nothingShown?: boolean
  /** What shows with no page, null for nothing. Default the empty state. */
  readonly empty?: ReactNode
  /**
   * The Juno panel, on the right of the page below the strip, 360px with a
   * hairline. When the page would keep less than 480px, it covers the page
   * instead, at full width.
   */
  readonly side?: ReactNode
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
  notifications: Bell,
  preferences: Gear,
}

// --juno-panel-width + --juno-panel-topic-min: under this the page would be too narrow to read beside the panel.
const COVER = '@container workspace-body (width < 840px)'

const keyboard: ActivateEvent = { metaKey: false, shiftKey: false, altKey: false, source: 'keyboard' }

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
 * The right pane: the tab strip (a window drag region) over the page.
 * Tabs carry the kind icon or the topic's art in a fixed slot, the title,
 * the unread dot and a close button; pinned tabs come first as icons. "+"
 * sits right after the last tab and opens a new tab. While the sidebar is hidden, `leading`
 * holds its controls. The strip is an APG tablist: the active tab is the one Tab stop, the arrow
 * keys select its neighbours, Delete closes it.
 */
export function Workspace({ tabs = [], activeId, onSelectTab, onCloseTab, onNewTab, newTabLabel = 'New chat', onTabContextMenu, leading, children, nothingShown = false, empty, side }: WorkspaceProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (onSelectTab === undefined || !(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return
    const next = stepIndex(event.key, tabs.findIndex((tab) => tab.id === activeId), tabs.length)
    const target = next === undefined ? undefined : tabs[next]
    if (target === undefined) return
    event.preventDefault()
    onSelectTab(target.id, keyboard)
  }
  return (
    <section aria-label="Workspace" {...stylex.props(styles.root)}>
      <TabStrip onKeyDown={onKeyDown} leading={leading} trailing={<IconButton icon={Plus} label={`${newTabLabel} ⌘T`} size={28} iconSize={16} tone="muted" onClick={onNewTab} />}>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            icon={icons[tab.icon]}
            leading={tab.art}
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
      <div {...stylex.props(styles.body)}>
        <main {...stylex.props(styles.page)}>
          {children}
          {children == null || nothingShown ? (empty === undefined ? <WorkspaceEmpty /> : empty) : null}
        </main>
        {side == null ? null : (
          <aside aria-label="Juno" data-juno-panel="" {...stylex.props(styles.side)}>
            {side}
          </aside>
        )}
      </div>
    </section>
  )
}

/** The empty workspace: what shows with no tab open, until Home has its own page. */
export function WorkspaceEmpty() {
  return (
    <div data-workspace-empty="" {...stylex.props(styles.empty)}>
      <EmptyState variant="workspace" illustration="nothing-open" title="Nothing open yet" body="Pick a topic on the left." padding="page" />
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    // Fills the shell's row beside the sidebar, and the full width of a
    // column that holds it alone.
    alignSelf: 'stretch',
    minWidth: 0,
    height: '100%',
    // When the window is as narrow as the sidebar (at the minimum size under
    // zoom) the pane shrinks to nothing; its content must not paint over the
    // sidebar.
    overflow: 'hidden',
    backgroundColor: colors['--background'],
  },
  // The page and the Juno panel side by side under the strip. A named
  // container, so the panel's cover rule reads the width both share.
  body: {
    position: 'relative',
    display: 'flex',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    containerType: 'inline-size',
    containerName: 'workspace-body',
  },
  side: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    boxSizing: 'border-box',
    width: {
      default: layout['--juno-panel-width'],
      [COVER]: '100%',
    },
    position: {
      default: 'relative',
      [COVER]: 'absolute',
    },
    insetBlock: 0,
    insetInlineEnd: 0,
    zIndex: z['--z-panel'],
    minHeight: 0,
    borderInlineStartWidth: {
      default: '1px',
      [COVER]: 0,
    },
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colors['--border-default'],
    backgroundColor: colors['--background'],
  },
  // The page fills the pane under the strip; a tall page scrolls inside
  // itself and never pushes the strip.
  page: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors['--background'],
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    minHeight: 0,
  },
})
