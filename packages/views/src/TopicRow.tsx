import * as stylex from '@stylexjs/stylex'
import { BellSlash } from '@phosphor-icons/react/dist/icons/BellSlash'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { memo, useId, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import type { TopicRow as TopicRowModel } from '@juno/contract'
import { colors, density, opacity, radii, sizes, spacing, text, tints, weights } from '@juno/tokens/tokens.stylex'
import {
  activateHandlers,
  Avatar,
  AvatarStack,
  Chip,
  focusRing,
  GroupAvatar,
  Icon,
  pointerMoved,
  PresenceDot,
  Text,
  TopicArt,
  type ActivateEvent,
  type AvatarStackPerson,
} from '@juno/ui'
import { inField } from './fieldMenu'
import { countLabel, groupInitials, hueFor, initials, kindIcon, stackPerson } from './look'
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
  /** Pointer enter or keyboard focus: warm the topic's query. Not when the row scrolls under a still pointer. */
  readonly onPrefetch?: (id: string) => void
  readonly onContextMenu?: (id: string, event: MouseEvent<HTMLDivElement>) => void
  /** The title is a field for Rename: the row does not open until it ends. */
  readonly renaming?: boolean
  /** Rename saved (Enter or leaving the field) with the text as typed. */
  readonly onRename?: (id: string, title: string) => void
  /** Rename cancelled (Esc). */
  readonly onRenameCancel?: (id: string) => void
  /** Main rows only: threads started in the channel since its Main was last read. Hidden at 0. */
  readonly newThreads?: number
  /**
   * Main rows only: a feature's mark after the title, beside the thread
   * count, such as the huddle glyph. It takes only its own width. Pass a
   * node whose identity holds while it does not change, so the row stays
   * memoized.
   */
  readonly accessory?: ReactNode
  /** What `accessory` says, added to the row's description ("huddle with 3 people"). */
  readonly accessoryLabel?: string
  /** A DM's Main only: Slack shows the person as active, drawn as the presence dot on their photo. */
  readonly partnerActive?: boolean
}

const HOVER = '@media (hover: hover)'

const REOPENED_TITLE = 'New activity after it was resolved'
const PRIVATE_TITLE = 'Private channel'

/**
 * One sidebar row, chat style: the topic's art or the person's photo, then
 * the title and time, a one-line "Sender: text" preview ending with the
 * people who wrote the unread messages beside the @ and count tags, and the
 * meta line: the place with its Reopened tag. On a read row the title is
 * regular and everything under it is muted, so the list stays calm; an unread
 * row's title is semibold and its preview steps up between the two. A Main (a channel's, a DM's or a group DM's) has no meta line and no
 * Main tag: Main is the default and its title already names the place, so
 * the row is two lines and shorter, and its `accessory`, a Reopened tag or
 * the new-thread count follows the title. The row activates on mouse down.
 * Resolve is in its menu (right-click), the topic header and ⌘K.
 *
 * The time shows only while the row is hovered or has keyboard focus. It
 * floats over the end of line one, on a fade of the row's fill, so the
 * title has the whole line at rest and nothing moves when it appears.
 *
 * The row is a focusable list item, named by its title. Enter and Space
 * open it, as on a button.
 */
export const TopicRow = memo(function TopicRow({
  row,
  time,
  selected = false,
  tabbable = true,
  onOpen,
  onPrefetch,
  onContextMenu,
  renaming = false,
  onRename,
  onRenameCancel,
  newThreads = 0,
  accessory,
  accessoryLabel,
  partnerActive = false,
}: TopicRowProps) {
  const titleId = useId()
  const previewId = useId()
  const stateId = useId()
  const unread = row.unreadCount > 0
  // Resolved and unsubscribed rows read quieter: the check or the muted bell
  // says why, the title steps down to the subtle colour, the preview stays
  // muted even when unread and the tile fades. The text keeps at least 4.5:1,
  // so the row itself is never faded.
  const quiet = row.resolved || row.status === 'unsubscribed'
  const main = row.tags.includes('main')
  const twoLine = isTwoLine(row)
  const reopened = row.tags.includes('reopened')
  const threads = main && newThreads > 0 ? newThreads : 0
  const threadsLabel = threads === 1 ? '1 new thread' : `${threads} new threads`
  const unreadLabel = row.unreadExact ? `${row.unreadCount} unread` : `${row.unreadCount} or more unread`
  const mark = main && accessory !== undefined && accessory !== null
  const active = partnerActive && main && row.channel.kind === 'im'
  const state = rowState(row, unreadLabel, threads > 0 ? threadsLabel : undefined, main ? accessoryLabel : undefined, active)
  const people: ReadonlyArray<AvatarStackPerson> = row.participants.map((person) => stackPerson(person))
  const hasPeople = people.length > 0
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
  const hasTrail = hasPeople || row.mentionsMe || unread
  // The preview, then who wrote the unread messages beside the @ and the
  // count, all at the line's end. Nothing is kept for any of them when
  // absent: the preview takes the space.
  const line2 = (
    <span {...stylex.props(styles.line2, !unread && styles.readLine2)}>
      {/* The message sets the direction; the sender is isolated so a Latin
          name before Arabic text, or the reverse, keeps its own order. */}
      <Text variant="preview" tone={unread && !quiet ? 'secondary' : 'muted'} truncate as="span" dir="auto" id={previewId} data-sensitive="" data-row-part="preview" sx={styles.preview}>
        {row.preview.text.length === 0 || row.preview.sender.length === 0 ? (
          row.preview.text || row.preview.sender
        ) : (
          <>
            <bdi>{row.preview.sender}</bdi>: {row.preview.text}
          </>
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
      onContextMenu={
        onContextMenu === undefined
          ? undefined
          : (event) => {
              if (inField(event)) return
              event.preventDefault()
              onContextMenu(row.id, event)
            }
      }
      {...activateHandlers<HTMLDivElement>((event) => onOpen(row.id, event), { disabled: renaming })}
      data-row-lines={twoLine ? 2 : 3}
      {...stylex.props(styles.row, focusRing.inset, twoLine && styles.twoLineRow, selected && styles.selected)}
    >
      <span {...stylex.props(styles.tile, main && styles.mainTile, quiet && styles.quietTile)}>
        <Tile row={row} dot={active ? (selected ? 'rowSelected' : 'row') : undefined} />
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
            // As wide as the semibold title in both states, so reading the row
            // moves nothing that follows the title.
            <span {...stylex.props(styles.titleBox)} data-bold-title={row.title}>
              <Text
                variant="rowTitle"
                tone={quiet ? 'subtle' : 'default'}
                weight={unread ? 'semibold' : undefined}
                topicTitle
                dir="auto"
                id={titleId}
                data-row-part="title"
                data-sensitive={row.titleSensitive === true ? '' : undefined}
                tooltipWhenTruncated
              >
                {row.title}
              </Text>
            </span>
          )}
          {twoLine && (mark || reopened || threads > 0) ? (
            <span {...stylex.props(styles.titleTags)}>
              {mark ? accessory : null}
              {tags}
            </span>
          ) : null}
          {row.tags.includes('unsubscribed') ? (
            <span {...stylex.props(styles.mutedIcon)}>
              <Icon icon={BellSlash} size={13} label="Unsubscribed" />
            </span>
          ) : null}
          <Text variant="meta" tone="muted" numeric data-row-part="time" sx={[styles.time, renaming && styles.timeRenaming]}>
            {time}
          </Text>
        </span>
        {line2}
        {twoLine ? null : (
          <span {...stylex.props(styles.line3)}>
            <span {...stylex.props(styles.where)}>
              <span {...stylex.props(styles.place)}>
                <span {...stylex.props(styles.glyph)} title={row.channel.kind === 'private' ? PRIVATE_TITLE : undefined}>
                  <Icon icon={kindIcon(row.channel.kind)} size={13} {...(row.channel.kind === 'private' ? { label: PRIVATE_TITLE } : {})} />
                </span>
                <Text variant="meta" tone="muted" truncate dir="auto" tooltipWhenTruncated data-row-part="place">
                  {row.channel.name}
                </Text>
              </span>
              {tags}
            </span>
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
function Tile({ row, dot }: { readonly row: TopicRowModel; readonly dot: 'row' | 'rowSelected' | undefined }) {
  const { channel } = row
  if (row.kind === 'main' && channel.kind === 'im') {
    const partner = channel.partner
    const name = partner?.name ?? channel.name
    const hue = hueFor(partner?.color ?? channel.color, partner?.id ?? channel.id)
    const photo = <Avatar label={initials(name)} size={44} hue={hue} {...(partner?.avatarUrl === undefined ? {} : { src: partner.avatarLargeUrl || partner.avatarUrl })} />
    if (dot === undefined) return photo
    // The dot is placed against the photo's own box: the tile's box is cut to the two-line row.
    return (
      <span {...stylex.props(styles.photo)}>
        {photo}
        <PresenceDot active surface={dot} />
      </span>
    )
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

/** What the tags and icons say, for the row's description: "active, 2 unread, mentions you." */
function rowState(row: TopicRowModel, unreadLabel: string, threadsLabel: string | undefined, accessoryLabel: string | undefined, active: boolean): string | undefined {
  const parts = [
    active ? 'active' : undefined,
    row.unreadCount > 0 ? unreadLabel : undefined,
    row.mentionsMe ? 'mentions you' : undefined,
    threadsLabel,
    accessoryLabel,
    row.resolved ? 'resolved' : undefined,
    row.status === 'unsubscribed' ? 'unsubscribed' : undefined,
  ].filter((part) => part !== undefined)
  return parts.length === 0 ? undefined : `${parts.join(', ')}.`
}

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-3'],
    minWidth: 0,
    paddingBlock: density['--density-row-padding-block'],
    paddingInline: spacing['--space-3'],
    // Short titles keep the density’s height; wrapped titles add only their extra line.
    minHeight: `calc(${density['--density-row-estimate']} + 2 * ${density['--density-row-padding-block']})`,
    height: 'calc-size(auto, round(up, size, 1px))', // tokens-allow: whole-pixel rounding keeps scroll anchoring exact
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
      default: 'var(--reorder-background, transparent)',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
    // A read row's preview: its own colour at rest, muted on hover, where the
    // lower colour would fall under 4.5:1. The selected row sets it again.
    '--row-read-preview': {
      default: colors['--foreground-preview-read'],
      ':hover': { default: null, [HOVER]: colors['--foreground-muted'] },
    },
    // The time is shown under the pointer and with keyboard focus, at once,
    // and always where nothing can hover.
    '--row-time-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':focus-visible': '1',
      '@media (hover: none)': '1',
    },
    // What the row is drawn on, for the time's fade: the sidebar, or the hover fill.
    '--row-fill': {
      default: colors['--background-subtle'],
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
  },
  // A Main has no meta line, so its minimum and off-screen estimate are shorter.
  twoLineRow: {
    minHeight: `calc(${density['--density-row-two-line-estimate']} + 2 * ${density['--density-row-padding-block']})`,
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
    '--row-read-preview': colors['--foreground-muted-on-fill'],
    '--row-fill': colors['--secondary-default'],
  },
  tile: {
    display: 'inline-flex',
    flexShrink: 0,
    zoom: density['--density-row-tile-zoom'],
  },
  // The 44px artwork may extend beyond Main’s 42px content box, as before.
  mainTile: { maxHeight: density['--density-row-two-line-estimate'] },
  // Positioned, so a DM's presence dot sits on the photo's corner. As tall as the photo, not the cut tile.
  photo: {
    position: 'relative',
    display: 'inline-flex',
    alignSelf: 'flex-start',
    flexShrink: 0,
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
  // The time, icons and tags beside the title each centre in a box one title
  // line tall, so a wrapped title keeps them on its first line, as Mail does.
  line1: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minHeight: sizes['--control-22'],
    minWidth: 0,
  },
  resolvedCheck: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    alignItems: 'center',
    height: text['--text-row-title-leading'],
    flexShrink: 0,
    color: tints['--tint-resolved-fg'],
  },
  // The title and, under it, an invisible semibold copy with no height (a
  // pseudo-element, so it is not text in the page). The box is the wider of
  // the two, so the title's box keeps its width when the row is read and the
  // weight drops; the letters inside still narrow slightly.
  titleBox: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 0,
    '::after': {
      content: 'attr(data-bold-title)',
      height: 0,
      overflow: 'hidden',
      visibility: 'hidden',
      whiteSpace: 'nowrap',
      fontFamily: text['--text-row-title-family'],
      fontSize: text['--text-row-title-size'],
      fontWeight: weights['--weight-semibold'],
      letterSpacing: text['--text-row-title-tracking'],
    },
  },
  // A two-line row's accessory, Reopened tag and thread count, after the title.
  titleTags: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    alignItems: 'center',
    height: text['--text-row-title-leading'],
    gap: spacing['--space-2'],
    flexShrink: 0,
  },
  mutedIcon: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    alignItems: 'center',
    height: text['--text-row-title-leading'],
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  // Over the end of line one, ending at the row's trailing inset, so "4m"
  // and "Yesterday" end on one edge. It takes no room in the line: what is
  // under it fades into the row's fill. The pointer passes through, so a
  // cut-off title still shows its tooltip.
  time: {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineEnd: 0,
    display: 'inline-flex',
    alignItems: 'center',
    height: text['--text-row-title-leading'],
    // A fade, then a little clear fill, so no faded letter touches the time.
    paddingInlineStart: spacing['--space-8'],
    backgroundImage: `linear-gradient(to right, transparent, var(--row-fill) ${spacing['--space-6']})`,
    opacity: 'var(--row-time-opacity)',
    pointerEvents: 'none',
  },
  // The rename field has the whole line.
  timeRenaming: {
    opacity: 0,
  },
  // The preview has one size, read or unread, so reading the row changes only
  // its colour and no letter moves.
  line2: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
    minWidth: 0,
    '--text-preview-size': text['--text-row-preview-size'],
    '--text-preview-leading': text['--text-row-preview-leading'],
  },
  // A read row's preview takes its own colour; the trail's chips set their own colours.
  readLine2: {
    '--foreground-muted': 'var(--row-read-preview)',
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
  badges: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
  },
  // The place and its tags in one run, so the tags never float. One 22px
  // line on every row, so rows keep the height they have always had.
  line3: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    alignItems: 'center',
    minWidth: 0,
    minHeight: sizes['--control-22'],
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
})
