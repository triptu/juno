/**
 * One row of the Search list (SPEC 10a, "Cards"), as `searchRows` lays them
 * out. A match is a card: the place line (the place's pill and, for a
 * thread, its title) unless the card before is from the same topic, then the
 * message as the topic draws it: the sender's photo and name, "App" for an
 * app, the date and time, the whole body, its files as chips, its reactions
 * (read-only), and on a thread's first message who replied and when. A long
 * message folds at `--search-fold` with its first match in view, and "Show
 * more" unfolds it in place. A topic whose title matched is a one-line card;
 * "Older matches on this Mac" is a quiet line.
 */
import * as stylex from '@stylexjs/stylex'
import { memo, type ComponentType, type PointerEvent } from 'react'
import type { SearchCard, SearchGroup } from '@juno/contract'
import { accent, colors, layout, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { type ActivateEvent, Avatar, AvatarStack, commandKey, contextClick, ContextPill, type ContextTint, hueForId, systemWords, Text } from '@juno/ui'
import { hueFor, initials, kindIcon, stackPerson } from '../look'
import type { LinkInfo } from '../MessageLink'
import { Reactions } from '../Reactions'
import { messageHeaderTime, messageTime, fullTime } from '../time'
import { FileChip, FoldedBody, Marked } from './CardParts'
import { tsMillis } from './model'
import type { SearchRowItem } from './rows'

export const searchRowDomId = (id: string) => `search-row-${id}`

/** A result's time: the date and time a message header shows ("Oct 22, 20:41"), or the day alone ("Yesterday") for a reply line. */
export type SearchTimeLeaf = ComponentType<{ readonly at: number; readonly short?: boolean }>

export interface SearchRowProps {
  readonly row: SearchRowItem
  readonly now?: number
  readonly time?: SearchTimeLeaf
  readonly selected: boolean
  /** The list or the field has focus: the selected card takes the accent edge. */
  readonly focused: boolean
  readonly tabbable: boolean
  /** The query's words, marked in the message; the fold keeps the first in view. */
  readonly words: ReadonlyArray<string>
  readonly onSelect: (id: string, how: 'pointer' | 'keyboard') => void
  /** A press on a card: select it and show its topic beside the list. */
  readonly onPress: (id: string) => void
  readonly onOpen: (id: string, options: { readonly newTab: boolean }) => void
  readonly onLink?: ((url: string, event: ActivateEvent) => void) | undefined
  readonly linkInfo?: LinkInfo | undefined
  /** A #channel chip in a card: open the channel, `behind` with ⌘. */
  readonly onChannel?: ((id: string, behind: boolean) => void) | undefined
}

const tints: Record<SearchGroup['place']['kind'], ContextTint> = { public: 'public', private: 'private', im: 'dm', mpim: 'dm' }

/** A press on these inside a card is theirs: a link, a mention, Show more. */
const OWN_PRESS = 'a, button, [role="button"], [data-opens-person]'

/** Rows keep their object while the snapshot leaves them alone, so a page draws only its own rows. */
export const SearchRow = memo(function SearchRow(props: SearchRowProps) {
  const { row } = props
  if (row.kind === 'older') return <OlderLine />
  return <Stop {...props} row={row} />
})

function Stop({ row, now, time, selected, focused, tabbable, words, onSelect, onPress, onOpen, onLink, linkInfo, onChannel }: SearchRowProps & { readonly row: Exclude<SearchRowItem, { readonly kind: 'older' }> }) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || contextClick(event)) return
    if (event.target instanceof Element && event.target.closest(OWN_PRESS) !== null) return
    if (commandKey(event)) {
      // The tab opens behind this one; focus and the selection stay where they are.
      event.preventDefault()
      return onOpen(row.id, { newTab: true })
    }
    onPress(row.id)
  }
  // Focus selects the row, so Tab into the list gets the selection the arrows give.
  const onFocus = () => {
    if (!selected) onSelect(row.id, 'keyboard')
  }
  const placeLine = row.kind === 'card' && !row.run ? <PlaceLine group={row.group} /> : null
  return (
    <div
      id={searchRowDomId(row.id)}
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      data-search-row={row.id}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      {...stylex.props(styles.entry, row.kind === 'card' && row.run && styles.entryRun)}
    >
      {placeLine}
      <div data-search-card={row.kind === 'card' ? '' : undefined} {...stylex.props(styles.card, selected && styles.selected, selected && focused && styles.selectedFocused)}>
        {row.kind === 'card' && row.hit.card !== undefined ? (
          <CardContent card={row.hit.card} at={tsMillis(row.hit.ts)} now={now} time={time} words={words} onLink={onLink} linkInfo={linkInfo} onChannel={onChannel} />
        ) : row.kind === 'card' ? (
          <PlainContent sender={row.hit.sender} text={row.hit.text} at={tsMillis(row.hit.ts)} now={now} time={time} />
        ) : (
          <TitleContent group={row.group} now={now} time={time} />
        )}
      </div>
    </div>
  )
}

/** Where the card's message lives: the place's pill, and a thread's title. */
function PlaceLine({ group }: { readonly group: SearchGroup }) {
  return (
    <div data-search-place="" {...stylex.props(styles.place)}>
      <span data-sensitive="" {...stylex.props(styles.pill)}>
        <ContextPill tint={tints[group.place.kind]} icon={kindIcon(group.place.kind)} name={group.place.name} size={22} />
      </span>
      {group.kind === 'thread' ? (
        <span data-sensitive="" {...stylex.props(styles.placeTitle)}>
          <Marked text={group.title} ranges={group.titleRanges} />
        </span>
      ) : null}
    </div>
  )
}

function CardContent({ card, at, now = 0, time: TimeLeaf, words, onLink, linkInfo, onChannel }: { readonly card: SearchCard; readonly at: number; readonly now?: number | undefined; readonly time?: SearchTimeLeaf | undefined; readonly words: ReadonlyArray<string>; readonly onLink?: SearchRowProps['onLink']; readonly linkInfo?: LinkInfo | undefined; readonly onChannel?: SearchRowProps['onChannel'] }) {
  const { sender } = card
  return (
    <>
      <span {...stylex.props(styles.gutter)}>
        <Avatar label={initials(sender.name)} name={sender.name} size={28} hue={hueFor(sender.color, sender.id)} {...(sender.avatarUrl === undefined ? {} : { src: sender.avatarSmallUrl ?? sender.avatarUrl })} />
      </span>
      <span {...stylex.props(styles.content)}>
        <span {...stylex.props(styles.header)}>
          <Text variant="messageName" tone="default" truncate as="span" data-sensitive="" sx={styles.name}>
            {sender.name}
          </Text>
          {card.app ? <span {...stylex.props(styles.app)}>App</span> : null}
          <Text variant="meta" tone="muted" numeric as="time" title={fullTime(at)} sx={styles.time}>
            {TimeLeaf === undefined ? messageHeaderTime(at, now) : <TimeLeaf at={at} />}
          </Text>
        </span>
        <FoldedBody body={card.body} now={now} words={words} onLink={onLink} linkInfo={linkInfo} onChannel={onChannel} />
        {card.files.length === 0 ? null : (
          <span {...stylex.props(styles.files)}>
            {card.files.map((file) => (
              <FileChip key={file.id} file={file} />
            ))}
          </span>
        )}
        {card.reactions.length === 0 ? null : (
          <span {...stylex.props(styles.reactions)}>
            <Reactions reactions={card.reactions} />
          </span>
        )}
        {card.thread === undefined ? null : (
          <span data-search-thread="" {...stylex.props(styles.thread)}>
            {card.thread.repliers.length === 0 ? null : <AvatarStack people={card.thread.repliers.map((person) => stackPerson(person))} max={3} size={16} surface="background" />}
            <span {...stylex.props(styles.replies)}>{card.thread.replyCount === 1 ? '1 reply' : `${card.thread.replyCount} replies`}</span>
            {card.thread.lastReplyAt === undefined ? null : (
              <span {...stylex.props(styles.lastReply)}>
                {'· last reply '}
                {TimeLeaf === undefined ? messageTime(card.thread.lastReplyAt, now) : <TimeLeaf at={card.thread.lastReplyAt} short />}
              </span>
            )}
          </span>
        )}
      </span>
    </>
  )
}

/** A result from before cards: its sender and one line. */
function PlainContent({ sender, text: line, at, now = 0, time: TimeLeaf }: { readonly sender: string; readonly text: string; readonly at: number; readonly now?: number | undefined; readonly time?: SearchTimeLeaf | undefined }) {
  return (
    <>
      <span {...stylex.props(styles.gutter)}>
        <Avatar label={initials(sender)} name={sender} size={28} hue={hueForId(sender)} />
      </span>
      <span {...stylex.props(styles.content)}>
        <span {...stylex.props(styles.header)}>
          <Text variant="messageName" tone="default" truncate as="span" data-sensitive="" sx={styles.name}>
            {sender}
          </Text>
          <Text variant="meta" tone="muted" numeric as="time" sx={styles.time}>
            {TimeLeaf === undefined ? messageHeaderTime(at, now) : <TimeLeaf at={at} />}
          </Text>
        </span>
        <span data-msg-text="" data-sensitive="" {...stylex.props(styles.plain)}>
          {line}
        </span>
      </span>
    </>
  )
}

/** A topic whose title matched: its place, its title with the words marked, its latest activity. */
function TitleContent({ group, now = 0, time: TimeLeaf }: { readonly group: SearchGroup; readonly now?: number | undefined; readonly time?: SearchTimeLeaf | undefined }) {
  const at = tsMillis(group.at)
  return (
    <span {...stylex.props(styles.titleLine)}>
      <span data-sensitive="" {...stylex.props(styles.pill)}>
        <ContextPill tint={tints[group.place.kind]} icon={kindIcon(group.place.kind)} name={group.place.name} size={22} />
      </span>
      <span data-sensitive="" {...stylex.props(styles.title)}>
        <Marked text={group.title} ranges={group.titleRanges} />
      </span>
      <Text variant="meta" tone="muted" numeric as="time" title={fullTime(at)} sx={styles.titleTime}>
        {TimeLeaf === undefined ? messageHeaderTime(at, now) : <TimeLeaf at={at} />}
      </Text>
    </span>
  )
}

function OlderLine() {
  return (
    <div role="option" aria-disabled="true" aria-selected={false} data-search-older="" {...stylex.props(styles.older)}>
      <span>Older matches on {systemWords.thisComputer}</span>
      <span {...stylex.props(styles.olderRule)} />
    </div>
  )
}

const styles = stylex.create({
  // One result: in flow, laid out only near the view.
  entry: {
    outlineStyle: 'none',
    contain: 'content',
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${layout['--search-card-estimate']}`,
    cursor: 'default',
    userSelect: 'none',
    paddingTop: spacing['--space-3'],
  },
  // A card from the same topic as the one before sits closer under it, below the same place line.
  entryRun: {
    paddingTop: spacing['--space-1-5'],
  },
  place: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
    height: sizes['--control-24'],
    marginBottom: spacing['--space-1-5'],
    paddingInline: spacing['--space-1'],
  },
  // The pill gives way to the title down to its icon and an ellipsis, as in a page header.
  pill: {
    display: 'flex',
    flexShrink: 0,
    maxWidth: layout['--header-pill-max-width'],
  },
  placeTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: text['--text-ui-size'],
    fontWeight: weights['--weight-medium'],
    color: colors['--foreground-subtle'],
  },
  // A quiet card: a hairline and space, no fill, so a page of them stays calm.
  card: {
    display: 'flex',
    gap: spacing['--space-2-5'],
    paddingBlock: spacing['--space-3'],
    paddingInline: spacing['--space-3-5'],
    borderWidth: spacing['--space-pixel'],
    borderStyle: 'solid',
    borderColor: colors['--border-default'],
    borderRadius: radii['--radius-xl'],
  },
  // On the fill, the muted time takes its 4.5:1 colour (review.md, finding 3).
  selected: {
    backgroundColor: accent['--hl-select'],
    '--foreground-muted': colors['--foreground-muted-on-fill'],
  },
  // While the list or the field has focus, the selection also takes the accent's edge.
  selectedFocused: {
    borderColor: accent['--hl-rule'],
  },
  gutter: {
    flexShrink: 0,
    paddingTop: spacing['--space-0-5'],
  },
  content: {
    flexGrow: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  name: {
    minWidth: 0,
  },
  app: {
    flexShrink: 0,
    alignSelf: 'center',
    paddingInline: spacing['--space-1'],
    borderRadius: radii['--radius-xs'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-muted-on-fill'],
    fontSize: text['--text-tag-size'],
    fontWeight: weights['--weight-semibold'],
    lineHeight: sizes['--control-18'],
  },
  time: {
    flexShrink: 0,
    marginInlineStart: spacing['--space-0-5'],
  },






  plain: {
    marginTop: spacing['--space-0-5'],
    fontSize: text['--text-body-size'],
    lineHeight: text['--text-body-leading'],
  },
  files: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-1-5'],
    marginTop: spacing['--space-2'],
  },




  reactions: {
    display: 'flex',
    marginTop: spacing['--space-2'],
  },
  thread: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    height: sizes['--control-24'],
    marginTop: spacing['--space-1-5'],
    fontSize: text['--text-meta-size'],
  },
  replies: {
    fontWeight: weights['--weight-semibold'],
    color: colors['--foreground-subtle'],
  },
  lastReply: {
    color: colors['--foreground-muted'],
  },
  titleLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexGrow: 1,
    minWidth: 0,
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: text['--text-row-title-size'],
    fontWeight: weights['--weight-medium'],
    color: colors['--foreground-default'],
  },
  titleTime: {
    flexShrink: 0,
    marginInlineStart: 'auto',
    paddingInlineStart: spacing['--space-2'],
  },
  // A title's matched words: the search mark, as CSS highlights draw it in message text.

  older: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    height: sizes['--control-32'],
    marginTop: spacing['--space-3'],
    paddingInline: spacing['--space-1'],
    whiteSpace: 'nowrap',
    fontSize: text['--text-tag-small-size'],
    fontWeight: weights['--weight-medium'],
    color: colors['--foreground-muted'],
  },
  olderRule: {
    flexGrow: 1,
    height: spacing['--space-pixel'],
    backgroundColor: colors['--border-subtle'],
  },
})
