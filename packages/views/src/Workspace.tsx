import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { colors } from '@juno/tokens/tokens.stylex'
import { EmptyState, IconButton, Tab, TabStrip, type ActivateEvent, type PhosphorIcon } from '@juno/ui'

/** The icon a tab shows: the channel kind for a topic, the page's own icon otherwise. */
export type WorkspaceTabIcon = 'hash' | 'lock' | 'user' | 'users' | 'all-topics' | 'juno' | 'notifications' | 'preferences'

export interface WorkspaceTab {
  readonly id: string
  /** The topic title, the channel name for Main (no "#"), or the page name. */
  readonly title: string
  readonly icon: WorkspaceTabIcon
  /** The topic's art, drawn in the 15px icon slot instead of the icon. */
  readonly art?: ReactNode
}

export interface WorkspaceProps {
  /** Default none: the strip is empty and the page shows the empty state. */
  readonly tabs?: ReadonlyArray<WorkspaceTab>
  readonly activeId?: string
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onSelectTab?: (id: string, event: ActivateEvent) => void
  readonly onCloseTab?: (id: string) => void
  /** The "New tab" button opens search, or All topics until M9. */
  readonly onNewTab?: () => void
  /** Right-click on a topic tab: the row context menu. Page tabs have none. */
  readonly onTabContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
  /** The active tab's page. Nothing open shows the empty state. */
  readonly children?: ReactNode
}

const icons: Record<WorkspaceTabIcon, PhosphorIcon> = {
  hash: Hash,
  lock: Lock,
  user: User,
  users: Users,
  'all-topics': ListBullets,
  juno: Sparkle,
  notifications: Bell,
  preferences: Gear,
}

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
 * Tabs carry the kind icon or the topic's art in a fixed slot, the title
 * and a close button; "+" opens search (All topics until M9). The
 * strip is an APG tablist: the active tab is the one Tab stop, the arrow
 * keys select its neighbours, Delete closes it.
 */
export function Workspace({ tabs = [], activeId, onSelectTab, onCloseTab, onNewTab, onTabContextMenu, children }: WorkspaceProps) {
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
      <TabStrip onKeyDown={onKeyDown} trailing={<IconButton icon={Plus} label="New tab" size={28} iconSize={16} tone="muted" onClick={onNewTab} />}>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            icon={icons[tab.icon]}
            leading={tab.art}
            label={tab.title}
            active={tab.id === activeId}
            onSelect={onSelectTab === undefined ? undefined : (event) => onSelectTab(tab.id, event)}
            onClose={onCloseTab === undefined ? undefined : () => onCloseTab(tab.id)}
            onContextMenu={onTabContextMenu === undefined ? undefined : (event) => onTabContextMenu(tab.id, event)}
          />
        ))}
      </TabStrip>
      <main {...stylex.props(styles.page)}>
        {children ?? (
          <div {...stylex.props(styles.empty)}>
            <EmptyState variant="workspace" illustration="nothing-open" title="Nothing open yet" body="Pick a topic on the left." padding="page" />
          </div>
        )}
      </main>
    </section>
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
