import * as stylex from '@stylexjs/stylex'
import { useRef, type ReactNode, type Ref } from 'react'
import { chatCopy, type Banner, type ChatItem } from '@juno/agent-contract'
import { chat, layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { ScrollArea, Text, useNarrowerThan } from '@juno/ui'
import { AskRow } from './AskCard'
import { CardRow } from './CardRow'
import type { ChatActions } from './commands'
import { DaySeparator } from './DaySeparator'
import { EmptyChat } from './EmptyChat'
import { EndingLine } from './EndingLine'
import { GroupLabel } from './GroupLabel'
import { JunoBubble } from './JunoBubble'
import { Note } from './Note'
import { OwnerBubble } from './OwnerBubble'
import { StatusBubble } from './StatusBubble'
import { NewDivider } from '../NewDivider'

export interface JunoChatListProps {
  readonly items: ReadonlyArray<ChatItem>
  readonly banner: Banner
  /** Items exist outside the window; the container fills the edge slots as the owner scrolls near them. */
  readonly moreAbove: boolean
  readonly moreBelow: boolean
  /** Epoch milliseconds, for the times. */
  readonly now: number
  readonly actions: ChatActions
  /** A suggestion pill in the empty state was clicked. */
  readonly onSuggest: (text: string) => void
  /** The scroll element, for the container's open position and stick-to-bottom. */
  readonly scrollRef?: Ref<HTMLElement>
  /** The "New" divider, for the container to open the chat at it. */
  readonly anchorRef?: Ref<HTMLDivElement>
  /** The edge slots, for the container's IntersectionObserver that asks for more items. */
  readonly topEdgeRef?: Ref<HTMLDivElement>
  readonly bottomEdgeRef?: Ref<HTMLDivElement>
  /** Play the empty state's entrance. Pass false when it was visible less than a second ago. */
  readonly enterEmpty?: boolean
  /** `page` for the Juno tab's 720px column, `panel` for the Juno panel's narrow one. Default `page`. */
  readonly column?: 'page' | 'panel'
  /**
   * How many rows at the end are laid out in full rather than at their size estimate: a screenful, so the
   * bottom the container sets before the first paint is where the list stays when they come into view.
   */
  readonly eagerTail?: number
}

/**
 * Under this column width (the Juno tab at the minimum window is 336, the
 * Juno panel at its narrowest 360) the column takes the panel's padding and
 * bubble width, and a Juno bubble's time moves from beside it to its
 * tooltip, so the bubble keeps the room (inventory 12).
 */
const COMPACT_BELOW = 400

/**
 * The one long chat (SPEC 13.1): bubbles, cards, ending lines, the status
 * bubble under the newest bubble while a run is active, and the
 * separators, in the centred 720px column. Juno's bubbles arrive one at a
 * time, whole; each is a new row and moves nothing above it. Rows
 * stay in flow with `content-visibility: auto`, as the message list does,
 * so the browser's scroll anchoring handles prepends and nothing runs on
 * scroll; the container owns the position through `scrollRef`. The edge
 * slots above and below have a fixed height whether or not more items
 * exist, so a page arriving never moves the rows.
 */
export function JunoChatList({ items, banner, moreAbove, moreBelow, now, actions, onSuggest, scrollRef, anchorRef, topEdgeRef, bottomEdgeRef, enterEmpty = true, column = 'page', eagerTail = 0 }: JunoChatListProps) {
  // With AI assist off an empty chat is the one AI-off line (SPEC 13.7), not suggestions it cannot act on.
  const empty = items.length === 0 && banner._tag !== 'aiOff'
  const columnRef = useRef<HTMLDivElement>(null)
  const compact = useNarrowerThan(columnRef, COMPACT_BELOW)
  return (
    <ScrollArea scrollbar="hover" evenInset underHeader ref={scrollRef} data-scroll="" sx={styles.scroller}>
      <div ref={columnRef} role="list" aria-label="Juno chat" data-chat-compact={compact || undefined} {...stylex.props(styles.column, column === 'panel' && styles.panel, column === 'page' && compact && styles.compact)}>
        <div ref={topEdgeRef} data-chat-edge={moreAbove ? 'more' : 'end'} aria-hidden {...stylex.props(styles.edge)} />
        {empty ? <EmptyChat onSuggest={onSuggest} enter={enterEmpty} /> : null}
        {items.map((item, index) => (
          <Row key={keyOf(item)} item={item} now={now} actions={actions} anchorRef={anchorRef} eager={index >= items.length - eagerTail} compact={compact} />
        ))}
        {banner._tag === 'aiOff' ? (
          <div {...stylex.props(styles.aiOff)}>
            <Text variant="preview" tone="muted">
              {chatCopy.banner.aiOff.line}
            </Text>
          </div>
        ) : null}
        <div ref={bottomEdgeRef} data-chat-edge={moreBelow ? 'more' : 'end'} aria-hidden {...stylex.props(styles.edge)} />
      </div>
    </ScrollArea>
  )
}

/** The row key: the op for an owner bubble (it exists before the archive row), the id otherwise. */
function keyOf(item: ChatItem): string {
  switch (item._tag) {
    case 'owner':
      return `o:${item.opId}`
    case 'juno':
      return `j:${item.id}`
    case 'card':
      return `c:${item.card.id}`
    case 'ask':
      return `a:${item.ask.id}`
    case 'ending':
      return `e:${item.runId}`
    case 'status':
      return `s:${item.runId}`
    case 'note':
      return `n:${item.id}`
    case 'groupLabel':
      return `g:${item.id}`
    case 'day':
      return `d:${item.at}`
    case 'newDivider':
      return 'new'
  }
}

function Row({ item, now, actions, anchorRef, eager, compact }: { readonly item: ChatItem; readonly now: number; readonly actions: ChatActions; readonly anchorRef: Ref<HTMLDivElement> | undefined; readonly eager: boolean; readonly compact: boolean }): ReactNode {
  switch (item._tag) {
    case 'owner':
      return <OwnerBubble item={item} now={now} actions={actions} eager={eager} />
    case 'juno':
      return <JunoBubble item={item} now={now} actions={actions} eager={eager} compact={compact} />
    case 'card':
      return <CardRow item={item} now={now} actions={actions} />
    case 'ask':
      return <AskRow item={item} actions={actions} />
    case 'ending':
      return <EndingLine item={item} actions={actions} />
    case 'status':
      return <StatusBubble item={item} />
    case 'note':
      return <Note item={item} actions={actions} />
    case 'groupLabel':
      return <GroupLabel item={item} actions={actions} />
    case 'day':
      return <DaySeparator at={item.at} now={now} />
    case 'newDivider':
      return <NewDivider ref={anchorRef} count={item.count} />
  }
}

const styles = stylex.create({
  scroller: {
    flexGrow: 1,
    width: '100%',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: layout['--page-width'],
    minHeight: '100%',
    marginInline: 'auto',
    paddingTop: spacing['--space-10'],
    paddingInline: spacing['--space-8'],
    paddingBottom: spacing['--space-6'],
    boxSizing: 'border-box',
  },
  // The panel's column: the full width, tighter padding, wider bubbles and cards at full width.
  panel: {
    maxWidth: 'none',
    paddingTop: spacing['--space-4'],
    paddingInline: spacing['--space-4'],
    paddingBottom: spacing['--space-3'],
    '--bubble-max-width': chat['--bubble-max-width-panel'],
    '--card-max-width': '100%',
  },
  // A narrow Juno tab: the panel's sides and bubble width.
  compact: {
    paddingInline: spacing['--space-4'],
    '--bubble-max-width': chat['--bubble-max-width-panel'],
  },
  // A fixed slot at each end, so a page arriving never moves the rows.
  edge: {
    height: sizes['--control-18'],
    flexShrink: 0,
  },
  aiOff: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: spacing['--space-5'],
    textAlign: 'center',
    userSelect: 'none',
  },
})
