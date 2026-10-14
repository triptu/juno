import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lightbulb } from '@phosphor-icons/react/dist/icons/Lightbulb'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { Moon } from '@phosphor-icons/react/dist/icons/Moon'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { Sun } from '@phosphor-icons/react/dist/icons/Sun'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { ReactNode } from 'react'
import type { ConversationKind, KindFilter } from '@juno/contract'
import { accent, colors, layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, AvatarButton, Button, Chip, Divider, IconButton, NavItem, Popover, type ActivateEvent, type HueName, type ThemeName } from '@juno/ui'
import { countLabel } from './look'

export type SidebarNavTarget = 'all-topics' | 'for-you' | 'juno'

export interface SidebarAccount {
  readonly name: string
  readonly initials: string
  readonly hue: HueName
  readonly avatarUrl?: string
}

export interface SidebarFilter {
  readonly kind: KindFilter
  readonly unreadOnly: boolean
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
  readonly account: SidebarAccount
  readonly theme: ThemeName
  readonly forYouCount: number
  /** Unread Juno messages: the soft grey count on the Juno item, never an accent badge. */
  readonly junoUnread?: number
  /** A background job is running: the Juno item's sparkle turns duotone. A run alone does not light it (SPEC 13.2). */
  readonly junoBusy?: boolean
  readonly activeNav?: SidebarNavTarget
  readonly filter: SidebarFilter
  readonly dots: SidebarDots
  readonly scope?: SidebarScope
  /** The account menu: open state and the panel's content (the owner fills it). */
  readonly accountMenuOpen: boolean
  readonly accountMenu?: ReactNode
  readonly onAccountMenu: (open: boolean) => void
  readonly onSearch: () => void
  readonly onBrowse: () => void
  readonly onToggleTheme: () => void
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onNavigate: (target: SidebarNavTarget, event: ActivateEvent) => void
  readonly onFilterKind: (kind: KindFilter) => void
  readonly onToggleUnread: () => void
  readonly onClearScope: () => void
  /** A status line under the filters, when the list may be behind Slack (`EngineNotice`). */
  readonly status?: ReactNode
  /** The topic list. */
  readonly children: ReactNode
}

/**
 * The left pane (spec section 5): the title bar with the traffic-light
 * space and the four icons, the three nav items, a hairline, the quick
 * filters with their dots and the Unread toggle, a status line when the
 * list may be behind Slack, the scope chip when scoped, and the list the
 * owner renders into it.
 */
export function Sidebar({
  titlebarLeading,
  account,
  theme,
  forYouCount,
  junoUnread = 0,
  junoBusy = false,
  activeNav,
  filter,
  dots,
  scope,
  accountMenuOpen,
  accountMenu,
  onAccountMenu,
  onSearch,
  onBrowse,
  onToggleTheme,
  onNavigate,
  onFilterKind,
  onToggleUnread,
  onClearScope,
  status,
  children,
}: SidebarProps) {
  // A dot marks a group with unread topics that is not the one being viewed.
  const channelsDot = dots.channels && filter.kind !== 'channels'
  const dmsDot = dots.dms && filter.kind !== 'dms'
  return (
    <aside aria-label="Sidebar" {...stylex.props(styles.root)}>
      <header aria-label="Sidebar title bar" {...stylex.props(styles.titlebar)}>
        {titlebarLeading}
        <div {...stylex.props(styles.icons)}>
          <IconButton icon={MagnifyingGlass} label="Search ⌘K" size={30} onClick={onSearch} />
          <IconButton icon={Hash} label="Browse channels and people" size={30} onClick={onBrowse} />
          <IconButton icon={theme === 'dark' ? Sun : Moon} label="Toggle theme" size={30} onClick={onToggleTheme} />
          <span {...stylex.props(styles.account)}>
            <Popover
              open={accountMenuOpen}
              onClose={() => onAccountMenu(false)}
              width="browse"
              placement="bottom-end"
              role="dialog"
              label="Account"
              anchor={
                <AvatarButton
                  label="Account and preferences"
                  initials={account.initials}
                  hue={account.hue}
                  open={accountMenuOpen}
                  onClick={() => onAccountMenu(!accountMenuOpen)}
                  {...(account.avatarUrl === undefined ? {} : { src: account.avatarUrl })}
                />
              }
            >
              {accountMenu}
            </Popover>
          </span>
        </div>
      </header>

      <nav aria-label="Pages" {...stylex.props(styles.nav)}>
        <NavItem icon={ListBullets} active={activeNav === 'all-topics'} onSelect={(event) => onNavigate('all-topics', event)}>
          All topics
        </NavItem>
        <NavItem
          icon={Lightbulb}
          active={activeNav === 'for-you'}
          onSelect={(event) => onNavigate('for-you', event)}
          trailing={
            forYouCount > 0 ? (
              <Chip variant="strong" numeric title={`${forYouCount} for you`}>
                {countLabel(forYouCount)}
              </Chip>
            ) : undefined
          }
        >
          For you
        </NavItem>
        <NavItem
          icon={Sparkle}
          iconWeight={junoBusy ? 'duotone' : undefined}
          active={activeNav === 'juno'}
          kbd="⌘J"
          onSelect={(event) => onNavigate('juno', event)}
          trailing={
            junoUnread > 0 ? (
              <Chip variant="filled" numeric title={`${junoUnread} unread from Juno`}>
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

      {/* Filters switch on mouse down, like the rows (performance.md 4.1). The dot is in the name ("Channels, unread"), so a screen reader hears it. */}
      <div role="group" aria-label="Quick filters" {...stylex.props(styles.filters)}>
        <Button variant="filter" aria-label="All" pressed={filter.kind === 'all'} {...activateHandlers<HTMLButtonElement>(() => onFilterKind('all'))}>
          All
        </Button>
        <Button
          variant="filter"
          aria-label={channelsDot ? 'Channels, unread' : 'Channels'}
          pressed={filter.kind === 'channels'}
          {...activateHandlers<HTMLButtonElement>(() => onFilterKind('channels'))}
        >
          Channels
          <Dot shown={channelsDot} />
        </Button>
        <Button variant="filter" aria-label={dmsDot ? 'DMs, unread' : 'DMs'} pressed={filter.kind === 'dms'} {...activateHandlers<HTMLButtonElement>(() => onFilterKind('dms'))}>
          DMs
          <Dot shown={dmsDot} />
        </Button>
        <span {...stylex.props(styles.unread)}>
          <Button variant="filter" pressed={filter.unreadOnly} aria-label="Show unread only" {...activateHandlers<HTMLButtonElement>(() => onToggleUnread())}>
            Unread
          </Button>
        </span>
      </div>

      {status}

      {scope ? (
        <div {...stylex.props(styles.scope)}>
          <Chip size={26} variant="filled" icon={scopeIcon(scope.kind)} onRemove={onClearScope} removeLabel="Show everything" title={`Showing ${scope.name} only`}>
            {scope.name}
          </Chip>
        </div>
      ) : null}

      {children}
    </aside>
  )
}

/** The 5px unread dot after a filter label. Its space is always reserved; only opacity changes. The button's name says it. */
function Dot({ shown }: { readonly shown: boolean }) {
  return <span aria-hidden {...stylex.props(styles.dot, shown && styles.dotShown)} />
}

function scopeIcon(kind: ConversationKind) {
  switch (kind) {
    case 'private':
      return Lock
    case 'im':
      return User
    case 'mpim':
      return Users
    default:
      return Hash
  }
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
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
  titlebar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    height: layout['--titlebar-height'],
    paddingInlineStart: layout['--titlebar-lights-inset'],
    paddingInlineEnd: spacing['--space-2-5'],
    WebkitAppRegion: 'drag',
  },
  icons: {
    display: 'flex',
    alignItems: 'center',
    marginInlineStart: 'auto',
    gap: spacing['--space-0-5'],
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
    paddingInline: spacing['--space-2-5'],
  },
  rule: {
    paddingTop: spacing['--space-3'],
    paddingBottom: spacing['--space-2-5'],
    paddingInline: spacing['--space-4'],
  },
  filters: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    paddingInline: spacing['--space-2-5'],
    paddingBottom: spacing['--space-2-5'],
  },
  unread: {
    display: 'inline-flex',
    marginInlineStart: 'auto',
  },
  dot: {
    display: 'inline-block',
    width: sizes['--unread-dot'],
    height: sizes['--unread-dot'],
    marginInlineStart: spacing['--space-1-5'],
    borderRadius: '50%',
    backgroundColor: accent['--hl'],
    verticalAlign: 'middle',
    opacity: 0,
  },
  dotShown: {
    opacity: 1,
  },
  scope: {
    display: 'flex',
    paddingInline: spacing['--space-4'],
    paddingBottom: spacing['--space-2'],
  },
})
