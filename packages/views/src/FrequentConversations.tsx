import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { PickConversation } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, ListRow, OptionGroupLabel, Text } from '@juno/ui'
import { hueFor, initials } from './look'

interface FrequentConversationsProps {
  readonly conversations: ReadonlyArray<PickConversation>
  readonly selected: string | undefined
  readonly onPick: (conversation: PickConversation) => void
}

/** Standard list rows; every destination is a separate Tab stop. */
export function FrequentConversations({ conversations, selected, onPick }: FrequentConversationsProps) {
  return (
    <div {...stylex.props(styles.block)}>
      <OptionGroupLabel>Frequent</OptionGroupLabel>
      <div role="list" aria-label="Frequent conversations">
        {conversations.map(conversation => (
          <div key={conversation.key} role="listitem">
            <ListRow
              minHeight={44}
              divider={false}
              selected={conversation.key === selected}
              leading={<DestinationMark conversation={conversation} />}
              trailing={conversation.kind === 'private' ? <Icon icon={Lock} size={15} /> : undefined}
              onMouseDown={event => { if (event.button === 0 && !event.ctrlKey) event.preventDefault() }}
              onSelect={() => onPick(conversation)}
            >
              <Text variant="ui" truncate>{conversation.name}</Text>
            </ListRow>
          </div>
        ))}
      </div>
    </div>
  )
}

function DestinationMark({ conversation }: { readonly conversation: PickConversation }) {
  const person = conversation.person
  if (person === undefined) return <Icon icon={conversation.kind === 'mpim' ? Users : Hash} size={15} />
  return <Avatar size={20} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarUrl })} />
}

const styles = stylex.create({
  block: {
    width: 'max-content',
    maxWidth: '100%',
    paddingBottom: spacing['--space-3'],
  },
})
