import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import type { CardItem } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { inField } from '../fieldMenu'
import { renderCard } from './cards'
import type { ChatActions } from './commands'
import { ReactionBadge } from './ReactionBadge'
import { rowStyles } from './rows'

export interface CardRowProps {
  readonly item: CardItem
  readonly now: number
  readonly actions: ChatActions
}

/**
 * A card under Juno's bubbles (SPEC 13.3), in its own row past the mark's
 * column. The owner can react to it or reply to it from its menu (a
 * right-click); neither is a click on its buttons. Reactions sit on its top
 * corner out of flow.
 */
export const CardRow = memo(function CardRow({ item, now, actions }: CardRowProps) {
  const card = item.card
  const menu = actions.onContextMenu
  return (
    <div data-chat-card-row={card.id} data-unread={item.unread || undefined} {...stylex.props(rowStyles.row, styles.row)}>
      <div
        onContextMenu={
          menu === undefined
            ? undefined
            : (event) => {
                // A draft's field keeps the text menu.
                if (!inField(event)) menu({ kind: 'card', id: card.id }, event)
              }
        }
        {...stylex.props(rowStyles.anchor, styles.card)}
      >
        {renderCard(card, actions, now)}
        {actions.renderReactions?.(item.reactions, 'end') ?? <ReactionBadge reactions={item.reactions} corner="end" />}
      </div>
    </div>
  )
})

const styles = stylex.create({
  // Lined up under the bubbles, at the column's edge.
  row: {
    alignItems: 'flex-start',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: spacing['--space-2'],
  },
  card: {
    display: 'flex',
    flexGrow: 1,
    minWidth: 0,
  },
})
