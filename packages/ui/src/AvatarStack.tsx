import * as stylex from '@stylexjs/stylex'
import { sizes } from '@juno/tokens/tokens.stylex'
import { Avatar, type AvatarSize, type HueName } from './Avatar'

export interface AvatarStackPerson {
  readonly id: string
  readonly initials: string
  readonly name: string
  readonly hue: HueName
}

export interface AvatarStackProps {
  readonly people: ReadonlyArray<AvatarStackPerson>
  /** How many to show before the rest are dropped. Default 4. */
  readonly max?: number
  readonly size?: AvatarSize
  /** Accessible name for the whole stack. Defaults to the names joined. */
  readonly label?: string
}

/** Overlapping avatars, each ringed in the sidebar background. */
export function AvatarStack({ people, max = 4, size = 18, label }: AvatarStackProps) {
  const shown = people.slice(0, max)
  return (
    <span role="img" aria-label={label ?? shown.map((person) => person.name).join(', ')} {...stylex.props(styles.stack)}>
      {shown.map((person, index) => (
        <span key={person.id} {...stylex.props(styles.item, index > 0 && styles.overlap)}>
          <Avatar label={person.initials} size={size} hue={person.hue} ring stackInitials={size === 18} />
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
