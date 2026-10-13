import * as stylex from '@stylexjs/stylex'
import { BellSlash } from '@phosphor-icons/react/dist/icons/BellSlash'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { memo, useId, type FocusEvent, type MouseEvent } from 'react'
import type { TopicRow as TopicRowModel } from '@juno/contract'
import { accent, colors, opacity, radii, sizes, spacing, tints } from '@juno/tokens/tokens.stylex'
import {
  activateHandlers,
  Avatar,
  AvatarStack,
  ChannelIcon,
  channelIcons,
  Chip,
  Icon,
  IconButton,
  Text,
  type ActivateEvent,
  type AvatarStackPerson,
  type PhosphorIcon,
} from '@juno/ui'
import { channelIconFor, countLabel, hueFor, initials } from './look'

export interface TopicRowProps {
  /** The row as the engine shaped it. Identity-stable while its `rev` holds. */
  readonly row: TopicRowModel
  /** The relative time, already formatted ("4m"). The owner re-renders on the minute tick, not the row. */
  readonly time: string
  /** The row is the current selection. */
  readonly selected?: boolean
  /** Roving tabindex: the one row that Tab reaches. Default true. */
  readonly tabbable?: boolean
  /** Fires on mouse down; `event.metaKey` asks for a new tab. */
  readonly onOpen: (id: string, event: ActivateEvent) => void
  readonly onResolve: (id: string) => void
  /** Pointer enter or keyboard focus: warm the topic's query. */
  readonly onPrefetch?: (id: string) => void
  readonly onContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
}

const HOVER = '@media (hover: hover)'

// Row padding is 11 12 (inventory 3.1). There is no 11px step in the
// spacing scale and nothing else uses it.
const ROW_PADDING_BLOCK = '11px'

const MAIN_TITLE = 'Messages posted in this channel or DM outside any thread'
const REOPENED_TITLE = 'New activity after it was resolved'

/**
 * One sidebar row, chat style: the channel icon or the person's photo, then
 * the title and time, a two-line "Sender: text" preview with the @ and count
 * tags, and the meta line with the channel, the people, the message count
 * and the Resolve check. The check sits in a slot that is always reserved
 * and shows on hover or keyboard focus, so nothing ever moves. The row
 * activates on mouse down; Resolve on click.
 */
export const TopicRow = memo(function TopicRow({ row, time, selected = false, tabbable = true, onOpen, onResolve, onPrefetch, onContextMenu }: TopicRowProps) {
  const titleId = useId()
  const previewId = useId()
  const unread = row.unreadCount > 0
  const dimmed = row.resolved || row.status === 'unsubscribed'
  const people: ReadonlyArray<AvatarStackPerson> = row.participants.map((person) => ({
    id: person.id,
    initials: initials(person.name),
    name: person.name,
    hue: hueFor(person.color, person.id),
    ...(person.avatarUrl === undefined ? {} : { src: person.avatarUrl }),
  }))

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onPrefetch?.(row.id)
  }

  return (
    <div
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={selected}
      aria-labelledby={titleId}
      aria-describedby={previewId}
      data-topic-row=""
      data-topic-id={row.id}
      onPointerEnter={onPrefetch === undefined ? undefined : () => onPrefetch(row.id)}
      onFocus={onFocus}
      onContextMenu={onContextMenu === undefined ? undefined : (event) => onContextMenu(row.id, event)}
      {...activateHandlers<HTMLDivElement>((event) => onOpen(row.id, event))}
      {...stylex.props(styles.row, selected && styles.selected, dimmed && styles.dimmed)}
    >
      <span {...stylex.props(styles.tile)}>
        <Tile row={row} />
      </span>
      <span {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.line1)}>
          {row.resolved ? (
            <span {...stylex.props(styles.resolvedCheck)} title="Resolved">
              <Icon icon={CheckCircle} size={14} label="Resolved" />
            </span>
          ) : null}
          <Text variant="rowTitle" tone="default" weight={unread ? 'semibold' : 'medium'} truncate id={titleId} sx={styles.title}>
            {row.title}
          </Text>
          {row.tags.includes('main') ? (
            <Chip variant="outline" title={MAIN_TITLE}>
              Main
            </Chip>
          ) : null}
          {row.tags.includes('reopened') ? (
            <Chip variant="filled" title={REOPENED_TITLE}>
              Reopened
            </Chip>
          ) : null}
          {row.tags.includes('unsubscribed') ? (
            <span {...stylex.props(styles.mutedIcon)}>
              <Icon icon={BellSlash} size={13} label="Unsubscribed" />
            </span>
          ) : null}
          <Text variant="meta" tone={unread ? 'subtle' : 'muted'} numeric sx={styles.time}>
            {time}
          </Text>
        </span>
        <span {...stylex.props(styles.line2)}>
          <Text variant="preview" tone={unread ? 'subtle' : 'muted'} clamp={2} as="span" id={previewId} sx={styles.preview}>
            {row.preview.line}
          </Text>
          {row.mentionsMe || unread ? (
            <span {...stylex.props(styles.badges)}>
              {row.mentionsMe ? (
                <Chip variant="soft" title="Mentions you">
                  @
                </Chip>
              ) : null}
              {unread ? (
                <Chip variant="strong" numeric title={`${row.unreadCount} unread`}>
                  {countLabel(row.unreadCount)}
                </Chip>
              ) : null}
            </span>
          ) : null}
        </span>
        <span {...stylex.props(styles.line3)}>
          <span {...stylex.props(styles.where)}>
            <Icon icon={whereIcon(row)} size={13} />
            <Text variant="meta" tone="muted" truncate>
              {row.channel.name}
            </Text>
          </span>
          {people.length > 0 ? <AvatarStack people={people} surface={selected ? 'surface' : 'subtle'} /> : null}
          <span {...stylex.props(styles.count)} title={`${row.messageCount} messages`}>
            <Icon icon={ChatCircle} size={13} />
            <Text variant="meta" tone="muted" numeric>
              {row.messageCount}
            </Text>
          </span>
          <span {...stylex.props(styles.actionSlot)}>
            {row.canResolveOnHover ? (
              <IconButton
                icon={Check}
                label={`Resolve ${row.title}`}
                title="Resolve"
                size={22}
                iconSize={13}
                radius="full"
                variant="raised"
                tabIndex={tabbable ? 0 : -1}
                onClick={() => onResolve(row.id)}
              />
            ) : null}
          </span>
        </span>
      </span>
    </div>
  )
})

/** The 44px tile: a person for a DM, two initials for a group DM, the channel's icon otherwise. */
function Tile({ row }: { readonly row: TopicRowModel }) {
  const { channel } = row
  if (channel.kind === 'im') {
    const partner = channel.partner
    const name = partner?.name ?? channel.name
    const hue = hueFor(partner?.color ?? channel.color, partner?.id ?? channel.id)
    return <Avatar label={initials(name)} size={44} hue={hue} {...(partner?.avatarUrl === undefined ? {} : { src: partner.avatarUrl })} />
  }
  if (channel.kind === 'mpim') {
    return <Avatar kind="group" label={groupInitials(channel.name)} size={44} hue={hueFor(channel.color, channel.id)} />
  }
  const icon = channelIconFor(channel.icon)
  return <ChannelIcon name={channel.name} id={channel.id} color={hueFor(channel.color, channel.id)} size={44} {...(icon === undefined ? {} : { icon })} />
}

/** "Maya, Leo" to "ML". */
function groupInitials(name: string): string {
  return name
    .split(',')
    .map((part) => part.trim().charAt(0))
    .filter((letter) => letter.length > 0)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Line three's leading icon: the channel's own icon, or a person for DMs. */
function whereIcon(row: TopicRowModel): PhosphorIcon {
  switch (row.channel.kind) {
    case 'im':
      return User
    case 'mpim':
      return Users
    default: {
      const name = channelIconFor(row.channel.icon)
      return name === undefined ? Hash : channelIcons[name]
    }
  }
}

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-3'],
    minWidth: 0,
    paddingBlock: ROW_PADDING_BLOCK,
    paddingInline: spacing['--space-3'],
    borderRadius: radii['--radius-3xl'],
    color: colors['--foreground-default'],
    userSelect: 'none',
    // Rows are independent layout and paint units, and off-screen rows are
    // skipped entirely; the estimate keeps the scrollbar steady
    // (docs/performance.md 3.2).
    contain: 'content',
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${sizes['--row-topic-estimate']}`,
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
    // Keyboard focus ring, inset because the row sits flush in its list.
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
    // The Resolve check reads this: hidden until the pointer is over the row
    // or focus is inside it. Only opacity changes, so nothing moves.
    '--row-action-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':focus-within': '1',
    },
  },
  // Muted text fails contrast on the secondary fill (tokens.md 1.7); the
  // selected row points it at the subtle value, as ListRow does.
  selected: {
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
    },
    '--foreground-muted': colors['--foreground-subtle'],
  },
  dimmed: {
    opacity: opacity['--opacity-dim'],
  },
  tile: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
  },
  line1: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    height: sizes['--control-22'],
    minWidth: 0,
  },
  resolvedCheck: {
    display: 'inline-flex',
    flexShrink: 0,
    color: tints['--tint-resolved-fg'],
  },
  title: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 0,
  },
  mutedIcon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  time: {
    flexShrink: 0,
    marginInlineStart: 'auto',
    paddingInlineStart: spacing['--space-1'],
  },
  line2: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  preview: {
    flexGrow: 1,
    minWidth: 0,
  },
  badges: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
    paddingTop: '1px',
  },
  line3: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
    minWidth: 0,
    marginTop: spacing['--space-0-5'],
    color: colors['--foreground-muted'],
  },
  where: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    minWidth: 0,
    flexShrink: 1,
  },
  count: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
  },
  actionSlot: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-22'],
    height: sizes['--control-22'],
    marginInlineStart: 'auto',
    opacity: 'var(--row-action-opacity)',
  },
})
