import * as stylex from '@stylexjs/stylex'
import { chatCopy, type Reaction } from '@juno/agent-contract'
import { chat, colors, radii, shadows, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Text } from '@juno/ui'

export interface ReactionBadgeProps {
  readonly emojiUrl?: ((name: string) => string | undefined) | undefined
  readonly reactions: ReadonlyArray<Reaction>
  /** The item's top corner it sits on: `end` on Juno's bubbles and cards, `start` on the owner's bubbles. */
  readonly corner: 'start' | 'end'
}

/**
 * The reactions on a bubble or card, as the emoji themselves (SPEC 13.1).
 * Out of flow over the item's top corner, so a reaction arriving or
 * leaving moves nothing. The item it sits on is `position: relative`.
 */
export function ReactionBadge({ reactions, corner, emojiUrl }: ReactionBadgeProps) {
  if (reactions.length === 0) return null
  return (
    <span data-reactions={reactions.map((r) => `${r.by}:${r.emoji}`).join(' ')} {...stylex.props(styles.badge, corner === 'end' ? styles.end : styles.start)}>
      {reactions.map((reaction) => {
        const url = emojiUrl?.(reaction.emoji)
        return (
          <Text key={reaction.by} variant="meta" tone="default" as="span" role="img" aria-label={chatCopy.react.reacted(reaction.emoji)}>
            {url === undefined ? reaction.emoji : <img src={url} alt="" draggable={false} {...stylex.props(styles.image)} />}
          </Text>
        )
      })}
    </span>
  )
}

const styles = stylex.create({
  image: { width: sizes['--icon-16'], height: sizes['--icon-16'], objectFit: 'contain', verticalAlign: 'middle' },
  badge: {
    position: 'absolute',
    top: `calc(-1 * ${chat['--reaction-offset']})`,
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-0-5'],
    height: sizes['--control-22'],
    paddingInline: spacing['--space-1-5'],
    boxSizing: 'border-box',
    borderRadius: radii['--radius-pill'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--border-subtle'],
    backgroundColor: colors['--surface-default'],
    boxShadow: shadows['--shadow-sm'],
    userSelect: 'none',
    pointerEvents: 'none',
  },
  end: { insetInlineEnd: `calc(-1 * ${chat['--reaction-offset']})` },
  start: { insetInlineStart: `calc(-1 * ${chat['--reaction-offset']})` },
})
