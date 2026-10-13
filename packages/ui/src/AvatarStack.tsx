import * as stylex from '@stylexjs/stylex'
import { sizes } from '@juno/tokens/tokens.stylex'
import { Avatar, type AvatarRingSurface, type AvatarSize, type HueName } from './Avatar'

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
  /** How many to show before the rest are dropped. Default 4. */
  readonly max?: number
  readonly size?: AvatarSize
  /** The surface the stack sits on; the rings take its colour. Default `subtle` (the sidebar). */
  readonly surface?: AvatarRingSurface
  /** Accessible name for the whole stack. Defaults to the names joined. */
  readonly label?: string
}

/**
 * Overlapping avatars, each ringed in the surface colour so the overlap reads
 * as a cut. Each avatar shows one initial: at 18px two letters would be
 * clipped by the next avatar.
 */
export function AvatarStack({ people, max = 4, size = 18, surface = 'subtle', label }: AvatarStackProps) {
  const shown = people.slice(0, max)
  return (
    <span role="img" aria-label={label ?? shown.map((person) => person.name).join(', ')} {...stylex.props(styles.stack)}>
      {shown.map((person, index) => (
        <span key={person.id} {...stylex.props(styles.item, index > 0 && styles.overlap)}>
          <Avatar label={person.initials.slice(0, 1)} size={size} hue={person.hue} ring={surface} {...(person.src === undefined ? {} : { src: person.src })} />
        </span>
      ))}
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
})
