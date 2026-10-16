import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import type { ConversationKind, PickConversation } from '@juno/contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionGroupLabel, OptionList, OptionRow, useOptionListKeys } from '@juno/ui'
import { hueFor, initials, kindIcon } from './look'
import { PickerNoMatch, PickerSearch } from './PickerSearch'
import { relativeTime } from './time'
import type { DestinationPickersProps, PickerName } from './DestinationPickers'

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

/** The highlighted row: the one the pointer or the arrows chose, or the first. */
function useActive(ids: ReadonlyArray<string>): readonly [string | undefined, (id: string) => void] {
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  return [chosen !== undefined && ids.includes(chosen) ? chosen : ids[0], setChosen]
}

export function ConversationList({ query, onQuery, conversations, onPickConversation, onOpen }: DestinationPickersProps) {
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
      <PickerSearch query={query} onQuery={onQuery} placeholder="Search people and channels" onKeyDown={onKeyDown} activeId={activeId} />
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
          {conversations !== undefined && rows.length === 0 ? <PickerNoMatch /> : null}
        </OptionList>
      </div>
    </>
  )
}

export function ThreadList({ query, onQuery, conversation, threads, now, onPickThread, onOpen }: DestinationPickersProps) {
  const main = conversation !== undefined && 'main'.startsWith(query.trim().toLowerCase())
  const rows = threads ?? []
  const ids = [...(main ? [MAIN_ID] : []), ...rows.map((row) => rowId('thread', row.id))]
  const [activeId, setActive] = useActive(ids)
  const pick = (id: string) => (id === MAIN_ID ? onPickThread(undefined) : onPickThread(rows[ids.indexOf(id) - (main ? 1 : 0)]))
  const onKeyDown = useOptionListKeys({ ids, activeId, onActiveChange: setActive, onSelect: pick, onClose: () => onOpen(undefined) })
  return (
    <>
      <PickerSearch query={query} onQuery={onQuery} placeholder="Search threads" onKeyDown={onKeyDown} activeId={activeId} />
      <div {...stylex.props(styles.scroll)}>
        <OptionList label="Threads" {...(activeId === undefined ? {} : { activeId })}>
          {conversation === undefined ? <OptionGroupLabel>Recent threads</OptionGroupLabel> : null}
          {main ? (
            <OptionRow
              id={MAIN_ID}
              size={44}
              active={activeId === MAIN_ID}
              label="Main"
              sub="Messages outside threads"
              subPlacement="below"
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
          {threads !== undefined && ids.length === 0 ? <PickerNoMatch /> : null}
        </OptionList>
      </div>
    </>
  )
}

/** A person's avatar, or the conversation's kind icon. */
function ConversationMark({ conversation }: { readonly conversation: PickConversation }) {
  const person = conversation.person
  if (person === undefined) return <Icon icon={kindIcon(conversation.kind)} size={15} />
  return <Avatar size={20} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
}

const styles = stylex.create({
  scroll: {
    maxHeight: layout['--destination-list-max-height'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: spacing['--space-1-5'],
  },
})
