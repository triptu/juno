import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import { chatCopy, type Delivery, type OwnerMessageItem } from '@juno/agent-contract'
import { chat, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'
import type { ChatActions } from './commands'
import { QuoteStub } from './QuoteStub'
import { ReactionBadge } from './ReactionBadge'
import { groupGap, isGroupEnd, rowStyles } from './rows'
import { TextButton } from './TextButton'
import { fullTime, messageTime } from '../time'

export interface OwnerBubbleProps {
  readonly item: OwnerMessageItem
  readonly now: number
  readonly actions: ChatActions
}

/**
 * The owner's bubble (inventory 12): right-aligned in the owner fill, the
 * tail on the last of a group, the time on hover to its left, and the
 * delivery line in the fixed slot under the group's last bubble. A reply
 * shows its quote above; Juno's reaction sits on the top corner, out of
 * flow. A message sent while Juno works looks like any other. The fill
 * and text come from the `chat` token group, so the owner's colour choice
 * is a token change.
 */
export const OwnerBubble = memo(function OwnerBubble({ item, now, actions }: OwnerBubbleProps) {
  const end = isGroupEnd(item.group)
  const menu = actions.onContextMenu
  const replyTo = item.replyTo
  return (
    <div data-chat-owner={item.opId} {...stylex.props(groupGap[item.group], styles.root)}>
      {replyTo !== undefined ? (
        <div {...stylex.props(styles.quote)}>
          <QuoteStub quote={replyTo} onOpen={() => actions.onQuote(replyTo.target)} />
        </div>
      ) : null}
      <div {...stylex.props(rowStyles.row, rowStyles.contained, styles.row)}>
        <Text variant="tag" tone="muted" numeric as="time" title={fullTime(item.at)} sx={rowStyles.time}>
          {messageTime(item.at, now)}
        </Text>
        <div
          onContextMenu={menu === undefined ? undefined : (event) => menu({ kind: 'owner', opId: item.opId, ...(item.id === undefined ? {} : { id: item.id }) }, event)}
          {...stylex.props(rowStyles.bubble, rowStyles.anchor, styles.bubble, end && rowStyles.tailEnd)}
        >
          <Text variant="bodySmall" tone="inherit" selectable dir="auto" as="p" sx={rowStyles.bubbleText}>
            {item.text}
          </Text>
          <ReactionBadge reactions={item.reactions} corner="start" />
        </div>
      </div>
      {end ? (
        <div {...stylex.props(rowStyles.lineSlot, styles.lineSlot)}>
          <DeliveryLine delivery={item.delivery} onRetry={() => actions.onRetry(item.opId)} />
        </div>
      ) : null}
    </div>
  )
})

function DeliveryLine({ delivery, onRetry }: { readonly delivery: Delivery; readonly onRetry: () => void }) {
  const copy = chatCopy.delivery
  switch (delivery._tag) {
    case 'sending':
    case 'sent':
      return null
    case 'waiting':
      return (
        <Text variant="meta" tone="muted" sx={rowStyles.lineText} data-delivery="waiting">
          {copy.waiting[delivery.for]}
        </Text>
      )
    case 'failed':
      return delivery.reason === 'tooLong' ? (
        <Text variant="meta" tone="muted" sx={rowStyles.lineText} data-delivery="failed">
          {copy.tooLong}
        </Text>
      ) : (
        <Text variant="meta" tone="muted" sx={rowStyles.lineText} data-delivery="failed">
          {copy.notDelivered} · <TextButton onClick={onRetry}>{copy.tryAgain}</TextButton>
        </Text>
      )
  }
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    minWidth: 0,
  },
  row: {
    justifyContent: 'flex-end',
    width: '100%',
  },
  bubble: {
    backgroundColor: chat['--owner-bubble-bg'],
    color: chat['--owner-bubble-fg'],
  },
  lineSlot: {
    justifyContent: 'flex-end',
    textAlign: 'end',
    paddingInlineEnd: spacing['--space-0-5'],
  },
  quote: {
    display: 'flex',
    justifyContent: 'flex-end',
    maxWidth: chat['--bubble-max-width'],
    marginBottom: spacing['--space-0-5'],
  },
})
