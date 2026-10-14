import { chatCopy, type UnknownCard as UnknownCardModel } from '@juno/agent-contract'
import { Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { ChatCard } from './ChatCard'

export interface UnknownCardProps {
  readonly card: UnknownCardModel
  readonly actions: ChatActions
  readonly enter?: boolean
}

/** A card kind this build does not know: one line, no buttons. */
export function UnknownCard({ card, actions, enter }: UnknownCardProps) {
  return (
    <ChatCard id={card.id} kind="unknown" actions={actions} enter={enter} footer={false}>
      <Text variant="meta" tone="muted" as="p" data-unknown-kind={card.kind}>
        {chatCopy.card.unknownKind}
      </Text>
    </ChatCard>
  )
}
