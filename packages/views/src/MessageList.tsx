import * as stylex from '@stylexjs/stylex'
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import type { FileView, MessageView, Person } from '@juno/contract'
import { layout, sizes, spacing, z } from '@juno/tokens/tokens.stylex'
import { type ActivateEvent, commandKey, EmptyState, hueForId, type HueName, ScrollArea, Text } from '@juno/ui'
import type { MediaViewing } from './MediaViewer'
import { Message, type MessageActions, type MessageProps } from './Message'
import type { LinkInfo } from './MessageLink'
import { inField } from './fieldMenu'
import { openOnRelease, type MenuAt } from './menuRelease'
import { NewDivider } from './NewDivider'
import { PersonLinks, press } from './personLink'
import { messageHeaderTime } from './time'

/** One row as the container holds it: the message and its sender from the window's refs. */
export interface MessageListItem {
  readonly message: MessageView
  readonly sender: Person | undefined
  /** The people who reacted, by id, for the chips' card of who reacted. */
  readonly reactors?: ReadonlyMap<string, Person>
  /** Repliers for Main thread links, from the window refs. */
  readonly repliers?: ReadonlyMap<string, Person>
}

/**
 * What the list shows while it has no rows. `pending`: nothing yet, for the
 * first 300 ms of an open. `offline`: the topic is not cached and Slack
 * could not be reached; `rate-limited`: Slack asked Juno to wait.
 */
export type MessageListStatus = 'ready' | 'pending' | 'loading' | 'offline' | 'rate-limited'

/**
 * Whether older messages can come above the window: `more`, `loading` (a
 * page is on its way, and "Loading older messages" shows) or `none` (the
 * topic's first message is in the window).
 */
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
  /** A message that shows its sender's name and avatar even when it continues their group: the Search reader's landing match. */
  readonly startsGroupAt?: string | undefined
  /**
   * The rows sit at the bottom of the list while it is shorter than the view: replies that come in above them
   * (a window that stops at replies the store cannot prove above it) then never move them.
   */
  readonly fromBottom?: boolean
  readonly older?: OlderStatus
  /** The scroll element, for the container's open position and stick-to-bottom. */
  readonly scrollRef?: Ref<HTMLElement>
  /** The list runs under the topic's floating header (default). False where nothing floats over it, as in peek. */
  readonly underHeader?: boolean
  /** In a popover (peek): a tighter column, as tall as its rows. */
  readonly popover?: boolean
  /** The divider, for the container to scroll it 80px below the header band on open. */
  readonly anchorRef?: Ref<HTMLDivElement>
  /** The person hue for @mention chips. Default: the id's hash. */
  readonly hueOf?: (id: string) => HueName
  /** What rows' own controls do, created once. Without them rows have none (a preview). */
  readonly actions?: MessageActions
  /** The row whose menu, or the emoji picker the menu turned into, is open: it takes a faint fill. */
  readonly activeMessage?: string | undefined
  /** The row that asks to confirm a delete. */
  readonly confirmingDelete?: string | undefined
  /** The row being edited, and its inline edit field. */
  /** The fix lines after sending, by message `ts`. */
  readonly suggestions?: ReadonlyMap<string, MessageProps['suggestion']> | undefined
  readonly editing?: { readonly ts: string; readonly editor: ReactNode } | undefined
  /**
   * A key on a selected row that the list does not use itself (it moves the
   * selection with ↑ and ↓): E, Delete, Backspace, Enter, Esc. The
   * container acts on the row's message.
   */
  readonly onRowKey?: (ts: string, event: KeyboardEvent<HTMLElement>) => void
  /**
   * ↓ on the last row: the container moves focus on, to the composer. Pass it
   * only while the last row is the topic's newest message; without it ↓ there
   * does nothing.
   */
  readonly onPastEnd?: (() => void) | undefined
  readonly onOpenThread?: (id: string, event: ActivateEvent) => void
  /** A broadcast reply's "in <topic title>" in Main: the thread `id`, opened at the reply `ts`. */
  readonly onOpenReply?: (id: string, ts: string, event: ActivateEvent) => void
  /**
   * A ⌘-click on a Main message itself (its words, time or background), not on a link or other control in it, for a
   * press that did not move: the container opens the message's thread in a tab behind this one (SPEC 7). The press
   * neither focuses the row nor starts a selection.
   */
  readonly onOpenThreadBehind?: (ts: string) => void
  /** The pointer came onto a Main message that has a thread: warm the thread, which a peek or an open may read next. */
  readonly onPrefetchThread?: (id: string) => void
  /** A click on a `#channel` chip: open the channel's Main, `behind` the current tab with ⌘. Without it chips open nothing. */
  readonly onChannel?: (id: string, behind: boolean) => void
  /**
   * A click, or Enter, on a sender's name or avatar or an @person chip: your
   * DM with them (SPEC 7, "People"), `behind` the current tab with ⌘. Created
   * once. Without it people open nothing. Right-click is still `onPersonMenu`.
   */
  readonly onPerson?: (id: string, behind: boolean) => void
  readonly onLink?: (url: string, event: ActivateEvent) => void
  /** Which links open inside Juno, and where they go (`MessageBody`). */
  readonly linkInfo?: LinkInfo
  readonly onToggleReaction?: (ts: string, name: string) => void
  /** Retry on a failed send. */
  readonly onRetry?: (clientMsgId: string) => void
  /** Delete draft on a failed send. */
  readonly onDiscard?: (clientMsgId: string) => void
  /** A file the viewer shows was opened: the media viewer. Created once, like every row callback. */
  readonly onOpenMedia?: (viewing: MediaViewing) => void
  /** Download on a file card. Created once. */
  readonly onDownload?: (file: FileView) => void
  /** Quick Look on a card of a file the viewer cannot show. Created once. */
  readonly onQuickLook?: (file: FileView) => void
  /** Upload progress of the messages being sent with files, by `clientMsgId`, 0 to 1. */
  readonly uploadProgress?: Readonly<Record<string, number>>
  /**
   * A right-click on a message, once the button comes up over the same
   * message, or the context-menu key: its menu, at the pointer. `onSender` on
   * the sender's name or avatar (the person menu).
   */
  readonly onMessageMenu?: (ts: string, at: MenuAt, onSender: boolean) => void
  /** Closes the message menu: a second press on a row's menu button. */
  readonly onCloseMessageMenu?: () => void
  /** Right-click on an image thumbnail: the image menu (SPEC 8, "Images and the media viewer"). */
  readonly onImageMenu?: (ts: string, fileId: string, event: MouseEvent) => void
  /** Right-click on a link in message text or an unfurl: the link's own menu (SPEC 8, "Links"). */
  readonly onLinkMenu?: (url: string, event: MouseEvent) => void
  /** Right-click on an @person chip: the person menu (inventory 15.6). */
  readonly onPersonMenu?: (person: { readonly id: string; readonly name: string }, event: MouseEvent) => void
  /** Right-click on a #channel chip: the channel menu (inventory 15.2). */
  readonly onChannelMenu?: (channel: { readonly id: string; readonly name: string }, event: MouseEvent) => void
}

const ROW = '[data-message-row]'
/** A Main message that has a thread; `data-thread` is the thread's topic id. */
const THREAD_ROW = '[data-thread]'

/** What in a row handles its own click and ⌘-click: links, people, chips, files, pictures, reactions, buttons. */
const CONTROL = 'a, button, input, textarea, select, audio, video, [role="button"], [role="link"], [data-opens-person], [data-thumbnail], [data-reaction], [data-file-card], [data-message-more]'

/** The row a ⌘-press opens: one pressed on itself, not on a control in it, and not being edited. */
function plainRow(event: MouseEvent<HTMLElement>): string | undefined {
  const target = event.target
  if (!commandKey(event) || event.button !== 0 || !(target instanceof Element)) return undefined
  const row = target.closest<HTMLElement>(ROW)
  if (row === null || !event.currentTarget.contains(row) || row.dataset['editing'] !== undefined) return undefined
  const control = target.closest(CONTROL)
  return control !== null && row.contains(control) ? undefined : row.dataset['messageRow']
}

/** How far a press on the list moves before it is a drag selection, px. */
const DRAG_SELECTION = 4

/**
 * A press with the primary button that moves is a drag selection: the
 * person links under it then ignore the click that ends it
 * (`personLink.tsx`). Nothing re-renders, and focus and the keyboard are untouched.
 */
function watchSelectionDrag(event: PointerEvent<HTMLDivElement>): void {
  press.dragged = false
  if (event.button !== 0 || event.pointerType !== 'mouse' || !(event.target instanceof Element) || event.target.closest('button, a, input, textarea') !== null) return
  const from = { x: event.clientX, y: event.clientY }
  const move = (next: globalThis.PointerEvent) => {
    if (Math.hypot(next.clientX - from.x, next.clientY - from.y) >= DRAG_SELECTION) press.dragged = true
  }
  const end = () => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', end, true)
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
}

/**
 * Arrow keys move focus between rows; the row that takes focus becomes the tabbable one. ↓ on the last row goes to
 * `onPastEnd`. Other keys on a row go to `onRowKey`.
 */
function onKeyDown(event: KeyboardEvent<HTMLDivElement>, onRowKey: MessageListProps['onRowKey'], onPastEnd: MessageListProps['onPastEnd']) {
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
  if (next === undefined) {
    if (event.key === 'ArrowDown' && onPastEnd !== undefined && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      onPastEnd()
    }
    return
  }
  event.preventDefault()
  next.focus()
  next.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

interface Menus {
  readonly onMessageMenu: MessageListProps['onMessageMenu']
  readonly onImageMenu: MessageListProps['onImageMenu']
  readonly onLinkMenu: MessageListProps['onLinkMenu']
  readonly onPersonMenu: MessageListProps['onPersonMenu']
  readonly onChannelMenu: MessageListProps['onChannelMenu']
}

/**
 * One handler for every row: an image, @person or #channel chip under the
 * pointer gets its own menu at once, otherwise the row under the pointer, or
 * the focused row for the context-menu key. A field keeps the text menu (`inField`).
 */
function pointInSelection(event: MouseEvent): boolean {
  const selection = globalThis.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false
  return [...selection.getRangeAt(0).getClientRects()].some((rect) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)
}

function messageMenu(event: MouseEvent<HTMLElement>, { onMessageMenu, onImageMenu, onLinkMenu, onPersonMenu, onChannelMenu }: Menus) {
  const target = event.target
  if (!(target instanceof Element) || inField(event)) return
  const ts = target.closest<HTMLElement>(ROW)?.dataset.messageRow
  const image = target.closest<HTMLElement>('[data-thumbnail]')?.dataset.thumbnail
  if (image !== undefined && ts !== undefined && onImageMenu !== undefined) {
    event.preventDefault()
    onImageMenu(ts, image, event)
    return
  }
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
  const link = onLinkMenu === undefined || pointInSelection(event) ? null : target.closest<HTMLElement>('[data-message-link]')
  if (link !== null && onLinkMenu !== undefined) {
    const url = link.dataset.messageLink
    if (url !== undefined) {
      event.preventDefault()
      onLinkMenu(url, event)
      return
    }
  }
  if (onMessageMenu === undefined || ts === undefined) return
  event.preventDefault()
  const onSender = target.closest('[data-sender]') !== null
  const list = event.currentTarget
  openOnRelease(event, (under) => {
    const row = under.closest<HTMLElement>(ROW)
    return row !== null && list.contains(row) && row.dataset.messageRow === ts
  }, (at) => onMessageMenu(ts, at, onSender))
}

/**
 * The messages of one topic, oldest first, in the centred 800px column
 * (inventory 6). Rows stay in flow with `content-visibility: auto`, so the
 * browser's scroll anchoring handles prepends and nothing runs per scroll
 * frame. The list owns no scroll logic: the container reads and sets the position
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
  startsGroupAt,
  fromBottom = false,
  older = 'none',
  scrollRef,
  underHeader = true,
  popover = false,
  anchorRef,
  hueOf = hueForId,
  actions,
  activeMessage,
  confirmingDelete,
  editing,
  suggestions,
  onRowKey,
  onPastEnd,
  onOpenThread,
  onOpenReply,
  onOpenThreadBehind,
  onPrefetchThread,
  onChannel,
  onPerson,
  onLink,
  linkInfo,
  onToggleReaction,
  onRetry,
  onDiscard,
  onOpenMedia,
  onDownload,
  onQuickLook,
  uploadProgress,
  onMessageMenu,
  onCloseMessageMenu,
  onImageMenu,
  onLinkMenu,
  onPersonMenu,
  onChannelMenu,
}: MessageListProps) {
  // The rows' menu button, one handler for the list's life, so rows stay memoized; it reads the latest callbacks.
  const menus = useRef({ onMessageMenu, onCloseMessageMenu })
  useLayoutEffect(() => {
    menus.current = { onMessageMenu, onCloseMessageMenu }
  })
  const onMenuButton = useCallback((ts: string, button: HTMLElement, open: boolean) => {
    if (open) return menus.current.onCloseMessageMenu?.()
    const box = button.getBoundingClientRect()
    menus.current.onMessageMenu?.(ts, { clientX: box.left, clientY: box.bottom, trigger: { width: box.width, height: box.height } }, false)
  }, [])
  const [focusedTs, setFocusedTs] = useState<string | undefined>(undefined)
  // The thread last warmed, so moving within one message warms it once.
  const warmed = useRef<string | undefined>(undefined)
  const last = items[items.length - 1]
  const tabbable = focusedTs !== undefined && items.some((item) => item.message.ts === focusedTs) ? focusedTs : last?.message.ts
  const dividerIndex = dividerBefore === undefined ? -1 : items.findIndex((item) => item.message.ts >= dividerBefore)
  const newCount = dividerIndex < 0 ? 0 : items.length - dividerIndex

  return (
    <ScrollArea
      scrollbar="hover"
      evenInset
      underHeader={underHeader}
      ref={scrollRef}
      data-scroll=""
      sx={styles.scroller}
    >
      <div
        role="list"
        aria-label="Messages"
        aria-busy={status === 'loading' || status === 'pending'}
        onKeyDown={(event) => onKeyDown(event, onRowKey, onPastEnd)}
        onPointerDown={watchSelectionDrag}
        // ⌘-click on a message: no focus or selection on the press, the thread on the click (`plainRow`).
        onMouseDown={onOpenThreadBehind === undefined ? undefined : (event) => plainRow(event) !== undefined && event.preventDefault()}
        onClick={
          onOpenThreadBehind === undefined
            ? undefined
            : (event) => {
                const ts = event.detail === 1 && !press.dragged ? plainRow(event) : undefined
                if (ts !== undefined) onOpenThreadBehind(ts)
              }
        }
        onPointerOver={
          onPrefetchThread === undefined
            ? undefined
            : (event) => {
                const id = event.target instanceof Element ? event.target.closest<HTMLElement>(THREAD_ROW)?.dataset['thread'] : undefined
                if (id === undefined || id === warmed.current) return
                warmed.current = id
                onPrefetchThread(id)
              }
        }
        onContextMenu={
          onMessageMenu === undefined && onImageMenu === undefined && onLinkMenu === undefined && onPersonMenu === undefined && onChannelMenu === undefined ? undefined : (event) => messageMenu(event, { onMessageMenu, onImageMenu, onLinkMenu, onPersonMenu, onChannelMenu })
        }
        {...stylex.props(styles.column, popover && styles.popoverColumn, fromBottom && styles.fromBottom)}
      >
        {items.length > 0 && !(popover && older === 'none') ? (
          <div aria-live="polite" data-older-line={older} {...stylex.props(styles.olderLine, !popover && styles.olderInRoom)}>
            {older === 'loading' ? (
              <Text variant="meta" tone="muted">
                Loading older messages
              </Text>
            ) : null}
          </div>
        ) : null}
        {notDrawnAbove > 0 ? <div aria-hidden {...stylex.props(styles.notDrawn(notDrawnAbove))} /> : null}
        {items.length === 0 ? <Empty main={main} status={status} /> : null}
        <PersonLinks value={onPerson}>
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
                {...(item.repliers === undefined ? {} : { repliers: item.repliers })}
                {...(item.reactors === undefined ? {} : { reactors: item.reactors })}
                time={messageHeaderTime(item.message.at, now)}
                now={now}
                main={main}
                startsGroup={atDivider || item.message.ts === startsGroupAt}
                eager={eager?.has(item.message.ts) ?? false}
                flush={first || atDivider}
                tabbable={item.message.ts === tabbable}
                hueOf={hueOf}
                actions={actions}
                active={activeMessage === item.message.ts}
                confirmingDelete={confirmingDelete === item.message.ts}
                suggestion={suggestions?.get(item.message.ts)}
                editor={editing?.ts === item.message.ts ? editing.editor : undefined}
                onOpenThread={onOpenThread}
                onOpenReply={onOpenReply}
                onChannel={onChannel}
                onLink={onLink}
                linkInfo={linkInfo}
                onToggleReaction={onToggleReaction}
                onRetry={onRetry}
                onDiscard={onDiscard}
                onOpenMedia={onOpenMedia}
                onDownload={onDownload}
                onQuickLook={onQuickLook}
                progress={item.message.clientMsgId === undefined ? undefined : uploadProgress?.[item.message.clientMsgId]}
                onFocus={setFocusedTs}
                onMenuButton={onMessageMenu === undefined ? undefined : onMenuButton}
              />
            </Row>
          )
        })}
        </PersonLinks>
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
  if (status === 'rate-limited') {
    return <EmptyState illustration="nothing-here" title="Nothing here yet" body="Slack asked Juno to slow down. Juno fetches this topic in a moment." enter={false} />
  }
  return main ? (
    <EmptyState illustration="nothing-here" title="Quiet in here" body="New messages in this channel show up here. Click Main above for its threads." enter={false} />
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
    // At scroll top the first row starts where the header band ends, 24px
    // under the islands; the last row ends 16 + the composer's 8 = 24px
    // above the field, so the two gaps match. With no room above it, the
    // first row's delete confirm sits inside its top edge (placeConfirm).
    position: 'relative',
    paddingTop: `calc(${layout['--header-band']} - ${layout['--header-inset']})`,
    paddingInline: spacing['--space-6'],
    paddingBottom: spacing['--space-4'],
    boxSizing: 'border-box',
  },
  // The rows start where the popover's header does: the scrollbar's even
  // inset, then room for a row's focus ring, which the scroller would clip.
  popoverColumn: {
    minHeight: 0,
    paddingTop: spacing['--space-2'],
    paddingInline: sizes['--focus-ring-room'],
    paddingBottom: spacing['--space-2'],
  },
  // Rows at the bottom: the space a short list leaves goes above them.
  fromBottom: {
    justifyContent: 'flex-end',
    minHeight: '100%',
  },
  // "Loading older messages". In peek, a slot above the first row while
  // older messages may come, so the line moves nothing.
  olderLine: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: sizes['--control-28'],
    flexShrink: 0,
    userSelect: 'none',
  },
  // Under the header: in the gap between the islands and the first row, out
  // of the flow, so the line appearing or going moves nothing and no space is
  // kept for it. Over the band's fade, which would wash it out (the list
  // comes after the header, so the same layer paints over it).
  olderInRoom: {
    position: 'absolute',
    top: `calc(${layout['--header-island-top']} + ${layout['--header-island-height']} - ${layout['--header-inset']})`,
    insetInline: 0,
    height: `calc(${layout['--header-band']} - ${layout['--header-island-top']} - ${layout['--header-island-height']})`,
    zIndex: z['--z-header'],
    pointerEvents: 'none',
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
