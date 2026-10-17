import * as stylex from '@stylexjs/stylex'
import { Globe } from '@phosphor-icons/react/dist/icons/Globe'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ConversationKind, PickConversation, PickConversations } from '@juno/contract'
import { layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionGroupLabel, OptionList, OptionRow, SparkleDuotone, useOptionListKeys } from '@juno/ui'
import { Highlighted } from './Highlighted'
import { hueFor, initials, kindIcon } from './look'
import { PickerNoMatch, PickerSearch } from './PickerSearch'

const kindLabels: Record<ConversationKind, string> = {
  public: 'Public channel',
  private: 'Private channel',
  im: 'Direct message',
  mpim: 'Group DM',
}

/** The line at the end of a conversation row. */
const conversationSub = (conversation: PickConversation): string =>
  conversation.kind === 'im' && conversation.empty ? 'No messages yet' : kindLabels[conversation.kind]

const ANYWHERE_ID = 'pick-anywhere' as const
const JUNO_ID = 'pick-juno' as const
const rowId = (key: string) => `pick-conversation-${key}`

/**
 * Enter while the rows for the typed query are still loading (none yet, or
 * an earlier query's still shown) picks the first row once they land, so a name typed and entered at once is not lost. Typing
 * again drops the waiting Enter.
 */
function usePendingEnter(loading: boolean, ids: ReadonlyArray<string>, pick: (id: string) => void, onKeyDown: (event: KeyboardEvent<HTMLElement>) => void, onQuery: (query: string) => void) {
  const pending = useRef(false)
  useEffect(() => {
    if (!pending.current || loading) return
    pending.current = false
    if (ids[0] !== undefined) pick(ids[0])
  }, [loading, ids, pick])
  return {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Enter' && loading) {
        event.preventDefault()
        pending.current = true
        return
      }
      onKeyDown(event)
    },
    onQuery: (query: string) => {
      pending.current = false
      onQuery(query)
    },
  }
}

/** The highlighted row: the one the pointer or the arrows chose, or the first. */
function useActive(ids: ReadonlyArray<string>): readonly [string | undefined, (id: string) => void] {
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  return [chosen !== undefined && ids.includes(chosen) ? chosen : ids[0], setChosen]
}

export interface ConversationListProps {
  /** The search text. */
  readonly query: string
  readonly onQuery: (query: string) => void
  /** The sections; undefined while they load. */
  readonly conversations: PickConversations | undefined
  readonly onPickConversation: (conversation: PickConversation) => void
  readonly loading?: boolean | undefined
  readonly onClose: () => void
  /** An Anywhere row first, which clears a place filter (All topics). It shows while the query is empty or starts "anywhere". */
  readonly onAnywhere?: () => void
  /** A Juno row first, Home's default destination. It shows while the query is empty or starts "juno". */
  readonly onJuno?: () => void
  /** The current row: with `onAnywhere` the place's channel id (none is Anywhere), with `onJuno` a conversation's key or `juno`. */
  readonly selected?: string | undefined
}

export function ConversationList({ query, onQuery, conversations, loading = false, onPickConversation, onClose, onAnywhere, onJuno, selected }: ConversationListProps) {
  const sections: ReadonlyArray<readonly [string, ReadonlyArray<PickConversation>]> =
    conversations === undefined
      ? []
      : [
          ['Recent', conversations.recent],
          ['People', conversations.people],
          ['Channels', conversations.channels],
        ]
  const rows = sections.flatMap(([, items]) => items)
  const typed = query.trim().toLowerCase()
  const showAnywhere = onAnywhere !== undefined && 'anywhere'.startsWith(typed)
  const showJuno = onJuno !== undefined && 'juno'.startsWith(typed)
  const first = showAnywhere ? [ANYWHERE_ID] : showJuno ? [JUNO_ID] : []
  const ids = [...first, ...rows.map((row) => rowId(row.key))]
  const [activeId, setActive] = useActive(ids)
  const pick = (id: string) => {
    if (id === ANYWHERE_ID) return onAnywhere?.()
    if (id === JUNO_ID) return onJuno?.()
    const row = rows[ids.indexOf(id) - first.length]
    if (row !== undefined) onPickConversation(row)
  }
  const keys = useOptionListKeys({ ids, activeId, onActiveChange: setActive, onSelect: pick, onClose })
  const search = usePendingEnter(loading || conversations === undefined, ids, pick, keys, onQuery)
  return (
    <>
      <PickerSearch query={query} onQuery={search.onQuery} placeholder="Search people and channels" onKeyDown={search.onKeyDown} activeId={activeId} />
      <div {...stylex.props(styles.scroll)}>
        <OptionList label="Conversations" {...(activeId === undefined ? {} : { activeId })}>
          {showAnywhere && onAnywhere !== undefined ? <FirstRow id={ANYWHERE_ID} activeId={activeId} selected={selected === undefined} onSelect={onAnywhere} onActivate={setActive} /> : null}
          {showJuno && onJuno !== undefined ? <FirstRow id={JUNO_ID} activeId={activeId} selected={selected === 'juno'} onSelect={onJuno} onActivate={setActive} /> : null}
          {sections.map(([title, items]) =>
            items.length === 0 ? null : (
              <div key={title} role="group" aria-label={title}>
                <OptionGroupLabel>{title}</OptionGroupLabel>
                {items.map((row) => {
                  const id = rowId(row.key)
                  return (
                    <OptionRow
                      key={id}
                      id={id}
                      size={36}
                      active={id === activeId}
                      selected={onJuno !== undefined ? row.key === selected : onAnywhere !== undefined && row.channelId !== undefined && row.channelId === selected}
                      leading={<ConversationMark conversation={row} />}
                      label={<Highlighted text={row.name} ranges={row.highlight} />}
                      sub={conversationSub(row)}
                      onSelect={() => onPickConversation(row)}
                      onActivate={() => setActive(id)}
                    />
                  )
                })}
              </div>
            ),
          )}
          {conversations !== undefined && ids.length === 0 ? <PickerNoMatch /> : null}
        </OptionList>
      </div>
    </>
  )
}

/** The row before the conversations: Anywhere (All topics' place filter) or Juno (Home's destination). */
function FirstRow({ id, activeId, selected, onSelect, onActivate }: { readonly id: typeof ANYWHERE_ID | typeof JUNO_ID; readonly activeId: string | undefined; readonly selected: boolean; readonly onSelect: () => void; readonly onActivate: (id: string) => void }) {
  const juno = id === JUNO_ID
  return (
    <OptionRow
      id={id}
      size={36}
      active={activeId === id}
      selected={selected}
      leading={<span {...stylex.props(styles.mark)}>{juno ? <Icon icon={SparkleDuotone} size={15} /> : <Icon icon={Globe} size={15} />}</span>}
      label={juno ? 'Juno' : 'Anywhere'}
      {...(juno ? { sub: 'Ask Juno' } : {})}
      onSelect={onSelect}
      onActivate={() => onActivate(id)}
    />
  )
}

/** A face or the kind's icon, in a slot as wide as the face, so every name starts on one edge. */
function ConversationMark({ conversation }: { readonly conversation: PickConversation }) {
  const person = conversation.person
  if (person === undefined)
    return (
      <span {...stylex.props(styles.mark)}>
        <Icon icon={kindIcon(conversation.kind)} size={15} />
      </span>
    )
  return <Avatar size={20} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
}

const styles = stylex.create({
  mark: {
    display: 'inline-flex',
    justifyContent: 'center',
    width: sizes['--avatar-20'],
  },
  scroll: {
    maxHeight: layout['--destination-list-max-height'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: spacing['--space-1-5'],
  },
})
