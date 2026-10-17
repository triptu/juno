import * as stylex from '@stylexjs/stylex'
import type { Person, ReactionView } from '@juno/contract'
import { sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Chip } from '@juno/ui'
import { useReactorsPopover } from './reactorsPopover'

export interface ReactionsProps {
  readonly reactions: ReadonlyArray<ReactionView>
  /**
   * Toggle a reaction by its Slack name. Without it (M4) the chips are
   * plain labels with the same look, not buttons that do nothing.
   */
  readonly onToggle?: (name: string) => void
  /** The window's people. With them, hovering or focusing a chip shows who reacted (`ReactorsCard`). */
  readonly people?: ReadonlyMap<string, Person>
}


/** The reaction chips under a message (inventory 6.4). Mine reads as pressed. Hovering one shows who reacted. */
export function Reactions({ reactions, onToggle, people }: ReactionsProps) {
  if (reactions.length === 0) return null
  return <ReactionChips reactions={reactions} onToggle={onToggle} people={people} />
}

function ReactionChips({ reactions, onToggle, people }: { readonly reactions: ReadonlyArray<ReactionView>; readonly onToggle: ReactionsProps['onToggle']; readonly people: ReactionsProps['people'] }) {
  const { chipProps, card } = useReactorsPopover(reactions, people)
  // With the card, the native title tooltip would show over it.
  const title = (label: string) => (people === undefined ? label : undefined)
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
          <span {...stylex.props(styles.content)}>
            {emoji}
            <span>{reaction.count}</span>
          </span>
        )
        // The emoji is hidden and the title is not read reliably, so the item carries the words.
        return onToggle === undefined ? (
          <span role="listitem" aria-label={label} key={reaction.name}>
            <Chip variant={reaction.me ? 'soft' : 'outline'} size={24} numeric title={title(label)} {...chipProps(reaction.name)}>
              {content}
            </Chip>
          </span>
        ) : (
          <span role="listitem" key={reaction.name}>
            <Chip interactive variant="surface" size={24} numeric pressed={reaction.me} title={title(label)} aria-label={label} onClick={() => onToggle(reaction.name)} {...chipProps(reaction.name)}>
              {content}
            </Chip>
          </span>
        )
      })}
      {card}
    </div>
  )
}

const styles = stylex.create({
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-1'],
    marginTop: spacing['--space-1-5'],
  },
  // The emoji and its count, apart at the chip's gap (inventory 6.4).
  content: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
  },
  image: {
    width: sizes['--icon-14'],
    height: sizes['--icon-14'],
    objectFit: 'contain',
  },
})
