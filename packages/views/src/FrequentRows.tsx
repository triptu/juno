import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { PickConversation } from '@juno/contract'
import { Avatar, Icon, ListRow, Text } from '@juno/ui'
import { hueFor, initials } from './look'
import type { FrequentConversationsProps } from './FrequentConversations'

export default function FrequentRows({ conversations, selected, onPick }: FrequentConversationsProps) {
  return (
    <>
      {conversations.map(conversation => (
        <div key={conversation.key} role="listitem">
          <ListRow
            minHeight={32}
            padding="navigation"
            divider={false}
            selected={conversation.key === selected}
            leading={<DestinationMark conversation={conversation} />}
            onMouseDown={event => { if (event.button === 0 && !event.ctrlKey) event.preventDefault() }}
            onSelect={() => onPick(conversation)}
          >
            <Text variant="ui" truncate><span data-frequent-name="">{conversation.name}</span></Text>
            {conversation.kind === 'private' ? <Icon icon={Lock} size={13} /> : null}
          </ListRow>
        </div>
      ))}
    </>
  )
}

function DestinationMark({ conversation }: { readonly conversation: PickConversation }) {
  const person = conversation.person
  if (person === undefined) return <Icon icon={conversation.kind === 'mpim' ? Users : Hash} size={15} />
  return <Avatar size={20} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
}
