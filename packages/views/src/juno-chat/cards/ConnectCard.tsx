import * as stylex from '@stylexjs/stylex'
import { chatCopy, type ConnectCard as ConnectCardModel } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Chip, Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { ChatCard } from './ChatCard'

export interface ConnectCardProps {
  readonly card: ConnectCardModel
  readonly actions: ChatActions
  readonly enter?: boolean
}

/** A server to connect: its name, the scopes as tags, and one line on what leaves the machine. Connect or Skip. */
export function ConnectCard({ card, actions, enter }: ConnectCardProps) {
  const copy = chatCopy.card.connect
  return (
    <ChatCard
      id={card.id}
      kind="connect"
      actions={actions}
      enter={enter}
      source={<Text variant="meta" tone="muted" truncate>{card.server}</Text>}
      status={card.status}
      because={card.because}
      buttons={
        <>
          <Button variant="ghost" size="md" tone="subtle" onClick={() => actions.onCard(card.id, { _tag: 'dismiss' })}>
            {copy.skip}
          </Button>
          <Button variant="secondary" size="md" onClick={() => actions.onCard(card.id, { _tag: 'connect' })}>
            {copy.connect}
          </Button>
        </>
      }
    >
      <Text variant="bodySmall" weight="medium" tone="default">
        {card.server}
      </Text>
      {card.scopes.length > 0 ? (
        <div {...stylex.props(styles.scopes)}>
          {card.scopes.map((scope) => (
            <Chip key={scope} variant="filled" size={18}>
              {scope}
            </Chip>
          ))}
        </div>
      ) : null}
      <Text variant="meta" tone="muted" as="p">
        {card.leaves}
      </Text>
    </ChatCard>
  )
}

const styles = stylex.create({
  scopes: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-1'],
  },
})
