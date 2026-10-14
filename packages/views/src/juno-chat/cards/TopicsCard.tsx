import * as stylex from '@stylexjs/stylex'
import type { TopicsCard as TopicsCardModel } from '@juno/agent-contract'
import { accent, colors, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Icon, Text } from '@juno/ui'
import type { ChatActions } from '../commands'
import { ChatCard, placeIcon } from './ChatCard'

export interface TopicsCardProps {
  readonly card: TopicsCardModel
  readonly actions: ChatActions
}

const HOVER = '@media (hover: hover)'

/** Links to topics: 36px rows that open on mouse down, in a new tab with ⌘. No buttons and no status change. */
export function TopicsCard({ card, actions }: TopicsCardProps) {
  return (
    <ChatCard id={card.id} kind="topics" actions={actions} status={card.status} because={card.because} footer={false} padding="tight">
      <div role="list" {...stylex.props(styles.list)}>
        {card.links.map((link) => (
          <div key={link.topicId} role="listitem" tabIndex={0} data-topic-link={link.topicId} {...activateHandlers<HTMLDivElement>((event) => actions.onOpen({ _tag: 'topic', topicId: link.topicId }, event))} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.icon)}>
              <Icon icon={placeIcon(link.tint)} size={13} />
            </span>
            <Text variant="preview" weight="medium" tone="default" truncate dir="auto">
              {link.title}
            </Text>
            <Text variant="tagSmall" tone="muted" truncate sx={styles.where}>
              {link.where}
            </Text>
          </div>
        ))}
      </div>
    </ChatCard>
  )
}

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minHeight: sizes['--control-36'],
    paddingInline: spacing['--space-2-5'],
    borderRadius: radii['--radius-xl'],
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--surface-hover'] },
    },
    transitionProperty: 'background-color',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
    userSelect: 'none',
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
