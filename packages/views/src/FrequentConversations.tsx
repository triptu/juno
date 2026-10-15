import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { PickConversation } from '@juno/contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, ListRow, Text } from '@juno/ui'
import { hueFor, initials } from './look'

interface FrequentConversationsProps {
  readonly conversations: ReadonlyArray<PickConversation>
  readonly selected: string | undefined
  readonly onPick: (conversation: PickConversation) => void
}

/** Standard list rows; every destination is a separate Tab stop. */
export function FrequentConversations({ conversations, selected, onPick }: FrequentConversationsProps) {
  return (
    <div data-frequent-block="" {...stylex.props(styles.block)}>
      <Text variant="sectionLabel" tone="muted" as="div" sx={styles.label}>Frequent</Text>
      <div role="list" aria-label="Frequent conversations">
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
      </div>
      <Text variant="body" tone="muted" as="div" sx={styles.hint}>Write your message, then pick where it goes.</Text>
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
    width: layout['--sidebar-width'],
    maxWidth: '100%',
  },
  label: {
    paddingInline: spacing['--space-3'],
    paddingBottom: spacing['--space-1'],
  },
  hint: {
    paddingInline: spacing['--space-3'],
    paddingTop: spacing['--space-3'],
  },
})
