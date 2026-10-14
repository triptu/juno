import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { chatCopy, type RemoveCard as RemoveCardModel } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { fullTime, messageTime } from '../../time'
import { ChatCard, DangerGhost } from './ChatCard'

export interface RemoveCardProps {
  readonly card: RemoveCardModel
  readonly actions: ChatActions
  readonly now: number
  readonly enter?: boolean
}

/**
 * A removal Juno proposes: the messages, "Also remove Juno's reply" when
 * offered, and the line that copies already sent cannot be recalled.
 * Remove or Keep; afterwards "Removed 2 messages" from the status line.
 */
export function RemoveCard({ card, actions, now, enter }: RemoveCardProps) {
  const [alsoReply, setAlsoReply] = useState(false)
  const copy = chatCopy.card.remove
  return (
    <ChatCard
      id={card.id}
      kind="remove"
      actions={actions}
      enter={enter}
      status={card.status}
      because={card.because}
      buttons={
        <>
          <DangerGhost onClick={() => actions.onCard(card.id, { _tag: 'remove', alsoReply })}>{copy.remove}</DangerGhost>
          <Button variant="secondary" size="md" onClick={() => actions.onCard(card.id, { _tag: 'dismiss' })}>
            {copy.keep}
          </Button>
        </>
      }
    >
      <RemoveRows messages={card.messages} now={now} />
      {card.offerReply !== undefined ? <Checkbox label={copy.alsoReply} checked={alsoReply} onChange={(event) => setAlsoReply(event.currentTarget.checked)} disabled={card.status._tag !== 'open'} /> : null}
      <Text variant="meta" tone="muted" as="p">
        {copy.cannotRecall}
      </Text>
    </ChatCard>
  )
}

/** The messages a removal covers: the first line of each and its time. Shared with the Remove sheet. */
export function RemoveRows({ messages, now }: { readonly messages: RemoveCardModel['messages']; readonly now: number }) {
  return (
    <ul {...stylex.props(styles.rows)}>
      {messages.map((message) => (
        <li key={message.messageId} {...stylex.props(styles.row)}>
          <Text variant="preview" tone="default" truncate dir="auto">
            {message.preview}
          </Text>
          <Text variant="tagSmall" tone="muted" numeric as="time" title={fullTime(message.at)} sx={styles.time}>
            {messageTime(message.at, now)}
          </Text>
        </li>
      ))}
    </ul>
  )
}

const styles = stylex.create({
  rows: {
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
  time: {
    flexShrink: 0,
  },
})
