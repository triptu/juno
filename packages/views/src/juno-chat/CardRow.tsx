import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import type { CardItem } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { renderCard } from './cards'
import type { ChatActions } from './commands'
import { ReactionBadge } from './ReactionBadge'
import { rowStyles } from './rows'
import { RowActions } from './RowActions'

export interface CardRowProps {
  readonly item: CardItem
  readonly now: number
  readonly actions: ChatActions
}

/**
 * A card under Juno's bubbles (SPEC 13.3), in its own row past the mark's
 * column. The owner can react to it or reply to it; neither is a click on
 * its buttons. Reactions sit on its top corner out of flow, and React and
 * Reply wait beside it.
 */
export const CardRow = memo(function CardRow({ item, now, actions }: CardRowProps) {
  const card = item.card
  const menu = actions.onContextMenu
  return (
    <div data-chat-card-row={card.id} data-unread={item.unread || undefined} {...stylex.props(rowStyles.row, styles.row)}>
      <div onContextMenu={menu === undefined ? undefined : (event) => menu({ kind: 'card', id: card.id }, event)} {...stylex.props(rowStyles.anchor, styles.card)}>
        {renderCard(card, actions, now)}
        <ReactionBadge reactions={item.reactions} corner="end" />
      </div>
      <RowActions target={{ _tag: 'card', id: card.id }} actions={actions} />
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
