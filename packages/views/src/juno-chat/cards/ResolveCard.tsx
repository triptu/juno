import * as stylex from '@stylexjs/stylex'
import { chatCopy, type ResolveCard as ResolveCardModel, type TopicLink } from '@juno/agent-contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Icon, Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { ChatCard, placeIcon } from './ChatCard'

export interface ResolveCardProps {
  readonly card: ResolveCardModel
  readonly actions: ChatActions
}

/** The topics Juno proposes to resolve. Resolve or Dismiss; afterwards "Resolved 3 · Undo" from the status line. */
export function ResolveCard({ card, actions }: ResolveCardProps) {
  const copy = chatCopy.card.resolve
  return (
    <ChatCard
      id={card.id}
      kind="resolve"
      actions={actions}
      status={card.status}
      because={card.because}
      dismiss
      buttons={
        <Button variant="secondary" size="md" onClick={() => actions.onCard(card.id, { _tag: 'resolve' })}>
          {copy.resolve}
        </Button>
      }
    >
      <Text variant="meta" tone="muted">
        {copy.title(card.topics.length)}
      </Text>
      <TopicRows topics={card.topics} />
    </ChatCard>
  )
}

/** The plain topic rows a Resolve card lists: icon, title, where. Not links. */
export function TopicRows({ topics }: { readonly topics: ReadonlyArray<TopicLink> }) {
  return (
    <ul {...stylex.props(styles.list)}>
      {topics.map((topic) => (
        <li key={topic.topicId} {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.icon)}>
            <Icon icon={placeIcon(topic.tint)} size={13} />
          </span>
          <Text variant="preview" tone="default" truncate dir="auto">
            {topic.title}
          </Text>
          <Text variant="tagSmall" tone="muted" truncate sx={styles.where}>
            {topic.where}
          </Text>
        </li>
      ))}
    </ul>
  )
}

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  icon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  where: {
    flexShrink: 0,
    maxWidth: '40%',
  },
})
