import * as stylex from '@stylexjs/stylex'
import { memo, type FocusEvent, type ReactNode } from 'react'
import type { MessageView, Person } from '@juno/contract'
import { accent, colors, density, layout, motion, opacity, radii, sizes, spacing, tints, z } from '@juno/tokens/tokens.stylex'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import { Avatar, Icon, Text, type ActivateEvent, type HueName } from '@juno/ui'
import { Files } from './FileCard'
import type { MenuAnchor } from './header/HeaderControls'
import { HoverToolbar } from './HoverToolbar'
import { hueFor, initials } from './look'
import { MessageBody } from './MessageBody'
import { Reactions } from './Reactions'
import { TextButton } from './juno-chat/TextButton'
import { ThreadLink } from './ThreadLink'
import { fullTime } from './time'

/**
 * What the hover toolbar and the delete confirm do, for every row of a list.
 * Created once by the container and taking the message, so a row stays
 * memoized (performance 5.1).
 */
export interface MessageActions {
  readonly onReact: (message: MessageView, name: string) => void
  /** Opens the emoji picker at `at`. */
  readonly onMoreReactions: (message: MessageView, at: MenuAnchor) => void
  readonly onQuote: (message: MessageView) => void
  /** Main only: opens the message's thread. */
  readonly onReply?: (message: MessageView) => void
  /** The message menu at `at`. */
  readonly onMore: (message: MessageView, at: MenuAnchor) => void
  readonly onConfirmDelete: (message: MessageView) => void
  readonly onCancelDelete: () => void
}

export interface MessageProps {
  /** The row as the engine shaped it. Identity-stable while its `rev` holds. */
  readonly message: MessageView
  /** The sender from the window's refs. Undefined for an unloaded root, or a user the store does not know. */
  readonly sender: Person | undefined
  /** The message time, already formatted ("9:12"). */
  readonly time: string
  /** Epoch milliseconds, for `date` inlines. */
  readonly now: number
  /** Main: thread links under messages, Reply in thread on the toolbar. */
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
  readonly confirmingDelete?: boolean
  /** The inline edit field, in place of the body while the message is edited. */
  readonly editor?: ReactNode
  readonly onOpenThread?: (id: string, event: ActivateEvent) => void
  readonly onChannel?: (id: string) => void
  readonly onLink?: (url: string) => void
  readonly onToggleReaction?: (ts: string, name: string) => void
  /** The row took keyboard focus: the list moves its tabbable row here. */
  readonly onFocus?: (ts: string) => void
  /** Retry on a failed send, with its `clientMsgId`. */
  readonly onRetry?: (clientMsgId: string) => void
  /** Delete draft on a failed send, with its `clientMsgId`. */
  readonly onDiscard?: (clientMsgId: string) => void
}

const HOVER = '@media (hover: hover)'

// The least of the header line the name and time keep in a narrow column. Below
// it the toolbar's reserve gives way, so the toolbar covers the name's end on
// hover instead of the name vanishing for good.
const NAME_MIN = '160px'

const dim = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: opacity['--opacity-dim'] },
})

/**
 * One flat message (inventory 6.1): the avatar column, then the name and
 * time on the first message of a run, the body, files, reactions and, in
 * Main, the thread link. A message that mentions you sits on the accent
 * tint. The hover toolbar's slot is reserved at the top right of the row,
 * inside its box, so showing it never forces a layout: on a row with a
 * toolbar the header keeps its end free and is as tall as the toolbar, so
 * neither the name nor the first body line runs under it.
 *
 * A message Juno is still sending looks like the message it becomes, so the
 * swap moves nothing; a send that takes longer than `--delay-pending` dims
 * its content. A failed send keeps its text and shows "Not sent" with Retry
 * and Delete draft under it.
 */
export const Message = memo(function Message({
  message,
  sender,
  time,
  now,
  main,
  startsGroup,
  flush = false,
  eager = false,
  tabbable = false,
  hueOf,
  actions,
  confirmingDelete = false,
  editor,
  onOpenThread,
  onChannel,
  onLink,
  onToggleReaction,
  onFocus,
  onRetry,
  onDiscard,
}: MessageProps) {
  const name = sender?.name ?? message.senderId ?? 'Unknown'
  const hue = sender === undefined ? hueOf(message.senderId ?? message.ts) : hueFor(sender.color, sender.id)
  const header = startsGroup || message.groupStart
  const focus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onFocus?.(message.ts)
  }
  const toggle = onToggleReaction === undefined ? undefined : (reaction: string) => onToggleReaction(message.ts, reaction)
  const { pending, clientMsgId } = message
  // A failed send has Retry and Delete draft instead; a deleted or unloaded message has nothing to act on.
  const toolbar =
    actions === undefined || message.kind !== 'message' || pending === 'failed' || editor !== undefined ? undefined : (
      <HoverToolbar
        main={main}
        tabIndex={tabbable ? 0 : -1}
        onReact={(reaction) => actions.onReact(message, reaction)}
        onMoreReactions={(at) => actions.onMoreReactions(message, at)}
        onQuote={() => actions.onQuote(message)}
        {...(main && actions.onReply !== undefined ? { onReply: () => actions.onReply?.(message) } : {})}
        onMore={(at) => actions.onMore(message, at)}
        {...(confirmingDelete ? { confirmDelete: { onConfirm: () => actions.onConfirmDelete(message), onCancel: actions.onCancelDelete } } : {})}
      />
    )

  return (
    <div
      role="listitem"
      tabIndex={tabbable ? 0 : -1}
      data-message-row={message.ts}
      data-pending={pending}
      onFocus={focus}
      data-editing={editor === undefined ? undefined : ''}
      {...stylex.props(
        styles.row,
        eager && styles.rowEager,
        header && !flush && styles.rowGroupStart,
        message.mentionsMe && styles.rowMention,
        (confirmingDelete || editor !== undefined) && styles.rowHeld,
      )}
    >
      <span data-sender={header ? '' : undefined} {...stylex.props(styles.gutter)}>
        {header ? (
          <Avatar label={sender === undefined ? '?' : initials(name)} name={name} size={32} hue={hue} {...(sender?.avatarUrl === undefined ? {} : { src: sender.avatarUrl })} />
        ) : (
          <Text variant="tag" tone="muted" numeric as="time" title={fullTime(message.at)} sx={styles.gutterTime}>
            {time}
          </Text>
        )}
      </span>
      <span {...stylex.props(styles.content, pending === 'sending' && styles.sending)}>
        {header ? (
          <span {...stylex.props(styles.header, actions !== undefined && styles.headerWithToolbar)}>
            <Text variant="messageName" tone="default" truncate tooltipWhenTruncated dir="auto" as="span" sx={styles.name} data-sender="" data-person-name={name}>
              {name}
            </Text>
            <Text variant="meta" tone="muted" numeric as="time" title={fullTime(message.at)} sx={styles.time}>
              {time}
            </Text>
            {message.broadcast ? (
              <Text variant="meta" tone="muted" truncate>
                also sent to the channel
              </Text>
            ) : null}
          </span>
        ) : null}
        {editor !== undefined ? (
          editor
        ) : message.kind === 'message' ? (
          <MessageBody body={message.body} now={now} hueOf={hueOf} onChannel={onChannel} onLink={onLink} tabbable={tabbable} />
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
        <Files files={message.files} />
        <Reactions reactions={message.reactions} onToggle={toggle} />
        {main && message.thread !== undefined && onOpenThread !== undefined ? <ThreadLink link={message.thread} onOpen={onOpenThread} tabIndex={tabbable ? 0 : -1} /> : null}
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
      {toolbar !== undefined ? <span {...stylex.props(styles.toolbar)}>{toolbar}</span> : null}
    </div>
  )
})

const styles = stylex.create({
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
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
    // The toolbar and the gutter time read this: hidden until the pointer is
    // over the row, or keyboard focus is on the row or inside it. Only
    // opacity changes, so nothing moves.
    '--row-action-opacity': {
      default: '0',
      ':hover': { default: null, [HOVER]: '1' },
      ':focus-visible': '1',
      ':has(:focus-visible)': '1',
    },
    // The toolbar is out of the layout until then too: every row has one, and
    // laid out but transparent it was most of the list's style and layout work
    // when a topic opened or the pane changed width (performance.md 8). It is
    // absolutely placed in a reserved slot, so showing it moves nothing.
    '--row-toolbar-display': {
      default: 'none',
      ':hover': { default: null, [HOVER]: 'block' },
      ':focus-visible': 'block',
      ':has(:focus-visible)': 'block',
    },
  },
  rowEager: {
    contentVisibility: 'visible',
  },
  // Being edited, or asking to confirm a delete: the row keeps its hover look and its toolbar until that ends.
  rowHeld: {
    backgroundColor: colors['--surface-hover'],
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
  gutterTime: {
    opacity: 'var(--row-action-opacity)',
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
    height: 'calc-size(auto, round(up, size, 1px))',
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
  // The toolbar's footprint (inventory 6.5). A continuation row has no
  // header, so the toolbar shows over the end of its first line, as Slack's
  // does; the row's paint containment keeps it inside the row.
  headerWithToolbar: {
    paddingInlineEnd: `min(${layout['--toolbar-reserve']}, max(0px, 100% - ${NAME_MIN}))`,
    minHeight: `calc(${layout['--toolbar-height']} - ${spacing['--space-0-5']})`,
  },
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
  // Inside the row's box (content-visibility brings paint containment, so
  // nothing can hang above it), top right, over the header line's empty end.
  toolbar: {
    display: 'var(--row-toolbar-display)',
    position: 'absolute',
    top: spacing['--space-0-5'],
    right: spacing['--space-2'],
    zIndex: z['--z-toolbar'],
    opacity: 'var(--row-action-opacity)',
    pointerEvents: 'auto',
  },
})
