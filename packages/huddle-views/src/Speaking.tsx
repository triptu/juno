import * as stylex from '@stylexjs/stylex'
import { colors, motion, opacity, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, firstGrapheme, Text } from '@juno/ui'
import type { HuddlePerson } from './model'

/** The surface an avatar sits on, for the ring that cuts an overlap (Avatar's `ring`). */
type RingSurface = 'background' | 'subtle' | 'surface'

export interface PersonAvatarProps {
  readonly person: HuddlePerson
  readonly size: 18 | 20 | 44
  /** The surface the avatar sits on, for the ring that cuts the overlap. */
  readonly ring?: RingSurface
  /** Draw the speaking ring. Off where the ring goes around something larger (a tile). */
  readonly showSpeaking?: boolean
}

/**
 * A person's photo with the green ring while they speak (SPEC 20). The
 * ring is an outline a hairline outside the avatar, so the surface shows
 * between them, and it never changes the layout; only its colour fades.
 */
export function PersonAvatar({ person, size, ring, showSpeaking = true }: PersonAvatarProps) {
  const speaking = showSpeaking && person.speaking === true
  return (
    <span data-speaking={speaking ? '' : undefined} {...stylex.props(styles.avatar, speaking && styles.speaking)}>
      <Avatar
        label={size === 44 ? person.initials : firstGrapheme(person.initials)}
        size={size}
        hue={person.hue}
        {...(ring === undefined ? {} : { ring })}
        {...(person.avatarUrl === undefined ? {} : { src: person.avatarUrl })}
      />
    </span>
  )
}

export interface PeopleStackProps {
  readonly people: ReadonlyArray<HuddlePerson>
  /** How many to show before "+N". */
  readonly max?: number
  /** The connection is down: the stack dims. */
  readonly dim?: boolean
}

/**
 * Up to four overlapping avatars, then "+N", as the sidebar's AvatarStack
 * draws them, with the speaking ring on whoever talks. Join order;
 * speaking never reorders.
 */
export function PeopleStack({ people, max = 4, dim = false }: PeopleStackProps) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  const names = shown.map((person) => person.name).join(', ')
  return (
    <span role="img" aria-label={rest > 0 ? `${names} and ${rest} more` : names} {...stylex.props(styles.stack, dim && styles.dim)}>
      {shown.map((person, index) => (
        <span key={person.id} {...stylex.props(styles.item, index > 0 && styles.overlap)}>
          <PersonAvatar person={person} size={18} ring="surface" />
        </span>
      ))}
      {rest > 0 ? (
        <Text variant="meta" tone="muted" numeric sx={styles.more}>
          +{rest}
        </Text>
      ) : null}
    </span>
  )
}

const styles = stylex.create({
  avatar: {
    display: 'inline-flex',
    borderRadius: radii['--radius-full'],
    outlineStyle: 'solid',
    outlineWidth: sizes['--speaking-ring'],
    outlineOffset: sizes['--avatar-ring'],
    outlineColor: 'transparent',
    transitionProperty: 'outline-color',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: motion['--ease-out'],
  },
  // Above its neighbours in a stack, so the next face does not cut the ring.
  speaking: {
    position: 'relative',
    zIndex: 1,
    outlineColor: colors['--huddle-live'],
  },
  stack: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    transitionProperty: 'opacity',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
  },
  dim: {
    opacity: opacity['--opacity-dim'],
  },
  item: {
    display: 'inline-flex',
    position: 'relative',
  },
  overlap: {
    marginInlineStart: sizes['--avatar-stack-overlap'],
  },
  more: {
    marginInlineStart: spacing['--space-1'],
  },
})
