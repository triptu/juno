import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { House } from '@phosphor-icons/react/dist/icons/House'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { Notification } from '@phosphor-icons/react/dist/icons/Notification'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { ConversationKind, KindFilter } from '@juno/contract'
import { menuKeys } from '@juno/contract/channels'
import { colors, layout, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import {
  activateHandlers,
  AvatarButton,
  Button,
  Chip,
  Divider,
  FilterPill,
  Icon,
  IconButton,
  NavItem,
  PillRow,
  Popover,
  SparkleDuotone,
  Text,
  tooltip,
  viewIcons,
  type AccentName,
  type ActivateEvent,
  type HueName,
  type ViewIconName,
} from '@juno/ui'
import { countLabel, kindIcon } from './look'

export type SidebarNavTarget = 'home' | 'all-topics' | 'juno' | 'search'

export interface SidebarAccount {
  readonly name: string
  readonly initials: string
  readonly hue: HueName
  readonly avatarUrl?: string
  /** Whether Slack shows you as active, drawn as a dot on the avatar. Omitted while unknown. */
  readonly presence?: 'active' | 'away'
  /** "Paused until 9am" while notifications are paused, shown as a moon on the avatar. */
  readonly paused?: string
}

export interface SidebarFilter {
  readonly kind: KindFilter
  readonly unreadOnly: boolean
  /** The selected view's id; its pill is selected instead of the kind's. */
  readonly view?: string | undefined
}

/** A view's pill (spec section 5, "Views"). */
export interface SidebarViewPill {
  readonly id: string
  readonly name: string
  /** Shown instead of the name, which becomes the tooltip and the accessible name. */
  readonly icon?: ViewIconName | undefined
  /** The icon's colour, an accent; undefined is neutral. */
  readonly color?: AccentName | undefined
  /** One of its topics has an unread mention of the user. */
  readonly mention: boolean
}

/** Which groups have unread topics the list would show, for the dots (spec section 5). */
export interface SidebarDots {
  readonly channels: boolean
  readonly dms: boolean
}

/** The channel the list is narrowed to, when it is. */
export interface SidebarScope {
  readonly name: string
  readonly kind: ConversationKind
}

export interface SidebarProps {
  /** After the traffic lights: Hide sidebar, Back and Forward (`TitlebarNav`). */
  readonly titlebarLeading?: ReactNode
  /** The window is in full screen, where macOS hides the traffic lights: the title bar starts at the sidebar's inset. */
  readonly fullScreen?: boolean
  /**
   * Under the title bar, above Juno: bars a feature shows while it is active,
   * such as the huddle bar. The slot adds no element or spacing of its own;
   * each bar brings its own insets and does not shrink.
   */
  readonly top?: ReactNode
  /** Which of Search, All topics, Home and the Juno item show, default all; without Juno the hairline under it goes too. */
  readonly pages?: ReadonlyArray<SidebarNavTarget>
  /** The account button and its menu. Without it the title bar has no account button. */
  readonly account?: SidebarAccount
  /** Unread Juno messages: the count on the Juno item, in the sidebar's counter colours. */
  readonly junoUnread?: number
  /** A background job is running: the Juno item's sparkle turns duotone. A run alone does not light it (SPEC 13.2). */
  readonly junoBusy?: boolean
  readonly activeNav?: SidebarNavTarget
  readonly filter: SidebarFilter
  readonly dots: SidebarDots
  readonly scope?: SidebarScope
  /** The account menu: open state and the panel's content (the owner fills it). */
  readonly accountMenuOpen?: boolean
  readonly accountMenu?: ReactNode
  readonly onAccountMenu?: (open: boolean) => void
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onNavigate: (target: SidebarNavTarget, event: ActivateEvent) => void
  /** Right-click on a page item or button: its menu (Open in new tab). */
  readonly onNavigateMenu?: (target: SidebarNavTarget) => void
  /** Pointer enter or focus on a page item or button: warm the page it opens. */
  readonly onNavigatePrefetch?: (target: SidebarNavTarget) => void
  readonly onFilterKind: (kind: KindFilter) => void
  /** The views, in pill order, after DMs. */
  readonly views?: ReadonlyArray<SidebarViewPill>
  /** Fires on mouse down, like the other filters. */
  readonly onFilterView?: (id: string) => void
  /** The "+" pill. */
  readonly onNewView?: () => void
  /** The view sheet is open for a new view: the "+" pill holds its hover fill, as an open trigger. */
  readonly newViewOpen?: boolean
  /** Right-click (or the context-menu key) on a view's pill. */
  readonly onViewMenu?: (id: string) => void
  /** A view's pill dropped before another view's, or at the end (`before` undefined). */
  readonly onMoveView?: (id: string, before: string | undefined) => void
  /** The view sheet, open under the filter row while present. */
  readonly viewSheet?: ReactNode
  readonly onCloseViewSheet?: () => void
  readonly onToggleUnread: () => void
  readonly onClearScope: () => void
  /**
   * The status card at the foot of the sidebar: the first sync's progress,
   * or why the rows may be behind Slack. The footer shows only while it is
   * set, or while privacy mode is on.
   */
  readonly status?: ReactNode
  /** Privacy mode is on (SPEC section 5): the footer says so and turns it off in one click. */
  readonly privacy?: boolean
  /** It is on because the screen is shared: the footer says so ("Message text hidden while sharing"). */
  readonly privacySharing?: boolean
  readonly onPrivacyOff?: () => void
  /** A quiet line at the foot of the sidebar, after the status card: what the window shows, such as sample conversations. */
  readonly note?: string
  /** The topic list. */
  readonly children: ReactNode
  /** The engine is not live yet or a sync cycle is running: the list may still change (`aria-busy` on the sidebar). */
  readonly syncing?: boolean
}

const ALL_PAGES: ReadonlyArray<SidebarNavTarget> = ['search', 'all-topics', 'home', 'juno']

/**
 * The left pane (spec section 5): the title bar with the traffic-light
 * space, Search, All topics, Home and the account button, the `top` bars,
 * the Juno nav item, a
 * hairline, the quick filters with their dots and the Unread toggle, the
 * scope chip when scoped, the list the owner renders into it, and a footer
 * while there is something to say: the sync status card, while privacy
 * mode is on a card that says so with a Show button, and the note.
 */
export function Sidebar({
  titlebarLeading,
  fullScreen = false,
  top,
  pages = ALL_PAGES,
  account,
  junoUnread = 0,
  junoBusy = false,
  activeNav,
  filter,
  dots,
  scope,
  accountMenuOpen = false,
  accountMenu,
  onAccountMenu,
  onNavigate,
  onNavigateMenu,
  onNavigatePrefetch,
  onFilterKind,
  views = [],
  onFilterView,
  onNewView,
  newViewOpen = false,
  onViewMenu,
  onMoveView,
  viewSheet,
  onCloseViewSheet,
  onToggleUnread,
  onClearScope,
  status,
  privacy = false,
  privacySharing = false,
  onPrivacyOff,
  note,
  children,
  syncing = false,
}: SidebarProps) {
  const shows = (target: SidebarNavTarget) => pages.includes(target)
  // The pill that is selected: a view, else the kind.
  const selected = filter.view !== undefined && views.some((view) => view.id === filter.view) ? filter.view : undefined
  const kind = selected === undefined ? filter.kind : undefined
  // A dot marks a group with unread topics that is not the one being viewed.
  const channelsDot = dots.channels && kind !== 'channels'
  const dmsDot = dots.dms && kind !== 'dms'
  const navMenu = (target: SidebarNavTarget) =>
    onNavigateMenu === undefined
      ? undefined
      : (event: MouseEvent<HTMLElement>) => {
          event.preventDefault()
          onNavigateMenu(target)
        }
  return (
    <aside aria-label="Sidebar" aria-busy={syncing} {...stylex.props(styles.root)}>
      <header aria-label="Sidebar title bar" {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.titlebar, fullScreen && styles.titlebarFullScreen)}>
          {titlebarLeading}
          <div {...stylex.props(styles.icons)}>
            {shows('search') ? <IconButton
              icon={MagnifyingGlass}
              label="Search"
              shortcut={menuKeys('search.open')}
              size={30}
              current={activeNav === 'search'}
              {...activateHandlers<HTMLButtonElement>((event) => onNavigate('search', event))}
              onContextMenu={navMenu('search')}
            /> : null}
            {shows('all-topics') ? <IconButton
              icon={ListBullets}
              label="All topics"
              size={30}
              current={activeNav === 'all-topics'}
              {...activateHandlers<HTMLButtonElement>((event) => onNavigate('all-topics', event))}
              onContextMenu={navMenu('all-topics')}
            /> : null}
            {shows('home') ? <IconButton
              icon={House}
              label="Home"
              size={30}
              current={activeNav === 'home'}
              {...activateHandlers<HTMLButtonElement>((event) => onNavigate('home', event))}
              onContextMenu={navMenu('home')}
              {...(onNavigatePrefetch === undefined ? {} : { onPointerEnter: () => onNavigatePrefetch('home'), onFocus: () => onNavigatePrefetch('home') })}
            /> : null}
            {account === undefined ? null : <span {...stylex.props(styles.account)}>
              <Popover
                open={accountMenuOpen}
                onClose={() => onAccountMenu?.(false)}
                width="browse"
                placement="bottom-center"
                role="dialog"
                label="Account"
                anchor={
                  <AvatarButton
                    label="Account and settings"
                    initials={account.initials}
                    hue={account.hue}
                    open={accountMenuOpen}
                    onClick={() => onAccountMenu?.(!accountMenuOpen)}
                    {...(account.avatarUrl === undefined ? {} : { src: account.avatarUrl })}
                    {...(account.presence === undefined ? {} : { presence: account.presence })}
                    {...(account.paused === undefined ? {} : { paused: account.paused })}
                  />
                }
              >
                {accountMenu}
              </Popover>
            </span>}
          </div>
        </div>
      </header>

      {top}

      {shows('juno') ? <>
      <nav aria-label="Pages" {...stylex.props(styles.nav)}>
        <NavItem
          icon={junoBusy ? SparkleDuotone : Sparkle}
          active={activeNav === 'juno'}
          kbd={menuKeys('juno.toggle')}
          onSelect={(event) => onNavigate('juno', event)}
          onContextMenu={navMenu('juno')}
          trailing={
            junoUnread > 0 ? (
              <Chip variant="count" numeric title={`${junoUnread} unread from Juno`}>
                {countLabel(junoUnread)}
              </Chip>
            ) : undefined
          }
        >
          Juno
        </NavItem>
      </nav>

      <div {...stylex.props(styles.rule)}>
        <Divider />
      </div>
      </> : null}

      {/* Filters switch on mouse down, like the rows (performance.md 4.1). A dot is in the name ("Channels, unread"), so a screen reader hears it. The view sheet hangs under the row. */}
      <Popover
        open={viewSheet !== undefined}
        onClose={() => onCloseViewSheet?.()}
        placement="bottom-start"
        width="browse"
        maxHeight="none"
        layer="picker"
        padding="md"
        label="View"
        anchor={
          <div role="group" aria-label="Quick filters" {...stylex.props(styles.filters, !shows('juno') && styles.filtersFirst)}>
            <PillRow>
              <FilterPill>
                <Button variant="filter" aria-label="All" pressed={kind === 'all'} {...activateHandlers<HTMLButtonElement>(() => onFilterKind('all'))}>
                  All
                </Button>
              </FilterPill>
              <FilterPill dot={channelsDot}>
                <Button
                  variant="filter"
                  iconStart={Hash}
                  {...tooltip('Channels')}
                  aria-label={channelsDot ? 'Channels, unread' : 'Channels'}
                  pressed={kind === 'channels'}
                  {...activateHandlers<HTMLButtonElement>(() => onFilterKind('channels'))}
                />
              </FilterPill>
              <FilterPill dot={dmsDot}>
                <Button
                  variant="filter"
                  iconStart={User}
                  {...tooltip('DMs')}
                  aria-label={dmsDot ? 'DMs, unread' : 'DMs'}
                  pressed={kind === 'dms'}
                  {...activateHandlers<HTMLButtonElement>(() => onFilterKind('dms'))}
                />
              </FilterPill>
              <ViewPills views={views} selected={selected} onFilterView={onFilterView} onViewMenu={onViewMenu} onMoveView={onMoveView} />
            </PillRow>
            {onNewView === undefined ? null : (
              <FilterPill>
                <Button variant="filter" iconStart={Plus} {...tooltip('New view')} aria-label="New view" aria-haspopup="dialog" expanded={newViewOpen} onClick={onNewView} />
              </FilterPill>
            )}
            <span {...stylex.props(styles.unread)}>
              {/* An icon pill like Channels and DMs: the dot on its corner is the unread mark the pills already use. */}
              <Button
                variant="filter"
                iconStart={Notification}
                {...tooltip('Unread only')}
                aria-label="Unread only"
                pressed={filter.unreadOnly}
                {...activateHandlers<HTMLButtonElement>(() => onToggleUnread())}
              />
            </span>
          </div>
        }
      >
        {viewSheet}
      </Popover>

      {scope ? (
        <div {...stylex.props(styles.scope)}>
          <Chip size={26} variant="filled" icon={kindIcon(scope.kind)} onRemove={onClearScope} removeLabel="Show everything" title={`Showing ${scope.name} only`}>
            {scope.name}
          </Chip>
        </div>
      ) : null}

      {children}

      {status !== undefined || privacy || note !== undefined ? (
        <div {...stylex.props(styles.footer)}>
          {status}
          {privacy ? (
            <div role="status" data-privacy-footer="" {...stylex.props(styles.privacy)}>
              <Icon icon={EyeSlash} size={14} />
              <Text variant="meta" tone="subtle" truncate sx={styles.privacyText}>
                {privacySharing ? 'Message text hidden while sharing' : 'Message text hidden'}
              </Text>
              <Button variant="raised" size="xs" aria-label="Show message text" onClick={onPrivacyOff}>
                Show
              </Button>
            </div>
          ) : null}
          {note === undefined ? null : (
            <Text variant="meta" tone="subtle" truncate sx={styles.note}>
              {note}
            </Text>
          )}
        </div>
      ) : null}
    </aside>
  )
}

interface ViewPillsProps {
  readonly views: ReadonlyArray<SidebarViewPill>
  readonly selected: string | undefined
  readonly onFilterView: SidebarProps['onFilterView']
  readonly onViewMenu: SidebarProps['onViewMenu']
  readonly onMoveView: SidebarProps['onMoveView']
}

/**
 * The views' pills. Dragging one along the row reorders it: a caret shows
 * where it lands, and only the views take part. The drag is local state;
 * the order changes when the owner saves it.
 */
function ViewPills({ views, selected, onFilterView, onViewMenu, onMoveView }: ViewPillsProps) {
  const [drag, setDrag] = useState<{ readonly id: string; readonly over?: string; readonly side?: 'before' | 'after' } | undefined>(undefined)
  const sideOf = (event: DragEvent<HTMLElement>): 'before' | 'after' => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientX < box.left + box.width / 2 ? 'before' : 'after'
  }
  const drop = () => {
    if (drag?.over === undefined || drag.side === undefined) return
    const at = views.findIndex((view) => view.id === drag.over)
    const before = drag.side === 'before' ? drag.over : views[at + 1]?.id
    if (before !== drag.id) onMoveView?.(drag.id, before)
  }
  return views.map((view) => {
    const mark = drag !== undefined && drag.over === view.id && drag.id !== view.id ? drag.side : undefined
    const on = view.id === selected
    const dot = view.mention && !on
    const name = dot ? `${view.name}, unread mention` : view.name
    const icon = view.icon === undefined ? undefined : viewIcons[view.icon]
    return (
      <FilterPill key={view.id} dot={dot} {...(mark === undefined ? {} : { mark })}>
        <Button
          variant="filter"
          data-view-pill={view.id}
          aria-label={name}
          {...(icon === undefined ? {} : { iconStart: icon, ...tooltip(view.name) })}
          {...(icon === undefined || view.color === undefined ? {} : { iconTint: view.color })}
          pressed={on}
          draggable={onMoveView !== undefined}
          onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
            if (onViewMenu === undefined) return
            event.preventDefault()
            onViewMenu(view.id)
          }}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', view.name)
            setDrag({ id: view.id })
          }}
          onDragOver={(event) => {
            if (drag === undefined) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const side = sideOf(event)
            if (drag.over !== view.id || drag.side !== side) setDrag({ id: drag.id, over: view.id, side })
          }}
          onDrop={(event) => {
            event.preventDefault()
            drop()
            setDrag(undefined)
          }}
          onDragEnd={() => setDrag(undefined)}
          {...activateHandlers<HTMLButtonElement>(() => onFilterView?.(view.id))}
        >
          {icon === undefined ? view.name : undefined}
        </Button>
      </FilterPill>
    )
  })
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    // The default width; inside the shell it fills the box the shell sizes.
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    width: layout['--sidebar-width'],
    height: '100%',
    minHeight: 0,
    backgroundColor: colors['--background-subtle'],
    borderRightWidth: '1px',
    borderRightStyle: 'solid',
    borderRightColor: colors['--border-default'],
    color: colors['--foreground-default'],
    userSelect: 'none',
  },
  // The traffic lights sit at the left of this strip (main positions them),
  // then the leading controls; the strip drags the window and the buttons
  // inside opt out.
  header: { flexShrink: 0 },
  titlebar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    height: layout['--titlebar-height'],
    paddingInlineStart: layout['--titlebar-lights-inset'],
    paddingInlineEnd: layout['--sidebar-inset'],
    WebkitAppRegion: 'drag',
  },
  // No traffic lights in full screen, so no room for them.
  titlebarFullScreen: {
    paddingInlineStart: layout['--sidebar-inset'],
  },
  icons: {
    display: 'flex',
    alignItems: 'center',
    marginInlineStart: 'auto',
    gap: spacing['--space-0-5'],
    WebkitAppRegion: 'no-drag',
  },
  account: {
    display: 'inline-flex',
    marginInlineStart: spacing['--space-1'],
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    paddingTop: spacing['--space-1'],
    paddingInline: layout['--sidebar-inset'],
  },
  rule: {
    paddingTop: spacing['--space-3'],
    paddingBottom: spacing['--space-2-5'],
    paddingInline: spacing['--space-4'],
  },
  filters: {
    display: 'flex',
    alignItems: 'center',
    flexGrow: 1,
    minWidth: 0,
    gap: spacing['--space-1-5'],
    paddingInline: layout['--sidebar-inset'],
    paddingBottom: spacing['--space-2-5'],
  },
  // With no Juno item and hairline above, the filters keep the gap under the title bar that the item had.
  filtersFirst: {
    paddingTop: spacing['--space-1'],
  },
  unread: {
    display: 'inline-flex',
    flexShrink: 0,
    marginInlineStart: 'auto',
  },
  scope: {
    display: 'flex',
    paddingInline: spacing['--space-4'],
    paddingBottom: spacing['--space-2'],
  },
  // The sidebar inset on every side, so the widget sits as far from the bottom as from the edges.
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    flexShrink: 0,
    padding: layout['--sidebar-inset'],
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors['--border-subtle'],
  },
  // One line: the icon at the row text's inset, the Show button 4px from the edge on all three sides.
  privacy: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    height: sizes['--control-30'],
    paddingInlineStart: spacing['--space-2-5'],
    paddingInlineEnd: spacing['--space-1'],
    borderRadius: radii['--radius-lg'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
  },
  privacyText: {
    flexGrow: 1,
    minWidth: 0,
  },
  // At the row text's inset, as the privacy card's line is.
  note: {
    paddingInline: spacing['--space-2-5'],
  },
})
