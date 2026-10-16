import * as stylex from '@stylexjs/stylex'
import { memo, type FocusEvent, type ReactNode } from 'react'
import type { FileView, MessageView, Person, ReactionIssue } from '@juno/contract'
import { accent, colors, density, layout, motion, opacity, radii, sizes, spacing, text, tints, z } from '@juno/tokens/tokens.stylex'
import { WarningCircle } from '@phosphor-icons/react/dist/icons/WarningCircle'
import { Avatar, Button, Icon, Surface, Text, type ActivateEvent, type HueName } from '@juno/ui'
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
  /** The inline edit field, in place of the body while the message is edited. */
  readonly suggestion?: { readonly label: string; readonly onEdit: () => void } | undefined
  readonly editor?: ReactNode
  readonly onOpenThread?: (id: string, event: ActivateEvent) => void
  readonly onChannel?: (id: string) => void
  readonly onLink?: (url: string) => void
  readonly onToggleReaction?: (ts: string, name: string) => void
  /** Retry or Dismiss on a reaction Slack refused: the change to ask for. */
  readonly onSetReaction?: (ts: string, name: string, on: boolean) => void
  /** The row took keyboard focus: the list moves its tabbable row here. */
  readonly onFocus?: (ts: string) => void
  /** Retry on a failed send, with its `clientMsgId`. */
  readonly onRetry?: (clientMsgId: string) => void
  /** Delete draft on a failed send, with its `clientMsgId`. */
  readonly onDiscard?: (clientMsgId: string) => void
  /** A thumbnail was opened: the image viewer. */
  readonly onOpenImage?: ((file: FileView) => void) | undefined
  /** Download on a file card. */
  readonly onDownload?: ((file: FileView) => void) | undefined
  /** How far a sending message's files have uploaded, 0 to 1. */
  readonly progress?: number | undefined
}

const HOVER = '@media (hover: hover)'

// A row too narrow to keep the toolbar's reserve and still leave the name and
// time 160px: the reserve (243) + 160 + the gutter (32), its gap (12) and the
// row's inline padding (16). There the header takes the whole line and the
// toolbar rises above the row's top edge, over the end of the row before, as
// Slack's does, so it never covers the name or the time.
const NARROW_ROW = '@container message (width < 464px)'

/**
 * Where a narrow row's toolbar goes, decided once as the row is pointed at or
 * focused (never per frame). It rises above the row unless that would put it
 * under the header band at the list's top, where the band's fade washes it
 * out; there it drops inside the row, under the name and time line so they
 * stay readable, or at the top of a continuation row, which has no such line.
 * The answer is a custom property on the row, so nothing re-renders.
 */
function placeToolbar(row: HTMLElement): void {
  const scroller = row.closest('[data-scroll-area]')
  if (scroller === null) return
  const rowTop = row.getBoundingClientRect().top
  const style = getComputedStyle(scroller)
  const listTop = scroller.getBoundingClientRect().top + (Number.parseFloat(style.scrollPaddingTop) || 0)
  const toolbarHeight = Number.parseFloat(style.getPropertyValue('--toolbar-height')) || 0
  if (rowTop - toolbarHeight >= listTop) {
    row.style.removeProperty('--row-toolbar-top')
    return
  }
  const header = row.querySelector('[data-message-header]')
  row.style.setProperty('--row-toolbar-top', header === null ? 'var(--space-0-5)' : `${header.getBoundingClientRect().bottom - rowTop}px`)
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
 * opacity and display only, absolutely placed, so showing it never forces a layout. On a row
 * with a toolbar the header keeps its end free, so the toolbar covers the end
 * of the first body line but never the name or the time; in a narrow row it
 * rises above the row's top edge instead. The header is the same height with
 * or without a toolbar, so every list of messages has one rhythm.
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
  active = false,
  confirmingDelete = false,
  editor,
  suggestion,
  onOpenThread,
  onChannel,
  onLink,
  onToggleReaction,
  onSetReaction,
  onFocus,
  onRetry,
  onDiscard,
  onOpenImage,
  onDownload,
  progress,
}: MessageProps) {
  const name = sender?.name ?? message.senderId ?? 'Unknown'
  const hue = sender === undefined ? hueOf(message.senderId ?? message.ts) : hueFor(sender.color, sender.id)
  const header = startsGroup || message.groupStart
  const focus = (event: FocusEvent<HTMLDivElement>) => {
    if (actions !== undefined) placeToolbar(event.currentTarget)
    if (event.target === event.currentTarget) onFocus?.(message.ts)
  }
  const toggle = onToggleReaction === undefined ? undefined : (reaction: string) => onToggleReaction(message.ts, reaction)
  const { pending, clientMsgId } = message
  // A failed send has Retry and Delete draft instead; a deleted or unloaded message has nothing to act on.
  const toolbar =
    actions === undefined || message.kind !== 'message' || pending === 'failed' || editor !== undefined ? undefined : (
      <HoverToolbar
        main={main}
        hasThread={message.thread !== undefined}
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
      data-popover-active={active ? '' : undefined}
      onFocus={focus}
      onPointerEnter={actions === undefined ? undefined : (event) => placeToolbar(event.currentTarget)}
      data-editing={editor === undefined ? undefined : ''}
      {...stylex.props(
        styles.row,
        eager && styles.rowEager,
        header && !flush && styles.rowGroupStart,
        (active || confirmingDelete || editor !== undefined) && styles.rowHeld,
        editor !== undefined && styles.rowEditing,
        message.mentionsMe && styles.rowMention,
      )}
    >
      {suggestion !== undefined && editor === undefined ? (
        <span {...stylex.props(styles.suggestion)}>
          <Surface kind="toolbar" padding="xs" role="group" aria-label="Suggested fix" data-send-suggestion="" sx={styles.suggestionBar}>
            <Text variant="meta" tone="default" as="span" truncate sx={styles.suggestionLabel}>{suggestion.label}</Text>
            <Button variant="ghost" size="sm" onClick={suggestion.onEdit}>Edit</Button>
          </Surface>
        </span>
      ) : null}
      <span data-sender={header ? '' : undefined} {...stylex.props(styles.gutter, !header && styles.gutterContinuation)}>
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
          <span data-message-header="" {...stylex.props(styles.header, actions !== undefined && styles.headerWithToolbar)}>
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
        <Files
          files={message.files}
          onOpenImage={onOpenImage}
          onDownload={onDownload}
          tabbable={tabbable}
          progress={pending === 'sending' ? progress : undefined}
        />
        <Reactions reactions={message.reactions} onToggle={toggle} />
        {message.reactionIssue !== undefined ? <ReactionIssueLine ts={message.ts} issue={message.reactionIssue} onSet={onSetReaction} /> : null}
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
      {toolbar !== undefined && suggestion === undefined ? <span {...stylex.props(styles.toolbar)}>{toolbar}</span> : null}
    </div>
  )
})

/**
 * The user's reaction change Slack has not taken. Refused: what Slack has
 * is shown, with Retry and Dismiss. Waiting long: one quiet line.
 */
function ReactionIssueLine({ ts, issue, onSet }: { readonly ts: string; readonly issue: ReactionIssue; readonly onSet: ((ts: string, name: string, on: boolean) => void) | undefined }) {
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
        {issue.on ? 'Reaction not added.' : 'Reaction not removed.'}
      </Text>{' '}
      <TextButton tone="default" onClick={() => onSet?.(ts, issue.name, issue.on)}>
        Retry
      </TextButton>
      {' · '}
      <TextButton tone="muted" onClick={() => onSet?.(ts, issue.name, !issue.on)}>
        Dismiss
      </TextButton>
    </Text>
  )
}

const styles = stylex.create({
  // Over the end of the row before, as a narrow row's toolbar is, so the
  // message it is about stays readable and nothing reserves space for it.
  suggestion: {
    position: 'absolute',
    top: `calc(-1 * ${layout['--toolbar-height']})`,
    right: spacing['--space-2'],
    zIndex: z['--z-toolbar'],
    display: 'flex',
    maxWidth: '80%',
  },
  suggestionBar: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    minWidth: 0,
  },
  suggestionLabel: {
    paddingInline: spacing['--space-2'],
    minWidth: 0,
    userSelect: 'none',
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
    // Paint containment clips at the row's edge; the raised toolbar of a
    // narrow row (NARROW_ROW) and its shadow paint this far above it. A plain
    // token: Chromium drops overflow-clip-margin given any calc().
    overflowClipMargin: layout['--toolbar-clip-margin'],
    containerName: 'message',
    containerType: 'inline-size',
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
  // The edit field's emoji suggestions open above it, past the row's edge:
  // the one row being edited drops paint containment so they are not clipped.
  rowEditing: {
    contain: 'layout style',
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
  // A continuation row is as tall as its body: the gutter is one body line,
  // with the hover time centred on it, not the avatar's 32px box.
  gutterContinuation: {
    minHeight: 0,
    height: `calc(${text['--text-body-size']} * ${text['--text-body-leading']})`,
    marginTop: 0,
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
  // The toolbar's footprint (inventory 6.5): the name and time stay clear of
  // it. The header is no taller for it, so the toolbar covers the end of the
  // first body line on hover, as on a continuation row. A narrow row gives
  // the whole line to the name, since its toolbar rises above the row.
  headerWithToolbar: {
    paddingInlineEnd: {
      default: layout['--toolbar-reserve'],
      [NARROW_ROW]: 0,
    },
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
  // Top right, over the header line's empty end. In a narrow row it sits on
  // the row's top edge, wholly above it: paint containment would clip it
  // there, so the row's overflow-clip-margin lets it paint.
  toolbar: {
    display: 'var(--row-toolbar-display)',
    position: 'absolute',
    top: {
      default: spacing['--space-0-5'],
      // Raised, unless placeToolbar found the row too near the list's top.
      [NARROW_ROW]: `var(--row-toolbar-top, calc(-1 * ${layout['--toolbar-height']}))`,
    },
    right: spacing['--space-2'],
    zIndex: z['--z-toolbar'],
    opacity: 'var(--row-action-opacity)',
  },
})
