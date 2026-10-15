import * as stylex from '@stylexjs/stylex'
import type { ReactionView } from '@juno/contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Chip } from '@juno/ui'

export interface ReactionsProps {
  readonly reactions: ReadonlyArray<ReactionView>
  /**
   * Toggle a reaction by its Slack name. Without it (M4) the chips are
   * plain labels with the same look, not buttons that do nothing.
   */
  readonly onToggle?: (name: string) => void
}

// A custom emoji in a chip is drawn at the chip's text size.
const CHIP_EMOJI_SIZE = '14px'

/** The reaction chips under a message (inventory 6.4). Mine reads as pressed. */
export function Reactions({ reactions, onToggle }: ReactionsProps) {
  if (reactions.length === 0) return null
  return (
    <div role="list" aria-label="Reactions" {...stylex.props(styles.row)}>
      {reactions.map((reaction) => {
        const emoji =
          reaction.url !== undefined ? (
            <img src={reaction.url} alt="" draggable={false} decoding="async" loading="lazy" {...stylex.props(styles.image)} />
          ) : (
            <span aria-hidden>{reaction.unicode ?? `:${reaction.name}:`}</span>
          )
        const label = `${reaction.count} ${reaction.unicode ?? `:${reaction.name}:`}${reaction.me ? ', including you' : ''}`
        const content = (
          <>
            {emoji}
            <span>{reaction.count}</span>
          </>
        )
        // The emoji is hidden and the title is not read reliably, so the item carries the words.
        return onToggle === undefined ? (
          <span role="listitem" aria-label={label} key={reaction.name} {...stylex.props(styles.item)}>
            <Chip variant={reaction.me ? 'soft' : 'outline'} size={24} numeric title={label}>
              {content}
            </Chip>
          </span>
        ) : (
          <span role="listitem" key={reaction.name} {...stylex.props(styles.item)}>
            <Chip interactive variant="surface" size={24} numeric pressed={reaction.me} title={label} aria-label={label} onClick={() => onToggle(reaction.name)}>
              {content}
            </Chip>
          </span>
        )
      })}
    </div>
  )
}

const styles = stylex.create({
  row: {
    display: 'flex',
    flexWrap: 'nowrap',
    overflowX: 'auto',
    scrollbarWidth: 'none',
    maxWidth: '100%',
    gap: spacing['--space-1'],
    marginTop: spacing['--space-1-5'],
  },
  item: {
    display: 'flex',
    flexShrink: 0,
  },
  image: {
    width: CHIP_EMOJI_SIZE,
    height: CHIP_EMOJI_SIZE,
    objectFit: 'contain',
  },
})
