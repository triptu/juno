import * as stylex from '@stylexjs/stylex'
import { sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, type AvatarRingSurface, type AvatarSize, type HueName } from './Avatar'
import { firstGrapheme } from './internal/grapheme'
import { Text } from './Text'

export interface AvatarStackPerson {
  readonly id: string
  readonly initials: string
  readonly name: string
  readonly hue: HueName
  /** The profile photo; the initial stays underneath until it arrives. */
  readonly src?: string
}

export interface AvatarStackProps {
  readonly people: ReadonlyArray<AvatarStackPerson>
  /** How many to show; the rest are counted as "+N". Default 4. */
  readonly max?: number
  /** People not in `people` who also belong to the stack, added to the "+N". */
  readonly more?: number
  readonly size?: AvatarSize
  /** The surface the stack sits on; the rings take its colour. Default `subtle` (the sidebar). */
  readonly surface?: AvatarRingSurface
  /** Accessible name for the whole stack. Defaults to the names joined. */
  readonly label?: string
}

/**
 * Overlapping avatars, each ringed in the surface colour so the overlap reads
 * as a cut, then "+N" for the people past `max`. Each avatar shows one
 * initial: at 18px two letters would be clipped by the next avatar.
 */
export function AvatarStack({ people, max = 4, more = 0, size = 18, surface = 'subtle', label }: AvatarStackProps) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length + more
  const names = shown.map((person) => person.name).join(', ')
  return (
    <span role="img" aria-label={label ?? (rest > 0 ? `${names} and ${rest} more` : names)} {...stylex.props(styles.stack)}>
      {shown.map((person, index) => (
        <span key={person.id} title={person.name} {...stylex.props(styles.item, index > 0 && styles.overlap)}>
          <Avatar name={person.name} label={firstGrapheme(person.initials)} size={size} hue={person.hue} ring={surface} {...(person.src === undefined ? {} : { src: person.src })} />
        </span>
      ))}
      {rest > 0 ? (
        <Text variant="meta" numeric sx={styles.more}>
          +{rest}
        </Text>
      ) : null}
    </span>
  )
}

const styles = stylex.create({
  stack: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    verticalAlign: 'middle',
  },
  item: {
    display: 'inline-flex',
    position: 'relative',
  },
  overlap: {
    marginInlineStart: sizes['--avatar-stack-overlap'],
  },
  // The count takes the colour around it, so it reads at the meta line's level.
  more: {
    marginInlineStart: spacing['--space-1'],
  },
})
