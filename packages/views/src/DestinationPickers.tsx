import * as stylex from '@stylexjs/stylex'
import { At } from '@phosphor-icons/react/dist/icons/At'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { ChatsCircle } from '@phosphor-icons/react/dist/icons/ChatsCircle'
import { ChatText } from '@phosphor-icons/react/dist/icons/ChatText'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ConversationKind, PickConversation, PickConversations, PickThread } from '@juno/contract'
import { accent, colors, motion, radii, sizes, spacing, text, tints } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionGroupLabel, OptionList, OptionRow, Popover, Text, useOptionListKeys, type PhosphorIcon } from '@juno/ui'
import { hueFor, initials } from './look'
import { relativeTime } from './time'

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

const kindLabels: Record<ConversationKind, string> = {
  public: 'Public channel',
  private: 'Private channel',
  im: 'Direct message',
  mpim: 'Group DM',
}

/** The line at the end of a conversation row. */
const conversationSub = (conversation: PickConversation): string =>
  conversation.kind === 'im' && conversation.empty ? 'No messages yet' : kindLabels[conversation.kind]

/** "#eng", "Maya Chen": where a thread lives, in its row's meta line. */
const placeLabel = (conversation: PickConversation): string =>
  conversation.kind === 'public' || conversation.kind === 'private' ? `#${conversation.name}` : conversation.name

const replies = (count: number) => (count === 1 ? '1 reply' : `${count} replies`)

const MAIN_ID = 'pick-main'
const rowId = (picker: PickerName, key: string) => `pick-${picker}-${key}`

/**
 * New chat's two pickers (spec section 9, inventory 8), on one row above
 * the composer. The conversation button takes the context pill's tint and
 * icon once a conversation is picked; the thread button says Main, the
 * thread's title, or "Any thread" before a conversation is picked. Each
 * opens a searchable list above itself: typing filters, ↑ ↓ move, Enter
 * picks, Esc closes and puts focus back on the button.
 */
export function DestinationPickers(props: DestinationPickersProps) {
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
  /** Nothing picked: subtle text. */
  readonly muted?: boolean
  /** The thread title may run longer before it takes an ellipsis. */
  readonly wide?: boolean
  readonly expanded: boolean
  readonly onOpen: () => void
  readonly children: ReactNode
}

function PickerButton({ label, icon, tint, muted = tint === undefined, wide = false, expanded, onOpen, children }: PickerButtonProps) {
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
      onClick={onOpen}
      onKeyDown={onKeyDown}
      {...stylex.props(styles.button, tint === undefined ? (muted ? styles.unset : styles.plain) : tintStyles[tint])}
    >
      <Icon icon={icon} size={13} />
      <span {...stylex.props(styles.buttonLabel, wide && styles.buttonLabelWide)}>{children}</span>
      <span {...stylex.props(styles.caret)}>
        <Icon icon={CaretDown} size={12} />
      </span>
    </button>
  )
}

/** The search field at the top of an open list, and the keys that drive the list. */
function SearchField({ query, onQuery, placeholder, onKeyDown, activeId }: {
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly placeholder: string
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  readonly activeId: string | undefined
}) {
  return (
    <label {...stylex.props(styles.search)}>
      <span {...stylex.props(styles.searchIcon)}>
        <Icon icon={MagnifyingGlass} size={14} />
      </span>
      <input
        autoFocus
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-activedescendant={activeId}
        onChange={(event) => onQuery(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        {...stylex.props(styles.searchInput)}
      />
    </label>
  )
}

/** The highlighted row: the one the pointer or the arrows chose, or the first. */
function useActive(ids: ReadonlyArray<string>): readonly [string | undefined, (id: string) => void] {
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  return [chosen !== undefined && ids.includes(chosen) ? chosen : ids[0], setChosen]
}

function ConversationList({ query, onQuery, conversations, onPickConversation, onOpen }: DestinationPickersProps) {
  const sections: ReadonlyArray<readonly [string, ReadonlyArray<PickConversation>]> =
    conversations === undefined
      ? []
      : [
          ['Recent', conversations.recent],
          ['People', conversations.people],
          ['Channels', conversations.channels],
        ]
  const rows = sections.flatMap(([, items]) => items)
  const ids = rows.map((row) => rowId('conversation', row.key))
  const [activeId, setActive] = useActive(ids)
  const pick = (id: string) => {
    const row = rows[ids.indexOf(id)]
    if (row !== undefined) onPickConversation(row)
  }
  const onKeyDown = useOptionListKeys({ ids, activeId, onActiveChange: setActive, onSelect: pick, onClose: () => onOpen(undefined) })
  return (
    <>
      <SearchField query={query} onQuery={onQuery} placeholder="Search people and channels" onKeyDown={onKeyDown} activeId={activeId} />
      <div {...stylex.props(styles.scroll)}>
        <OptionList label="Conversations" {...(activeId === undefined ? {} : { activeId })}>
          {sections.map(([title, items]) =>
            items.length === 0 ? null : (
              <div key={title} role="group" aria-label={title}>
                <OptionGroupLabel>{title}</OptionGroupLabel>
                {items.map((row) => {
                  const id = rowId('conversation', row.key)
                  return (
                    <OptionRow
                      key={id}
                      id={id}
                      size={36}
                      active={id === activeId}
                      leading={<ConversationMark conversation={row} />}
                      label={row.name}
                      sub={conversationSub(row)}
                      onSelect={() => onPickConversation(row)}
                      onActivate={() => setActive(id)}
                    />
                  )
                })}
              </div>
            ),
          )}
          {conversations !== undefined && rows.length === 0 ? <NoMatch /> : null}
        </OptionList>
      </div>
    </>
  )
}

function ThreadList({ query, onQuery, conversation, threads, now, onPickThread, onOpen }: DestinationPickersProps) {
  const main = conversation !== undefined && 'main'.startsWith(query.trim().toLowerCase())
  const rows = threads ?? []
  const ids = [...(main ? [MAIN_ID] : []), ...rows.map((row) => rowId('thread', row.id))]
  const [activeId, setActive] = useActive(ids)
  const pick = (id: string) => (id === MAIN_ID ? onPickThread(undefined) : onPickThread(rows[ids.indexOf(id) - (main ? 1 : 0)]))
  const onKeyDown = useOptionListKeys({ ids, activeId, onActiveChange: setActive, onSelect: pick, onClose: () => onOpen(undefined) })
  return (
    <>
      <SearchField query={query} onQuery={onQuery} placeholder="Search threads" onKeyDown={onKeyDown} activeId={activeId} />
      <div {...stylex.props(styles.scroll)}>
        <OptionList label="Threads" {...(activeId === undefined ? {} : { activeId })}>
          {conversation === undefined ? <OptionGroupLabel>Recent threads</OptionGroupLabel> : null}
          {main ? (
            <OptionRow
              id={MAIN_ID}
              size={44}
              active={activeId === MAIN_ID}
              leading={<Icon icon={ChatText} size={15} />}
              label="Main"
              sub="Messages outside threads"
              onSelect={() => onPickThread(undefined)}
              onActivate={() => setActive(MAIN_ID)}
            />
          ) : null}
          {rows.map((row) => {
            const id = rowId('thread', row.id)
            const meta = [...(conversation === undefined ? [placeLabel(row.conversation)] : []), replies(row.replyCount), relativeTime(row.lastActivityAt, now)].join(' · ')
            return (
              <OptionRow
                key={id}
                id={id}
                size={44}
                active={id === activeId}
                label={row.title}
                sub={meta}
                subPlacement="below"
                onSelect={() => onPickThread(row)}
                onActivate={() => setActive(id)}
              />
            )
          })}
          {threads !== undefined && ids.length === 0 ? <NoMatch /> : null}
        </OptionList>
      </div>
    </>
  )
}

function NoMatch() {
  return (
    <Text variant="ui" tone="muted" as="div" sx={styles.noMatch}>
      No match.
    </Text>
  )
}

/** A person's avatar, or the conversation's kind icon. */
function ConversationMark({ conversation }: { readonly conversation: PickConversation }) {
  const person = conversation.person
  if (person === undefined) return <Icon icon={kindIcons[conversation.kind]} size={15} />
  return <Avatar size={20} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarUrl })} />
}

/** The longest a thread title runs in its button before the ellipsis. */
const THREAD_LABEL_MAX = '260px'
/** The open list's height before it scrolls. */
const LIST_MAX_HEIGHT = '360px'

const HOVER = '@media (hover: hover)'

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
    outlineColor: accent['--focus-ring'],
    transform: { default: 'none', ':active': `scale(${motion['--press-scale']})` },
    transitionProperty: 'transform, filter',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    filter: { default: 'none', ':hover': { default: null, [HOVER]: 'brightness(0.97)' } },
  },
  unset: {
    color: colors['--foreground-subtle'],
    backgroundColor: colors['--secondary-default'],
  },
  plain: {
    color: colors['--foreground-default'],
    backgroundColor: colors['--secondary-default'],
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
  search: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    cursor: 'text',
  },
  searchIcon: {
    display: 'inline-flex',
    color: colors['--foreground-muted'],
  },
  searchInput: {
    flexGrow: 1,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors['--foreground-default'],
    fontFamily: text['--text-ui-family'],
    fontSize: text['--text-ui-size'],
    outline: 'none',
    '::placeholder': { color: colors['--foreground-muted'], opacity: 1 },
  },
  scroll: {
    maxHeight: LIST_MAX_HEIGHT,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: spacing['--space-1-5'],
  },
  noMatch: {
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-2-5'],
  },
})

const tintStyles = stylex.create({
  public: { color: tints['--tint-public-fg'], backgroundColor: tints['--tint-public-bg'] },
  private: { color: tints['--tint-private-fg'], backgroundColor: tints['--tint-private-bg'] },
  dm: { color: tints['--tint-dm-fg'], backgroundColor: tints['--tint-dm-bg'] },
})

