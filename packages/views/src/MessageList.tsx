import * as stylex from '@stylexjs/stylex'
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react'
import type { FileView, MessageView, Person } from '@juno/contract'
import { layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { EmptyState, hueForId, ScrollArea, Text, type ActivateEvent, type HueName } from '@juno/ui'
import { Message, type MessageActions, type MessageProps } from './Message'
import { NewDivider } from './NewDivider'
import { messageTime } from './time'

/** One row as the container holds it: the message and its sender from the window's refs. */
export interface MessageListItem {
  readonly message: MessageView
  readonly sender: Person | undefined
}

/**
 * What the list shows while it has no rows. `pending`: nothing yet, for the
 * first 300 ms of an open. `offline`: the topic is not cached and Slack
 * could not be reached.
 */
export type MessageListStatus = 'ready' | 'pending' | 'loading' | 'offline'

/** Whether older messages exist above the window, and whether a page is on its way. */
export type OlderStatus = 'none' | 'more' | 'loading'

export interface MessageListProps {
  readonly items: ReadonlyArray<MessageListItem>
  /** Main: thread links under messages, "Message #eng" wording. */
  readonly main: boolean
  /** Epoch milliseconds, for the times. */
  readonly now: number
  readonly status?: MessageListStatus
  /**
   * Rows laid out in full on their first frame instead of at the size
   * estimate, so a scroll position the container sets before paint holds.
   */
  readonly eager?: ReadonlySet<string>
  /**
   * Rows of the window above `items` that are not drawn yet. Their place is
   * kept at the row estimate, so the scroll height and the position do not
   * change when they arrive.
   */
  readonly notDrawnAbove?: number
  /** The `ts` of the first unread message: the "N new" divider goes before it. */
  readonly dividerBefore?: string
  readonly older?: OlderStatus
  /** The scroll element, for the container's open position and stick-to-bottom. */
  readonly scrollRef?: Ref<HTMLElement>
  /** The list runs under the topic's floating header (default). False where nothing floats over it, as in peek. */
  readonly underHeader?: boolean
  /** The divider, for the container to scroll it 80px below the header band on open. */
  readonly anchorRef?: Ref<HTMLDivElement>
  /** The person hue for @mention chips. Default: the id's hash. */
  readonly hueOf?: (id: string) => HueName
  /** The hover toolbar's actions, created once. Without them rows have no toolbar (a preview). */
  readonly actions?: MessageActions
  /** The row whose toolbar asks to confirm a delete. */
  readonly activeMessage?: string | undefined
  readonly confirmingDelete?: string | undefined
  /** The row being edited, and its inline edit field. */
  readonly suggestion?: { readonly ts: string; readonly value: MessageProps['suggestion'] } | undefined
  readonly editing?: { readonly ts: string; readonly editor: ReactNode } | undefined
  /**
   * A key on a selected row that the list does not use itself (it moves the
   * selection with ↑ and ↓): E, Delete, Backspace, Enter, Esc. The
   * container acts on the row's message.
   */
  readonly onRowKey?: (ts: string, event: KeyboardEvent<HTMLElement>) => void
  readonly onOpenThread?: (id: string, event: ActivateEvent) => void
  readonly onChannel?: (id: string) => void
  readonly onLink?: (url: string) => void
  readonly onToggleReaction?: (ts: string, name: string) => void
  /** Retry on a failed send. */
  readonly onRetry?: (clientMsgId: string) => void
  /** Delete draft on a failed send. */
  readonly onDiscard?: (clientMsgId: string) => void
  /** A thumbnail was opened. Created once, like every row callback. */
  readonly onOpenImage?: (file: FileView) => void
  /** Download on a file card. Created once. */
  readonly onDownload?: (file: FileView) => void
  /** Upload progress of the messages being sent with files, by `clientMsgId`, 0 to 1. */
  readonly uploadProgress?: Readonly<Record<string, number>>
  /** Right-click or the context-menu key on a message: its menu, at the pointer. `onSender` on the sender's name or avatar (the person menu). */
  readonly onMessageMenu?: (ts: string, event: MouseEvent, onSender: boolean) => void
  /** Right-click on an @person chip: the person menu (inventory 15.6). */
  readonly onPersonMenu?: (person: { readonly id: string; readonly name: string }, event: MouseEvent) => void
  /** Right-click on a #channel chip: the channel menu (inventory 15.2). */
  readonly onChannelMenu?: (channel: { readonly id: string; readonly name: string }, event: MouseEvent) => void
}

const ROW = '[data-message-row]'

/** Arrow keys move focus between rows; the row that takes focus becomes the tabbable one. Other keys on a row go to `onRowKey`. */
function onKeyDown(event: KeyboardEvent<HTMLDivElement>, onRowKey: MessageListProps['onRowKey']) {
  const target = event.target
  if (!(target instanceof HTMLElement) || !target.matches(ROW)) return
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    const ts = target.dataset['messageRow']
    if (ts !== undefined && !event.metaKey && !event.ctrlKey && !event.altKey) onRowKey?.(ts, event)
    return
  }
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW))
  const index = rows.indexOf(target)
  const next = rows[event.key === 'ArrowDown' ? index + 1 : index - 1]
  if (next === undefined) return
  event.preventDefault()
  next.focus()
  next.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

interface Menus {
  readonly onMessageMenu: ((ts: string, event: MouseEvent, onSender: boolean) => void) | undefined
  readonly onPersonMenu: ((person: { readonly id: string; readonly name: string }, event: MouseEvent) => void) | undefined
  readonly onChannelMenu: ((channel: { readonly id: string; readonly name: string }, event: MouseEvent) => void) | undefined
}

/**
 * One handler for every row: an @person or #channel chip under the pointer
 * gets its own menu, otherwise the row under the pointer, or the focused row
 * for the context-menu key. A field keeps its own menu.
 */
function messageMenu(event: MouseEvent, { onMessageMenu, onPersonMenu, onChannelMenu }: Menus) {
  const target = event.target
  if (!(target instanceof Element) || target.closest('input, textarea') !== null) return
  const person = onPersonMenu === undefined ? null : target.closest<HTMLElement>('[data-person]')
  if (person !== null && onPersonMenu !== undefined) {
    event.preventDefault()
    onPersonMenu({ id: person.dataset.person ?? '', name: person.dataset.personName ?? '' }, event)
    return
  }
  const channel = onChannelMenu === undefined ? null : target.closest<HTMLElement>('[data-channel]')
  if (channel !== null && onChannelMenu !== undefined) {
    event.preventDefault()
    onChannelMenu({ id: channel.dataset.channel ?? '', name: channel.dataset.channelName ?? '' }, event)
    return
  }
  if (onMessageMenu === undefined) return
  const ts = target.closest<HTMLElement>(ROW)?.dataset.messageRow
  if (ts === undefined) return
  event.preventDefault()
  onMessageMenu(ts, event, target.closest('[data-sender]') !== null)
}

/**
 * The messages of one topic, oldest first, in the centred 800px column
 * (inventory 6). Rows stay in flow with `content-visibility: auto`, so the
 * browser's scroll anchoring handles prepends and nothing runs on scroll.
 * The list owns no scroll logic: the container reads and sets the position
 * through `scrollRef` and `anchorRef`. One row is tabbable (the last, until
 * a row takes focus); arrow keys move between rows.
 */
export function MessageList({
  items,
  main,
  now,
  status = 'ready',
  eager,
  notDrawnAbove = 0,
  dividerBefore,
  older = 'none',
  scrollRef,
  underHeader = true,
  anchorRef,
  hueOf = hueForId,
  actions,
  activeMessage,
  confirmingDelete,
  editing,
  suggestion,
  onRowKey,
  onOpenThread,
  onChannel,
  onLink,
  onToggleReaction,
  onRetry,
  onDiscard,
  onOpenImage,
  onDownload,
  uploadProgress,
  onMessageMenu,
  onPersonMenu,
  onChannelMenu,
}: MessageListProps) {
  const [focusedTs, setFocusedTs] = useState<string | undefined>(undefined)
  const last = items[items.length - 1]
  const tabbable = focusedTs !== undefined && items.some((item) => item.message.ts === focusedTs) ? focusedTs : last?.message.ts
  const dividerIndex = dividerBefore === undefined ? -1 : items.findIndex((item) => item.message.ts >= dividerBefore)
  const newCount = dividerIndex < 0 ? 0 : items.length - dividerIndex

  return (
    <ScrollArea scrollbar="hover" evenInset underHeader={underHeader} ref={scrollRef} data-scroll="" sx={styles.scroller}>
      <div
        role="list"
        aria-label="Messages"
        aria-busy={status === 'loading' || status === 'pending'}
        onKeyDown={(event) => onKeyDown(event, onRowKey)}
        onContextMenu={
          onMessageMenu === undefined && onPersonMenu === undefined && onChannelMenu === undefined ? undefined : (event) => messageMenu(event, { onMessageMenu, onPersonMenu, onChannelMenu })
        }
        {...stylex.props(styles.column)}
      >
        {items.length > 0 ? (
          <div aria-live="polite" {...stylex.props(styles.olderLine)}>
            {older === 'loading' ? (
              <Text variant="meta" tone="muted">
                Loading older messages
              </Text>
            ) : null}
          </div>
        ) : null}
        {notDrawnAbove > 0 ? <div aria-hidden {...stylex.props(styles.notDrawn(notDrawnAbove))} /> : null}
        {items.length === 0 ? <Empty main={main} status={status} /> : null}
        {items.map((item, index) => {
          const atDivider = index === dividerIndex && index > 0
          // A row's header and margin never depend on its place in the window, so a page added above
          // changes no row's height. Only the topic's first message, with nothing that can arrive above it, sits flush.
          const first = item.message.root
          return (
            // A message's client_msg_id outlives its pending row, so the row becomes the stored message in place.
            <Row key={item.message.clientMsgId ?? item.message.ts} atDivider={atDivider} newCount={newCount} anchorRef={anchorRef}>
              <Message
                message={item.message}
                sender={item.sender}
                time={messageTime(item.message.at, now)}
                now={now}
                main={main}
                startsGroup={atDivider}
                eager={eager?.has(item.message.ts) ?? false}
                flush={first || atDivider}
                tabbable={item.message.ts === tabbable}
                hueOf={hueOf}
                actions={actions}
                active={activeMessage === item.message.ts}
                confirmingDelete={confirmingDelete === item.message.ts}
                suggestion={suggestion?.ts === item.message.ts ? suggestion.value : undefined}
                editor={editing?.ts === item.message.ts ? editing.editor : undefined}
                onOpenThread={onOpenThread}
                onChannel={onChannel}
                onLink={onLink}
                onToggleReaction={onToggleReaction}
                onRetry={onRetry}
                onDiscard={onDiscard}
                onOpenImage={onOpenImage}
                onDownload={onDownload}
                progress={item.message.clientMsgId === undefined ? undefined : uploadProgress?.[item.message.clientMsgId]}
                onFocus={setFocusedTs}
              />
            </Row>
          )
        })}
      </div>
    </ScrollArea>
  )
}

/** The divider before a row, when the row is the first unread one. Not before the first message. */
function Row({ atDivider, newCount, anchorRef, children }: { readonly atDivider: boolean; readonly newCount: number; readonly anchorRef: Ref<HTMLDivElement> | undefined; readonly children: ReactNode }) {
  if (!atDivider) return children
  return (
    <>
      <NewDivider ref={anchorRef} count={newCount} />
      {children}
    </>
  )
}

function Empty({ main, status }: { readonly main: boolean; readonly status: MessageListStatus }) {
  if (status === 'pending') return null
  if (status === 'loading') {
    return (
      <div {...stylex.props(styles.quiet)}>
        <Text variant="meta" tone="muted">
          Loading messages
        </Text>
      </div>
    )
  }
  if (status === 'offline') {
    return <EmptyState illustration="nothing-here" title="Nothing here yet" body="Slack couldn't be reached. Juno fetches this topic when you're back online." enter={false} />
  }
  return main ? (
    <EmptyState illustration="nothing-here" title="Quiet in here" body="New messages in this channel show up here. Threads live behind the Threads button." enter={false} />
  ) : (
    <EmptyState illustration="nothing-here" title="No messages yet" body="Replies show up here as they arrive." enter={false} />
  )
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
    maxWidth: layout['--reading-width'],
    minHeight: '100%',
    marginInline: 'auto',
    paddingTop: spacing['--space-5'],
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-4'],
    boxSizing: 'border-box',
  },
  // A fixed slot above the first row, so "Loading older messages" appearing
  // or going away never moves the rows below it.
  olderLine: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: sizes['--control-28'],
    flexShrink: 0,
    userSelect: 'none',
  },
  notDrawn: (rows: number) => ({
    flexShrink: 0,
    height: `calc(${sizes['--row-message-estimate']} * ${rows})`,
  }),
  quiet: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    paddingBlock: spacing['--space-12'],
    userSelect: 'none',
  },
})
