import * as stylex from '@stylexjs/stylex'
import { memo, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { FileView, MessageView, Person, QuickReaction, ReactionIssue } from '@juno/contract'
import { colors, density, layout, motion, opacity, radii, sizes, spacing, text, tints, z } from '@juno/tokens/tokens.stylex'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import { Avatar, focusRing, Icon, pointerMoved, Text, type ActivateEvent, type HueName } from '@juno/ui'
import { SharedFileLines, type FileBlock } from './AttachmentCard'
import { Files } from './FileCard'
import { viewingOf } from './MediaGrid'
import type { MediaViewing } from './MediaViewer'
import type { MenuAnchor } from './header/HeaderControls'
import { HoverToolbar } from './HoverToolbar'
import { hueFor, initials } from './look'
import { MessageBody } from './MessageBody'
import type { LinkInfo } from './MessageLink'
import { PersonLink } from './personLink'
import { Reactions } from './Reactions'
import { TextButton } from './juno-chat/TextButton'
import { ThreadLink } from './ThreadLink'
import { BroadcastSource } from './BroadcastSource'
import { clockTime, fullTime } from './time'

/**
 * What the hover toolbar and the delete confirm do, for every row of a list.
 * Created once by the container and taking the message, so a row stays
 * memoized (performance 5.1).
 */
export interface MessageActions {
  readonly onResolveAction?: (id: number, retry: boolean) => void
  /** The toolbar's one-click reactions, in order; the default three when absent. */
  readonly quickReactions?: ReadonlyArray<QuickReaction>
  readonly onReact: (message: MessageView, name: string) => void
  /** Opens the emoji picker at `at`. */
  readonly onMoreReactions: (message: MessageView, at: MenuAnchor) => void
  readonly onQuote: (message: MessageView) => void
  /** Main only: opens the message's thread; with `newTab` (⌘-click or ⌘Enter) in a background tab. */
  readonly onReply?: (message: MessageView, options?: { readonly newTab: boolean }) => void
  /** The message menu at `at`. */
  readonly onMore: (message: MessageView, at: MenuAnchor) => void
  /** Opens the reactions dialog on one emoji, under its chip (the card's See all). */
  readonly onSeeReactions?: (message: MessageView, name: string, chip: HTMLElement) => void
  readonly onConfirmDelete: (message: MessageView) => void
  readonly onCancelDelete: () => void
}

export interface MessageProps {
  /** The row as the engine shaped it. Identity-stable while its `rev` holds. */
  readonly message: MessageView
  /** The sender from the window's refs. Undefined for an unloaded root, or a user the store does not know. */
  readonly sender: Person | undefined
  /** The people who reacted, by id: hovering a chip shows them. */
  readonly reactors?: ReadonlyMap<string, Person>
  /** Repliers for Main thread links, from the window refs. */
  readonly repliers?: ReadonlyMap<string, Person>
  /** The message time, already formatted ("9:12"). */
  readonly time: string
  /** Epoch milliseconds, for `date` inlines. */
  readonly now: number
  /** Main: thread links under messages, Start thread or Open thread on the toolbar. */
  readonly main: boolean
  /**
   * Show the name and avatar even when the message continues its sender's
   * run: the one after the "N new" divider. Otherwise `message.groupStart`
   * decides, which the engine works out from the message before, even when
   * that one is outside the window.
   */
  readonly startsGroup: boolean
  /** No top margin: the topic's first message, or the row right after the divider. */
  readonly flush?: boolean
  /** Laid out in full even off screen, never at the size estimate. */
  readonly eager?: boolean
  /** Roving tabindex: the one row that Tab reaches. */
  readonly tabbable?: boolean
  readonly hueOf: (id: string) => HueName
  /** The hover toolbar's actions. With them the row has a toolbar and reserves its place, so nothing moves when it shows. */
  readonly actions?: MessageActions
  /** The toolbar asks to confirm a delete and stays shown. */
  readonly active?: boolean
  readonly confirmingDelete?: boolean
  /**
   * The fix line after sending (SPEC section 8): "its → it's" or "2 small fixes", with `detail` (the fixes, or
   * the long-sentence note) in muted text after it. Review opens the edit field with the fixes; Dismiss removes it.
   */
  readonly suggestion?: { readonly label: string; readonly detail?: string; readonly onReview: () => void; readonly onDismiss: () => void } | undefined
  /** The inline edit field, in place of the body while the message is edited. */
  readonly editor?: ReactNode
  readonly onOpenThread?: (id: string, event: ActivateEvent) => void
  /** Main: a broadcast reply's "in <topic title>" opens the thread `id` at the reply `ts`. */
  readonly onOpenReply?: (id: string, ts: string, event: ActivateEvent) => void
  readonly onChannel?: (id: string) => void
  readonly onLink?: (url: string, event: ActivateEvent) => void
  /** Which links open inside Juno, and where they go (`MessageBody`). Stable for the list's life. */
  readonly linkInfo?: LinkInfo
  readonly onToggleReaction?: (ts: string, name: string) => void
  /** The row took keyboard focus: the list moves its tabbable row here. */
  readonly onFocus?: (ts: string) => void
  /** Retry on a failed send, with its `clientMsgId`. */
  readonly onRetry?: (clientMsgId: string) => void
  /** Delete draft on a failed send, with its `clientMsgId`. */
  readonly onDiscard?: (clientMsgId: string) => void
  /** A file the viewer shows was opened: the media viewer, at it, with the message's others. */
  readonly onOpenMedia?: ((viewing: MediaViewing) => void) | undefined
  /** Download on a file card. */
  readonly onDownload?: ((file: FileView) => void) | undefined
  /** Quick Look on a card of a file the viewer cannot show. */
  readonly onQuickLook?: ((file: FileView) => void) | undefined
  /** How far a sending message's files have uploaded, 0 to 1. */
  readonly progress?: number | undefined
}

const HOVER = '@media (hover: hover)'

const NO_PEOPLE: ReadonlyMap<string, Person> = new Map()

// How far the toolbar's bottom edge comes into the row: the row's top padding
// less 2px (2px, or none in compact density). The name's text box starts
// that far in, so the toolbar straddles the row's top edge, as Slack's does,
// and never covers the name, the time or the first line of a grouped row.
const STRADDLE = `(${density['--density-message-padding-block']} - ${spacing['--space-0-5']})`

const TOOLBAR_MOVES = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

/**
 * Tab from a focused row into its toolbar, and the arrows inside it. The
 * toolbar shows only while something in the row has keyboard focus, so as
 * focus lets go of one element it would leave the layout before the next
 * button could take focus, and focus would fall to the page. For that key
 * press it stays laid out; the row lets go once focus is inside it again,
 * or has left the row. On the capture phase, before the toolbar's own keys.
 */
function holdToolbarForMove(event: KeyboardEvent<HTMLDivElement>): void {
  const fromRow = event.key === 'Tab' && !event.shiftKey && event.target === event.currentTarget
  const inToolbar = TOOLBAR_MOVES.has(event.key) && event.target instanceof Element && event.target.closest('[role="toolbar"]') !== null
  if (fromRow || inToolbar) event.currentTarget.style.setProperty('--row-toolbar-display', 'block')
}

/**
 * Where the toolbar goes, decided as the pointer moves onto the row or it is focused, again
 * as the pointer moves over it, and when the list stops scrolling (never per
 * frame): a row can scroll or grow under a still pointer, and an answer kept
 * from before would leave the toolbar under the band. It rises above the
 * row's top edge unless that would put it under the header band at the
 * list's top, where the band's fade washes it out and the list clips it.
 * A row whose top is in view then takes it inside its top edge, over the
 * right of its header line, which keeps that room free: the first message at
 * scroll top, which starts right at the band. A row whose top is under the
 * band has it flip below, straddling the bottom edge the same way, so it
 * stays near what is in view. A row taller than the list has room for
 * neither, as the last message is when its end sits on the composer: the
 * toolbar then goes inside the row, at the top of the part in view, under
 * the band. The answer is a custom property
 * on the row, written only when it changes, so nothing re-renders.
 */
export function placeToolbar(row: HTMLElement): void {
  const scroller = row.closest('[data-scroll-area]')
  if (scroller === null) return
  const box = row.getBoundingClientRect()
  const list = scroller.getBoundingClientRect()
  const style = getComputedStyle(scroller)
  const listTop = list.top + (Number.parseFloat(style.scrollPaddingTop) || 0)
  const toolbarHeight = Number.parseFloat(style.getPropertyValue('--toolbar-height')) || 0
  const rowStyle = getComputedStyle(row)
  const gap = Number.parseFloat(rowStyle.getPropertyValue('--space-0-5')) || 0
  const straddle = (Number.parseFloat(rowStyle.paddingTop) || 0) - gap
  const top =
    box.top + straddle - toolbarHeight >= listTop
      ? ''
      : box.top >= listTop
        ? `${Math.round(gap)}px`
        : box.bottom - straddle + toolbarHeight <= list.bottom
        ? `${Math.round(box.height - straddle)}px`
        : `${Math.round(Math.max(listTop - box.top, 0) + gap)}px`
  if (row.style.getPropertyValue('--row-toolbar-top') === top) return
  if (top === '') row.style.removeProperty('--row-toolbar-top')
  else row.style.setProperty('--row-toolbar-top', top)
}

/** The pointer is over a row: it places its toolbar, except during a drag selection, which shows none (`MessageList`). */
function pointedAt(event: PointerEvent<HTMLDivElement>): void {
  if (event.currentTarget.closest('[data-selecting]') === null) placeToolbar(event.currentTarget)
}

/**
 * The pointer moved onto a row. A row that scrolled under a still pointer is
 * placed when the scroll ends (`MessageList`): read here, its rect laid the
 * page out inside every scroll frame that brought a new row under the pointer
 * (performance.md 8.14).
 */
function pointerEntered(event: PointerEvent<HTMLDivElement>): void {
  if (pointerMoved(event)) pointedAt(event)
}

const dim = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: opacity['--opacity-dim'] },
})

/**
 * One flat message (inventory 6.1): the avatar column, then the name and
 * time on the first message of a run, the body, files, reactions and, in
 * Main, the thread link. A message that mentions you sits on the accent
 * tint. The hover toolbar sits at the top right of the row and shows by
 * opacity and display only, absolutely placed, so showing it never forces a layout. It
 * straddles the row's top edge, mostly above it, so it covers neither the
 * name and time nor the first line of a grouped row. The header is the same
 * height with or without a toolbar, so every list of messages has one rhythm.
 *
 * A message Juno is still sending looks like the message it becomes, so the
 * swap moves nothing; a send that takes longer than `--delay-pending` dims
 * its content. A failed send keeps its text and shows "Not sent" with Retry
 * and Delete draft under it. A sent message with fixes to offer shows its fix
 * line in the same place, with Review and Dismiss.
 */
export const Message = memo(function Message({
  message,
  sender,
  reactors,
  repliers,
  time,
  now,
  main,
  startsGroup,
  flush = false,
  eager = false,
  tabbable = false,
  hueOf,
  actions,
  active = false,
  confirmingDelete = false,
  editor,
  suggestion,
  onOpenThread,
  onOpenReply,
  onChannel,
  onLink,
  linkInfo,
  onToggleReaction,
  onFocus,
  onRetry,
  onDiscard,
  onOpenMedia,
  onDownload,
  onQuickLook,
  progress,
}: MessageProps) {
  const name = sender?.name ?? message.senderId ?? 'Unknown'
  const hue = sender === undefined ? hueOf(message.senderId ?? message.ts) : hueFor(sender.color, sender.id)
  const header = startsGroup || message.groupStart
  // The sender opens their DM (`PersonLink`), or the app user's behind a post under its own name; nothing when Juno has none.
  const opens = sender?.unreachable === true ? undefined : (sender?.user ?? sender?.id)
  const label = message.fromMe ? 'yourself' : name
  const focus = (event: FocusEvent<HTMLDivElement>) => {
    if (actions !== undefined) placeToolbar(event.currentTarget)
    if (event.target === event.currentTarget) onFocus?.(message.ts)
    else event.currentTarget.style.removeProperty('--row-toolbar-display')
  }
  const toggle = onToggleReaction === undefined ? undefined : (reaction: string) => onToggleReaction(message.ts, reaction)
  const seeReactions = actions?.onSeeReactions
  const seeAll = seeReactions === undefined ? undefined : (name: string, chip: HTMLElement) => seeReactions(message, name, chip)
  const openMedia =
    onOpenMedia === undefined
      ? undefined
      : (file: FileView) => {
          const viewing = viewingOf(message.files, file.id, name, message.at)
          if (viewing !== undefined) onOpenMedia(viewing)
        }
  // A shared message's files are drawn in its card; the rest under the body.
  const carded = cardFileIds(message)
  const own = carded === undefined ? message.files : message.files.filter((file) => !carded.has(file.id))
  const renderFiles =
    carded === undefined
      ? undefined
      : (blocks: ReadonlyArray<FileBlock>) => {
          const ids = new Set(blocks.map((block) => block.id))
          const files = message.files.filter((file) => ids.has(file.id))
          const missing = blocks.filter((block) => !files.some((file) => file.id === block.id))
          return (
            <>
              <Files files={files} onOpenMedia={openMedia} onDownload={onDownload} onQuickLook={onQuickLook} tabbable={tabbable} flush />
              {missing.length === 0 ? null : <SharedFileLines files={missing} />}
            </>
          )
        }
  const { pending, clientMsgId } = message
  // A failed send has Retry and Delete draft instead; a deleted or unloaded message has nothing to act on.
  const toolbar =
    actions === undefined || message.kind !== 'message' || pending === 'failed' || editor !== undefined ? undefined : (
      <HoverToolbar
        main={main}
        hasThread={message.thread !== undefined}
        tabIndex={tabbable ? 0 : -1}
        {...(actions.quickReactions === undefined ? {} : { reactions: actions.quickReactions })}
        onReact={(reaction) => actions.onReact(message, reaction)}
        onMoreReactions={(at) => actions.onMoreReactions(message, at)}
        onQuote={() => actions.onQuote(message)}
        {...(main && actions.onReply !== undefined ? { onReply: (options: { readonly newTab: boolean }) => actions.onReply?.(message, options) } : {})}
        onMore={(at) => actions.onMore(message, at)}
        {...(confirmingDelete ? { confirmDelete: { onConfirm: () => actions.onConfirmDelete(message), onCancel: actions.onCancelDelete } } : {})}
      />
    )

  return (
    <div
      role="listitem"
      tabIndex={tabbable ? 0 : -1}
      data-message-row={message.ts}
      data-thread={main ? message.thread?.id : undefined}
      data-pending={pending}
      data-popover-active={active ? '' : undefined}
      onFocus={focus}
      onKeyDownCapture={actions === undefined ? undefined : holdToolbarForMove}
      onBlur={actions === undefined ? undefined : (event) => event.currentTarget.contains(event.relatedTarget) || event.currentTarget.style.removeProperty('--row-toolbar-display')}
      onPointerEnter={actions === undefined ? undefined : pointerEntered}
      onPointerMove={actions === undefined ? undefined : pointedAt}
      data-editing={editor === undefined ? undefined : ''}
      {...stylex.props(
        styles.row,
        focusRing.inset,
        eager && styles.rowEager,
        header && !flush && styles.rowGroupStart,
        (active || confirmingDelete || editor !== undefined) && styles.rowHeld,
        editor !== undefined && styles.rowEditing,
        message.mentionsMe && styles.rowMention,
      )}
    >
      <span data-sender={header ? '' : undefined} {...stylex.props(styles.gutter, !header && styles.gutterContinuation)}>
        {header ? (
          <PersonLink id={opens} label={label} part="avatar">
            <Avatar label={sender === undefined ? '?' : initials(name)} name={name} size={32} hue={hue} {...(sender?.avatarUrl === undefined ? {} : { src: sender.avatarUrl })} />
          </PersonLink>
        ) : (
          <Text variant="tag" tone="muted" numeric as="time" title={fullTime(message.at)} sx={styles.gutterTime}>
            {clockTime(message.at)}
          </Text>
        )}
      </span>
      <span {...stylex.props(styles.content, pending === 'sending' && styles.sending)}>
        {header ? (
          <span data-message-header="" {...stylex.props(styles.header)}>
            <PersonLink id={opens} label={label} part="name" tabIndex={tabbable ? 0 : -1}>
              <Text variant="messageName" tone="default" truncate tooltipWhenTruncated dir="auto" as="span" sx={styles.name} data-sender="" data-person-name={name}>
                {name}
              </Text>
            </PersonLink>
            <Text variant="meta" tone="muted" numeric as="time" title={fullTime(message.at)} sx={styles.time}>
              {time}
            </Text>
            {message.broadcastFrom !== undefined && onOpenReply !== undefined ? (
              <BroadcastSource from={message.broadcastFrom} onOpen={(event) => onOpenReply(message.broadcastFrom!.id, message.ts, event)} tabIndex={tabbable ? 0 : -1} />
            ) : message.broadcast ? (
              <Text variant="meta" tone="muted" truncate>
                also sent to the channel
              </Text>
            ) : null}
          </span>
        ) : null}
        {editor !== undefined ? (
          editor
        ) : message.kind === 'message' ? (
          <MessageBody body={message.body} now={now} hueOf={hueOf} onChannel={onChannel} onLink={onLink} linkInfo={linkInfo} tabbable={tabbable} renderFiles={renderFiles} />
        ) : (
          <Text variant="body" tone="muted" as="p" sx={styles.placeholder}>
            {message.kind === 'deleted' ? 'This message was deleted.' : 'Loading message'}
          </Text>
        )}
        {message.edited && editor === undefined ? (
          <Text variant="tag" tone="muted" as="span" sx={styles.edited}>
            edited
          </Text>
        ) : null}
        <Files
          files={own}
          onOpenMedia={openMedia}
          onDownload={onDownload}
          onQuickLook={onQuickLook}
          tabbable={tabbable}
          progress={pending === 'sending' ? progress : undefined}
        />
        <Reactions reactions={message.reactions} onToggle={toggle} people={reactors ?? NO_PEOPLE} onSeeAll={seeAll} />
        {message.actionIssue !== undefined ? (
          <Text variant="meta" tone="muted" as="p" sx={styles.failed}>
            {message.actionIssue.kind === 'edit' ? 'Edit not sent.' : message.actionIssue.kind === 'broadcast' ? 'Not sent to the channel.' : 'Delete not sent.'}{' '}
            <TextButton tone="default" onClick={() => actions?.onResolveAction?.(message.actionIssue!.id, true)}>Retry</TextButton>
            {' · '}
            <TextButton tone="default" onClick={() => actions?.onResolveAction?.(message.actionIssue!.id, false)}>Dismiss</TextButton>
          </Text>
        ) : null}
        {message.reactionIssue !== undefined ? <ReactionIssueLine issue={message.reactionIssue} onResolve={actions?.onResolveAction} /> : null}
        {main && message.thread !== undefined && onOpenThread !== undefined ? <ThreadLink {...(repliers === undefined ? {} : { people: repliers })} link={message.thread} onOpen={onOpenThread} tabIndex={tabbable ? 0 : -1} /> : null}
        {suggestion !== undefined && editor === undefined ? (
          <Text variant="meta" tone="muted" as="p" role="group" aria-label="Suggested fix" data-send-suggestion="" sx={styles.suggestion}>
            <Text variant="meta" tone="default" as="span" sx={styles.suggestionLabel}>{suggestion.label}</Text>
            {suggestion.detail === undefined ? null : (
              <Text variant="meta" tone="muted" as="span" truncate tooltipWhenTruncated sx={styles.suggestionDetail}>
                {suggestion.detail}
              </Text>
            )}
            <span aria-hidden>·</span>
            <TextButton tone="default" onClick={suggestion.onReview}>
              Review
            </TextButton>
            <span aria-hidden>·</span>
            <TextButton tone="muted" onClick={suggestion.onDismiss}>
              Dismiss
            </TextButton>
          </Text>
        ) : null}
        {pending === 'failed' && clientMsgId !== undefined ? (
          <Text variant="meta" tone="muted" as="p" data-send-failed="" sx={styles.failed}>
            <span {...stylex.props(styles.failedIcon)}>
              <Icon icon={WarningCircle} size={14} weight="bold" />
            </span>
            <Text variant="meta" tone="danger" as="span">
              Not sent.
            </Text>{' '}
            <TextButton tone="default" onClick={() => onRetry?.(clientMsgId)}>
              Retry
            </TextButton>
            {' · '}
            <TextButton tone="muted" onClick={() => onDiscard?.(clientMsgId)}>
              Delete draft
            </TextButton>
          </Text>
        ) : null}
      </span>
      {toolbar !== undefined ? <span {...stylex.props(styles.toolbar)}><span {...stylex.props(styles.toolbarShown)}>{toolbar}</span></span> : null}
    </div>
  )
})

/**
 * The user's reaction change Slack has not taken. Refused: what Slack has
 * is shown, with Retry and Remove. Waiting long: one quiet line.
 */
/** The ids of the files the message's shared cards draw, or undefined when it has none, which is nearly always. */
function cardFileIds(message: MessageView): ReadonlySet<string> | undefined {
  let ids: Set<string> | undefined
  for (const block of message.body.blocks) {
    if (block.kind !== 'attachment') continue
    for (const child of block.blocks) if (child.kind === 'file') (ids ??= new Set()).add(child.id)
  }
  return ids
}

function ReactionIssueLine({ issue, onResolve }: { readonly issue: ReactionIssue; readonly onResolve: MessageActions['onResolveAction'] }) {
  if (issue.state === 'waiting') {
    return (
      <Text variant="meta" tone="muted" as="p" data-reaction-issue="waiting" sx={styles.failed}>
        Reaction not sent yet.
      </Text>
    )
  }
  return (
    <Text variant="meta" tone="muted" as="p" data-reaction-issue="failed" sx={styles.failed}>
      <span {...stylex.props(styles.failedIcon)}>
        <Icon icon={WarningCircle} size={14} weight="bold" />
      </span>
      <Text variant="meta" tone="danger" as="span">
        Reaction not sent
      </Text>{' '}
      <TextButton tone="default" onClick={() => onResolve?.(issue.id, true)}>
        Retry
      </TextButton>
      {' · '}
      <TextButton tone="muted" onClick={() => onResolve?.(issue.id, false)}>
        Remove
      </TextButton>
    </Text>
  )
}

const styles = stylex.create({
  // A line of its own under the message, like "Not sent", so it covers nothing.
  suggestion: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-1'],
    minWidth: 0,
    marginTop: spacing['--space-0-5'],
    userSelect: 'none',
  },
  suggestionLabel: {
    flexShrink: 0,
  },
  suggestionDetail: {
    minWidth: 0,
  },
  row: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-3'],
    minWidth: 0,
    paddingBlock: density['--density-message-padding-block'],
    paddingInline: spacing['--space-2'],
    borderRadius: radii['--radius-2xl'],
    color: colors['--foreground-default'],
    // Rows are independent layout and paint units, and off-screen rows are
    // skipped entirely; the estimate keeps the scrollbar steady
    // (docs/performance.md 3.3).
    contain: 'content',
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${sizes['--row-message-estimate']}`,
    // Paint containment clips at the row's edge; the toolbar above the row
    // (or below it, when flipped) and its shadow paint this far out. A plain
    // token: Chromium drops overflow-clip-margin given any calc().
    overflowClipMargin: layout['--toolbar-clip-margin'],
    containerName: 'message',
    containerType: 'inline-size',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--message-hover'] },
    },
    // The toolbar and the gutter time read these: hidden until the pointer is
    // over the row, or keyboard focus is on the row or inside it. Only
    // opacity and display change on an absolutely placed toolbar, so nothing
    // moves, and a hidden toolbar never takes the pointer, which matters where
    // it rises over the row before.
    '--row-action-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':focus-visible': '1',
      ':has(:focus-visible)': '1',
    },
    // The toolbar is out of the layout until then too: every row has one, and
    // laid out but transparent it was most of the list's style and layout work
    // when a topic opened or the pane changed width (performance.md 8). Its
    // slot is absolutely placed and stays in layout, so showing it moves
    // nothing and lays out only the slot, not the row (performance.md 8.14).
    // The active row paints over its neighbours, which its toolbar overlaps.
    // At rest it is --z-row, not auto: from auto to a number Chromium lays the
    // whole row out again, on every row that slides under a still pointer
    // while the list scrolls (performance.md 8.14).
    zIndex: {
      default: z['--z-row'],
      ':hover': { default: null, [HOVER]: z['--z-toolbar'] },
      ':focus-visible': z['--z-toolbar'],
      ':has(:focus-visible)': z['--z-toolbar'],
    },
    // A drag selection sets --row-hover-toolbar to none on the list (MessageList), so the toolbar keeps out of
    // the way while the owner selects, as native hover controls do; keyboard focus still shows it.
    '--row-toolbar-display': {
      default: 'none',
      ':hover': { default: null, [HOVER]: 'var(--row-hover-toolbar, block)' },
      ':focus-visible': 'block',
      ':has(:focus-visible)': 'block',
    },
  },
  rowEager: {
    contentVisibility: 'visible',
  },
  // The edit field's emoji suggestions open above it, past the row's edge:
  // the one row being edited drops paint containment so they are not clipped.
  rowEditing: {
    contain: 'layout style',
    contentVisibility: 'visible',
  },
  // Being edited, or asking to confirm a delete: the row keeps its hover look and its toolbar until that ends.
  rowHeld: {
    zIndex: z['--z-toolbar'],
    backgroundColor: colors['--message-hover'],
    '--row-action-opacity': '1',
    '--row-toolbar-display': 'block',
  },
  rowGroupStart: {
    marginTop: density['--density-message-group-gap'],
  },
  // Mentions you (SPEC section 7): the tint stays, hovered or not.
  rowMention: {
    backgroundColor: {
      default: tints['--tint-mention-bg'],
      ':hover': { default: null, [HOVER]: tints['--tint-mention-bg'] },
    },
  },
  gutter: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--avatar-32'],
    minHeight: sizes['--avatar-32'],
    marginTop: spacing['--space-0-5'],
    userSelect: 'none',
  },
  // A continuation row is as tall as its body: the gutter is one body line,
  // with the hover time centred on it, not the avatar's 32px box.
  gutterContinuation: {
    minHeight: 0,
    height: `calc(${text['--text-body-size']} * ${text['--text-body-leading']})`,
    marginTop: 0,
  },
  gutterTime: {
    opacity: 'var(--row-action-opacity)',
    // Always its own stacking context, so the hover's opacity change from 0
    // to 1 does not make it one and lay the row out again (performance.md 8.14).
    isolation: 'isolate',
    whiteSpace: 'nowrap',
  },
  // Whole pixels tall, whatever the text inside (performance 3.3): a row
  // laid out above the view for the first time grows from its estimate, and
  // scroll anchoring can only move the list by whole device pixels, so a
  // fractional height leaves the rows in view a part of a pixel off.
  content: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    flexGrow: 1,
    minWidth: 0,
    height: 'calc-size(auto, round(up, size, 1px))', // tokens-allow: Round measured rows to whole CSS pixels to prevent scroll drift.
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-2'],
    maxWidth: '100%',
    minWidth: 0,
    marginBottom: spacing['--space-0-5'],
    userSelect: 'none',
  },
  // The time follows the name at the header's gap, as in Slack.
  name: {
    flexShrink: 1,
    minWidth: 0,
  },
  // A long name gives way; the time never does.
  time: {
    flexShrink: 0,
  },
  placeholder: {
    fontStyle: 'italic',
  },
  // Opacity only, after the delay: a quick send never changes how the row looks.
  sending: {
    animationName: dim,
    animationDuration: motion['--duration-fast'],
    animationDelay: motion['--delay-pending'],
    animationFillMode: 'both',
    animationTimingFunction: motion['--ease-out'],
  },
  failed: {
    marginTop: spacing['--space-0-5'],
    userSelect: 'none',
  },
  failedIcon: {
    display: 'inline-flex',
    verticalAlign: 'text-bottom',
    marginInlineEnd: spacing['--space-1'],
    color: colors['--danger'],
  },
  edited: {
    marginTop: spacing['--space-0-5'],
    userSelect: 'none',
  },
  // At the row's top right, mostly above the row: its bottom edge comes
  // STRADDLE into the row, above the first line. placeToolbar flips it below
  // a row whose top is under the header band, or inside a row too tall for
  // either, under the band. Paint containment would clip it
  // outside the row, so the row's overflow-clip-margin lets it paint.
  // The slot is an empty anchor at the toolbar's top right corner. It never
  // leaves the row's layout or changes size: either would lay the whole row
  // out again when the toolbar shows (performance.md 8.14).
  toolbar: {
    position: 'absolute',
    top: `var(--row-toolbar-top, calc(${STRADDLE} - ${layout['--toolbar-height']}))`,
    right: spacing['--space-2'],
    width: 0,
    height: 0,
    zIndex: z['--z-toolbar'],
    opacity: 'var(--row-action-opacity)',
  },
  // The toolbar, shown and hidden inside the slot, hanging from its corner.
  toolbarShown: {
    display: 'var(--row-toolbar-display)',
    position: 'absolute',
    top: 0,
    right: 0,
    width: 'max-content',
  },
})
