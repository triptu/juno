import * as stylex from '@stylexjs/stylex'
import { BellSlash } from '@phosphor-icons/react/dist/icons/BellSlash'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { memo, useId, type FocusEvent, type MouseEvent, type PointerEvent } from 'react'
import type { Person, TopicRow as TopicRowModel } from '@juno/contract'
import { accent, colors, density, opacity, radii, sizes, spacing, tints } from '@juno/tokens/tokens.stylex'
import {
  activateHandlers,
  Avatar,
  AvatarStack,
  Chip,
  GroupAvatar,
  Icon,
  IconButton,
  pointerMoved,
  Text,
  tooltip,
  TopicArt,
  type ActivateEvent,
  type AvatarStackPerson,
  type PhosphorIcon,
} from '@juno/ui'
import { countLabel, groupInitials, hueFor, initials } from './look'
import { RenameField } from './RenameField'

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
  /** Pointer enter or keyboard focus: warm the topic's query. Not when the row scrolls under a still pointer. */
  readonly onPrefetch?: (id: string) => void
  readonly onContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
  /** The title is a field for Rename: the row does not open and shows no Resolve until it ends. */
  readonly renaming?: boolean
  /** Rename saved (Enter or leaving the field) with the text as typed. */
  readonly onRename?: (id: string, title: string) => void
  /** Rename cancelled (Esc). */
  readonly onRenameCancel?: (id: string) => void
  /**
   * Main rows only: threads started in the channel since its Main was last
   * read. Hidden at 0. The engine does not supply it yet; only the gallery
   * passes it.
   */
  readonly newThreads?: number
}

const HOVER = '@media (hover: hover)'
// Only the mask's alpha counts; the colours are not painted.
const PLACE_MASK = `linear-gradient(to left, transparent ${sizes['--control-22']}, black calc(${sizes['--control-22']} + ${spacing['--space-3']}))` // tokens-allow: mask alpha, not a colour


const REOPENED_TITLE = 'New activity after it was resolved'
const PRIVATE_TITLE = 'Private channel'

/**
 * One sidebar row, chat style: the topic's art or the person's photo, then
 * the title and time, a one-line "Sender: text" preview ending with the
 * people who wrote the unread messages beside the @ and count tags, and the
 * meta line: the place with its Reopened tag. Text takes three levels: the
 * title, the preview one step down, and the meta line and time a step below
 * that. A Main (a channel's, a DM's or a group DM's) has no meta line and no
 * Main tag: Main is the default and its title already names the place, so
 * the row is two lines and shorter, and a Reopened tag or the new-thread
 * count follows the title. The Resolve check overlays the end of the last
 * line on hover or keyboard focus and takes no space, so nothing ever
 * moves. The row activates on mouse down; Resolve on click.
 *
 * The row is a focusable list item, not a button: a button's children are
 * presentational, so the Resolve button inside it would be flattened away.
 * Enter and Space open it, as on a button.
 */
export const TopicRow = memo(function TopicRow({
  row,
  time,
  selected = false,
  tabbable = true,
  onOpen,
  onResolve,
  onPrefetch,
  onContextMenu,
  renaming = false,
  onRename,
  onRenameCancel,
  newThreads = 0,
}: TopicRowProps) {
  const titleId = useId()
  const previewId = useId()
  const stateId = useId()
  const unread = row.unreadCount > 0
  // Resolved and unsubscribed rows read quieter: the check or the muted bell
  // says why, the title steps down to the subtle colour and the tile fades.
  // The text keeps at least 4.5:1, so the row itself is never faded.
  const quiet = row.resolved || row.status === 'unsubscribed'
  const main = row.tags.includes('main')
  const twoLine = isTwoLine(row)
  const reopened = row.tags.includes('reopened')
  const threads = main && newThreads > 0 ? newThreads : 0
  const threadsLabel = threads === 1 ? '1 new thread' : `${threads} new threads`
  const unreadLabel = row.unreadExact ? `${row.unreadCount} unread` : `${row.unreadCount} or more unread`
  const state = rowState(row, unreadLabel, threads > 0 ? threadsLabel : undefined)
  const people: ReadonlyArray<AvatarStackPerson> = row.participants.map((person) => stackPerson(person))
  const hasPeople = people.length > 0
  const resolvable = row.canResolveOnHover && !renaming
  // Line three's tags, or line one's on a two-line row. Never a Main tag: Main is the default.
  const tags = (
    <>
      {reopened ? (
        <Chip variant="filled" title={REOPENED_TITLE}>
          Reopened
        </Chip>
      ) : null}
      {threads > 0 ? (
        <span {...stylex.props(styles.threads)} title={threadsLabel}>
          <Icon icon={ChatsCircle} size={13} />
          <Text variant="meta" tone="muted" numeric>
            {threads}
          </Text>
        </span>
      ) : null}
    </>
  )
  const resolve = resolvable ? (
    <span {...stylex.props(styles.actionSlot, twoLine && styles.actionSlotLine2)}>
      <IconButton
        icon={Check}
        label={`Resolve ${row.title}`}
        {...tooltip('Resolve')}
        size={22}
        iconSize={13}
        radius="full"
        variant="raised"
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onResolve(row.id)}
      />
    </span>
  ) : null

  const hasTrail = hasPeople || row.mentionsMe || unread
  // The preview, then who wrote the unread messages beside the @ and the
  // count, all at the line's end. Nothing is kept for any of them when
  // absent: the preview takes the space.
  const line2 = (
    <span {...stylex.props(styles.line2, twoLine && resolvable && styles.underMask)}>
      {/* The message sets the direction; the sender is isolated so a Latin
          name before Arabic text, or the reverse, keeps its own order. */}
      <Text variant="preview" tone={quiet ? 'muted' : 'secondary'} truncate as="span" dir="auto" id={previewId} data-sensitive="" data-row-part="preview" sx={styles.preview}>
        {row.preview.text.length === 0 ? (
          row.preview.sender
        ) : previewNamesSender(row) ? (
          <>
            <bdi>{row.preview.sender}</bdi>: {row.preview.text}
          </>
        ) : (
          row.preview.text
        )}
      </Text>
      {hasTrail ? (
        <span {...stylex.props(styles.trail)}>
          {hasPeople ? (
            <span {...stylex.props(styles.people)} data-row-part="people">
              <AvatarStack people={people} more={row.moreParticipants ?? 0} surface={selected ? 'surface' : 'subtle'} />
            </span>
          ) : null}
          {row.mentionsMe || unread ? (
            <span {...stylex.props(styles.badges)} data-row-part="counts">
              {row.mentionsMe ? (
                <Chip variant="soft" title="Mentions you">
                  @
                </Chip>
              ) : null}
              {unread ? (
                <Chip variant="count" numeric title={unreadLabel}>
                  {countLabel(row.unreadCount, row.unreadExact)}
                </Chip>
              ) : null}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  )

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onPrefetch?.(row.id)
  }
  const onPointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerMoved(event)) onPrefetch?.(row.id)
  }

  return (
    <div
      role="listitem"
      tabIndex={tabbable ? 0 : -1}
      aria-current={selected || undefined}
      aria-labelledby={titleId}
      aria-describedby={state === undefined ? previewId : `${stateId} ${previewId}`}
      data-topic-row=""
      data-topic-id={row.id}
      data-title-source={row.titleSource}
      onPointerEnter={onPrefetch === undefined ? undefined : onPointerEnter}
      onFocus={onFocus}
      onContextMenu={onContextMenu === undefined ? undefined : (event) => onContextMenu(row.id, event)}
      {...activateHandlers<HTMLDivElement>((event) => onOpen(row.id, event), { disabled: renaming })}
      data-row-lines={twoLine ? 2 : 3}
      {...stylex.props(styles.row, twoLine && styles.twoLineRow, selected && styles.selected)}
    >
      <span {...stylex.props(styles.tile, quiet && styles.quietTile)}>
        <Tile row={row} />
      </span>
      <span {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.line1)}>
          {row.resolved ? (
            <span {...stylex.props(styles.resolvedCheck)} title="Resolved">
              <Icon icon={CheckCircle} size={14} label="Resolved" />
            </span>
          ) : null}
          {renaming ? (
            <RenameField title={row.title} size="row" onSave={(title) => onRename?.(row.id, title)} onCancel={() => onRenameCancel?.(row.id)} />
          ) : (
            <Text
              variant="rowTitle"
              tone={quiet ? 'subtle' : 'default'}
              weight={unread ? 'semibold' : 'medium'}
              truncate
              dir="auto"
              id={titleId}
              data-row-part="title"
              tooltipWhenTruncated
              sx={styles.title}
            >
              {row.title}
            </Text>
          )}
          {twoLine && (reopened || threads > 0) ? <span {...stylex.props(styles.titleTags)}>{tags}</span> : null}
          {row.tags.includes('unsubscribed') ? (
            <span {...stylex.props(styles.mutedIcon)}>
              <Icon icon={BellSlash} size={13} label="Unsubscribed" />
            </span>
          ) : null}
          <Text variant="meta" tone="muted" numeric data-row-part="time" sx={styles.time}>
            {time}
          </Text>
        </span>
        {twoLine ? (
          <span {...stylex.props(styles.line2Last)}>
            {line2}
            {resolve}
          </span>
        ) : (
          line2
        )}
        {twoLine ? null : (
          <span {...stylex.props(styles.line3)}>
            <span {...stylex.props(styles.where, resolvable && styles.whereUnderAction)}>
              <span {...stylex.props(styles.place)}>
                <span {...stylex.props(styles.glyph)} title={row.channel.kind === 'private' ? PRIVATE_TITLE : undefined}>
                  <Icon icon={whereIcon(row)} size={13} {...(row.channel.kind === 'private' ? { label: PRIVATE_TITLE } : {})} />
                </span>
                <Text variant="meta" tone="muted" truncate dir="auto" tooltipWhenTruncated data-row-part="place">
                  {row.channel.name}
                </Text>
              </span>
              {tags}
            </span>
            {resolve}
          </span>
        )}
      </span>
      {/* The counts and the @ are tags whose meaning is only in a tooltip; the
          row's description says it in words, before the preview. Hidden, so
          it takes no space. */}
      {state === undefined ? null : (
        <span id={stateId} hidden>
          {state}
        </span>
      )}
    </div>
  )
})

/**
 * The tile (SPEC section 5, "Row anatomy"): a DM's Main is the person, so it
 * keeps the photo, and a group DM's Main two members' photos in a pair
 * (two initials until the members are known); every other topic, a
 * channel's Main and threads inside DMs included, shows its art, or the
 * Tide placeholder until the art exists or while AI assist is off. The art
 * is 40px in a 44px slot, so its text column lines up with a photo row's.
 */
function Tile({ row }: { readonly row: TopicRowModel }) {
  const { channel } = row
  if (row.kind === 'main' && channel.kind === 'im') {
    const partner = channel.partner
    const name = partner?.name ?? channel.name
    const hue = hueFor(partner?.color ?? channel.color, partner?.id ?? channel.id)
    return <Avatar label={initials(name)} size={44} hue={hue} {...(partner?.avatarUrl === undefined ? {} : { src: partner.avatarLargeUrl || partner.avatarUrl })} />
  }
  if (row.kind === 'main' && channel.kind === 'mpim') {
    const members = channel.members ?? []
    if (members.length >= 2) return <GroupAvatar people={members.map((member) => stackPerson(member, true))} size={44} />
    return <Avatar kind="group" label={groupInitials(channel.name)} size={44} hue={hueFor(channel.color, channel.id)} />
  }
  return (
    <span {...stylex.props(styles.artSlot)}>
      <TopicArt topicId={row.id} recipe={row.art} size={40} />
    </span>
  )
}

/**
 * Every Main has two lines (SPEC section 5, "Row anatomy"): its title is the
 * channel or the people, so the meta line would only repeat it.
 */
function isTwoLine(row: Pick<TopicRowModel, 'kind'>): boolean {
  return row.kind === 'main'
}

/**
 * Whether the preview starts with "Sender:". Not in a one-to-one DM when the
 * other person wrote it: the row already names them. "You:" stays.
 */
function previewNamesSender(row: TopicRowModel): boolean {
  return row.channel.kind !== 'im' || row.preview.sender === 'You'
}

/** A person as the stack (18px, the 48px photo) or the group tile (28px, the 72px photo) draws them. */
function stackPerson(person: Person, large = false): AvatarStackPerson {
  return {
    id: person.id,
    initials: initials(person.name),
    name: person.name,
    hue: hueFor(person.color, person.id),
    ...(person.avatarUrl === undefined ? {} : { src: (large ? undefined : person.avatarSmallUrl) || person.avatarUrl }),
  }
}

/** What the tags and icons say, for the row's description: "2 unread, mentions you." */
function rowState(row: TopicRowModel, unreadLabel: string, threadsLabel: string | undefined): string | undefined {
  const parts = [
    row.unreadCount > 0 ? unreadLabel : undefined,
    row.mentionsMe ? 'mentions you' : undefined,
    threadsLabel,
    row.resolved ? 'resolved' : undefined,
    row.status === 'unsubscribed' ? 'unsubscribed' : undefined,
  ].filter((part) => part !== undefined)
  return parts.length === 0 ? undefined : `${parts.join(', ')}.`
}

/**
 * Line three's leading glyph says what kind of place it is, nothing more: #
 * for a public channel, a lock for a private one, a person for a DM and two
 * for a group DM. A channel's own icon is for its art, not this line.
 */
function whereIcon(row: TopicRowModel): PhosphorIcon {
  switch (row.channel.kind) {
    case 'im':
      return User
    case 'mpim':
      return Users
    case 'private':
      return Lock
    default:
      return Hash
  }
}

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-3'],
    minWidth: 0,
    paddingBlock: density['--density-row-padding-block'],
    paddingInline: spacing['--space-3'],
    // One fixed height per density: the preview is one line, so every row is the same whole number of pixels.
    height: `calc(${density['--density-row-estimate']} + 2 * ${density['--density-row-padding-block']})`,
    borderRadius: radii['--radius-3xl'],
    color: colors['--foreground-default'],
    userSelect: 'none',
    // Rows are independent layout and paint units, and off-screen rows are
    // skipped entirely; the estimate keeps the scrollbar steady
    // (docs/performance.md 3.2).
    contain: 'content',
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${density['--density-row-estimate']}`,
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
    // or keyboard focus is on the row or the check itself (a mouse press
    // leaves focus on the row too, and must not show it). Only opacity
    // changes, so nothing moves.
    '--row-action-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':focus-visible': '1',
      ':has(:focus-visible)': '1',
    },
    // While Resolve shows over the end of the last line, what reaches it
    // (the place, or a two-line row's preview and counts) fades out under it
    // instead of running beneath the button.
    '--row-place-mask': {
      default: 'none',
      ':hover': { default: null, [HOVER]: PLACE_MASK },
      ':focus-visible': PLACE_MASK,
      ':has(:focus-visible)': PLACE_MASK,
    },
  },
  // A Main: two lines, so a shorter fixed height and
  // estimate. Known from the row's kind, never measured.
  twoLineRow: {
    height: `calc(${density['--density-row-two-line-estimate']} + 2 * ${density['--density-row-padding-block']})`,
    containIntrinsicSize: `auto ${density['--density-row-two-line-estimate']}`,
  },
  // Light muted text fails contrast on the secondary fill (tokens.md 1.7);
  // the selected row points it at the value made for a fill, which keeps it
  // a step below the preview in both themes.
  selected: {
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
    },
    '--foreground-muted': colors['--foreground-muted-on-fill'],
  },
  tile: {
    display: 'inline-flex',
    flexShrink: 0,
    zoom: density['--density-row-tile-zoom'],
  },
  artSlot: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--tile-44'],
    height: sizes['--tile-44'],
  },
  // The tile is decorative (the title and line three name the place), so it
  // alone may fade.
  quietTile: {
    opacity: opacity['--opacity-dim'],
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
  // A two-line row's Reopened tag and thread count, after the title.
  titleTags: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexShrink: 0,
  },
  mutedIcon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  // At least the stable slot, and the time ends at the row's trailing inset,
  // so "4m" and "Yesterday" end on one edge.
  time: {
    minWidth: sizes['--topic-time-width'],
    textAlign: 'end',
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
  // The last line of a two-line row, which Resolve overlays.
  line2Last: {
    position: 'relative',
  },
  preview: {
    flexGrow: 1,
    minWidth: 0,
  },
  // The stack, then the @ and the count, at the preview line's end. They
  // never shrink: the preview gives way.
  trail: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexShrink: 0,
    paddingTop: spacing['--space-pixel'],
  },
  people: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  // On a two-line row Resolve overlays the preview line's end, and what
  // reaches it fades out under it, as on the meta line.
  underMask: {
    maskImage: 'var(--row-place-mask)',
  },
  badges: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
  },
  // The place and its tags in one run, so the tags never float. Resolve overlays the end of the line in the same
  // cell, so it takes no space when hidden.
  line3: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    alignItems: 'center',
    minWidth: 0,
    marginTop: density['--density-row-line-gap'],
    color: colors['--foreground-muted'],
  },
  where: {
    gridRow: 1,
    gridColumn: 1,
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  glyph: {
    display: 'inline-flex',
    flexShrink: 0,
  },
  // The glyph and the name; the name gives way first, the tags keep their size.
  place: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 1,
    minWidth: 0,
  },
  threads: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
  },
  // Over the end of the line, in the line's one cell, so it adds no width.
  actionSlot: {
    gridRow: 1,
    gridColumn: 1,
    justifySelf: 'end',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--control-22'],
    height: sizes['--control-22'],
    opacity: 'var(--row-action-opacity)',
  },
  // Line two is shorter than the button, so it is centred on the line
  // without making it taller.
  actionSlotLine2: {
    position: 'absolute',
    insetInlineEnd: 0,
    insetBlock: 0,
    marginBlock: 'auto',
  },
  whereUnderAction: {
    maskImage: 'var(--row-place-mask)',
  },
})
