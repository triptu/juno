import { chatCopy, type BudgetCard as BudgetCardModel } from '@juno/agent-contract'
import { Button, Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { ChatCard } from './ChatCard'

export interface BudgetCardProps {
  readonly card: BudgetCardModel
  readonly actions: ChatActions
}

/** Today's spend against the cap. Allow $1 more today, or wait; afterwards "Allowed until midnight". */
export function BudgetCard({ card, actions }: BudgetCardProps) {
  const copy = chatCopy.card.budget
  return (
    <ChatCard
      id={card.id}
      kind="budget"
      actions={actions}
      status={card.status}
      because={card.because}
      buttons={
        <>
          <Button variant="secondary" size="md" onClick={() => actions.onCard(card.id, { _tag: 'allow' })}>
            {copy.allow}
          </Button>
          <Button variant="ghost" size="md" tone="subtle" onClick={() => actions.onCard(card.id, { _tag: 'dismiss' })}>
            {copy.wait}
          </Button>
        </>
      }
    >
      <Text variant="bodySmall" tone="default">
        {copy.title}
      </Text>
      <Text variant="meta" tone="muted" numeric>
        {copy.spent(card.spentTodayUsd, card.capUsd)}
      </Text>
    </ChatCard>
  )
}
