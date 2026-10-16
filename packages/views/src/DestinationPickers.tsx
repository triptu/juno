import * as stylex from '@stylexjs/stylex'
import { At } from '@phosphor-icons/react/dist/icons/At'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { ChatText } from '@phosphor-icons/react/dist/icons/ChatText'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useEffect, type KeyboardEvent, type ReactNode } from 'react'
import type { ConversationKind, PickConversation, PickConversations, PickThread } from '@juno/contract'
import { accent, colors, motion, radii, sizes, spacing, text, tints } from '@juno/tokens/tokens.stylex'
import { chunk, Icon, Popover, type PhosphorIcon } from '@juno/ui'

const lists = chunk(() => import('./DestinationLists'))
const loadLists = lists.load
const ConversationList = lists.component((module) => module.ConversationList)
const ThreadList = lists.component((module) => module.ThreadList)

export type PickerName = 'conversation' | 'thread'

export interface DestinationPickersProps {
  readonly conversation: PickConversation | undefined
  /** A thread in the conversation; none is Main. */
  readonly thread: PickThread | undefined
  /** The picker whose list is open. */
  readonly open: PickerName | undefined
  readonly onOpen: (picker: PickerName | undefined) => void
  /** The open list's search text. */
  readonly query: string
  readonly onQuery: (query: string) => void
  /** The conversation list's sections; undefined while they load. */
  readonly conversations: PickConversations | undefined
  /** The thread list's rows (Main is added here); undefined while they load. */
  readonly threads: ReadonlyArray<PickThread> | undefined
  readonly now: number
  readonly onPickConversation: (conversation: PickConversation) => void
  /** A thread, or Main with `undefined`. */
  readonly onPickThread: (thread: PickThread | undefined) => void
}

const kindIcons: Record<ConversationKind, PhosphorIcon> = { public: Hash, private: Lock, im: User, mpim: Users }

/**
 * New chat's two pickers (spec section 9, inventory 8), on one row above
 * the composer. The conversation button takes the context pill's tint and
 * icon once a conversation is picked; the thread button says Main, the
 * thread's title, or "Any thread" before a conversation is picked. Each
 * opens a searchable list above itself: typing filters, ↑ ↓ move, Enter
 * picks, Esc closes and puts focus back on the button.
 */
export function DestinationPickers(props: DestinationPickersProps) {
  useEffect(() => {
    const idle = requestIdleCallback(() => void loadLists(), { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  const { conversation, thread, open, onOpen } = props
  const conversationLabel = conversation?.name ?? 'Pick a conversation'
  const threadLabel = thread?.title ?? (conversation === undefined ? 'Any thread' : 'Main')
  return (
    <div role="group" aria-label="Destination" {...stylex.props(styles.row)}>
      <Popover
        open={open === 'conversation'}
        onClose={() => onOpen(undefined)}
        placement="top-start"
        width="picker"
        maxHeight="none"
        layer="picker"
        padding="none"
        label="Pick a conversation"
        anchor={
          <PickerButton
            label={`Conversation: ${conversationLabel}`}
            icon={conversation === undefined ? At : kindIcons[conversation.kind]}
            tint={conversation?.tint}
            expanded={open === 'conversation'}
            onOpen={() => onOpen(open === 'conversation' ? undefined : 'conversation')}
          >
            {conversationLabel}
          </PickerButton>
        }
      >
        {open === 'conversation' ? <ConversationList {...props} /> : null}
      </Popover>
      <Popover
        open={open === 'thread'}
        onClose={() => onOpen(undefined)}
        placement="top-start"
        width="picker"
        maxHeight="none"
        layer="picker"
        padding="none"
        label="Pick a thread"
        anchor={
          <PickerButton
            label={`Thread: ${threadLabel}`}
            icon={thread === undefined && conversation !== undefined ? ChatText : ChatsCircle}
            muted={conversation === undefined}
            wide
            expanded={open === 'thread'}
            onOpen={() => onOpen(open === 'thread' ? undefined : 'thread')}
          >
            {threadLabel}
          </PickerButton>
        }
      >
        {open === 'thread' ? <ThreadList {...props} /> : null}
      </Popover>
    </div>
  )
}

interface PickerButtonProps {
  readonly label: string
  readonly icon: PhosphorIcon
  /** A picked conversation's context tint. */
  readonly tint?: PickConversation['tint'] | undefined
  /** Nothing picked: subtle text. Default: no tint. */
  readonly muted?: boolean
  /** The thread title may run longer before it takes an ellipsis. */
  readonly wide?: boolean
  readonly expanded: boolean
  readonly onOpen: () => void
  readonly children: ReactNode
}

function PickerButton({ label, icon, tint, muted, wide = false, expanded, onOpen, children }: PickerButtonProps) {
  const subtle = muted ?? tint === undefined
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' || expanded) return
    event.preventDefault()
    onOpen()
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onPointerEnter={() => void loadLists()}
      onFocus={() => void loadLists()}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      {...stylex.props(styles.button, tint === undefined ? (subtle ? styles.unset : styles.plain) : tintStyles[tint])}
    >
      <Icon icon={icon} size={13} />
      <span {...stylex.props(styles.buttonLabel, wide && styles.buttonLabelWide)}>{children}</span>
      <span {...stylex.props(styles.caret)}>
        <Icon icon={CaretDown} size={12} />
      </span>
    </button>
  )
}

/** The longest a thread title runs in its button before the ellipsis. */
const THREAD_LABEL_MAX = '260px'


const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    height: sizes['--control-28'],
    minWidth: 0,
    paddingInlineStart: spacing['--space-2-5'],
    paddingInlineEnd: spacing['--space-2'],
    borderWidth: 0,
    borderRadius: radii['--radius-pill'],
    fontFamily: text['--text-pill-family'],
    fontSize: text['--text-pill-size'],
    fontWeight: text['--text-pill-weight'],
    lineHeight: text['--text-pill-leading'],
    whiteSpace: 'nowrap',
    cursor: 'default',
    userSelect: 'none',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
    transform: { default: 'none', ':active': `scale(${motion['--press-scale']})` },
    transitionProperty: 'transform',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
  },
  unset: {
    color: colors['--foreground-subtle'],
    backgroundColor: { default: colors['--secondary-default'], ':hover': { default: null, '@media (hover: hover)': colors['--secondary-hover'] } },
  },
  plain: {
    color: colors['--foreground-default'],
    backgroundColor: { default: colors['--secondary-default'], ':hover': { default: null, '@media (hover: hover)': colors['--secondary-hover'] } },
  },
  buttonLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
  buttonLabelWide: {
    maxWidth: THREAD_LABEL_MAX,
  },
  caret: {
    display: 'inline-flex',
    color: colors['--foreground-muted'],
  },
})

const tintStyles = stylex.create({
  public: { color: tints['--tint-public-fg'], backgroundColor: tints['--tint-public-bg'] },
  private: { color: tints['--tint-private-fg'], backgroundColor: tints['--tint-private-bg'] },
  dm: { color: tints['--tint-dm-fg'], backgroundColor: tints['--tint-dm-bg'] },
})

