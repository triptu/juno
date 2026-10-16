import * as stylex from '@stylexjs/stylex'
import { sizes } from '@juno/tokens/tokens.stylex'
import { Avatar } from './Avatar'
import type { AvatarStackPerson } from './AvatarStack'
import { firstGrapheme } from './internal/grapheme'

/** 44 is a sidebar row's tile, 16 a tab's icon. */
type GroupAvatarSize = 44 | 16

export interface GroupAvatarProps {
  /** The group's other members, two or more. Two are drawn; people with a photo go first. */
  readonly people: ReadonlyArray<AvatarStackPerson>
  readonly size?: GroupAvatarSize
  /** The group's name, for the accessible name. Omit for decoration. */
  readonly name?: string
}

/**
 * A group DM's tile: two members' photos in a diagonal pair, the back one
 * cut away around the front one. The cut is a mask, not a ring, so it reads
 * on any row background (hover, selected) without knowing it. A member
 * without a photo shows their colour and initial, as `Avatar` does.
 */
export function GroupAvatar({ people, size = 44, name }: GroupAvatarProps) {
  const [front, back] = [...people.filter((person) => person.src !== undefined), ...people.filter((person) => person.src === undefined)]
  const member = size === 44 ? 28 : 11
  const draw = (person: AvatarStackPerson) => (
    <Avatar label={size === 44 ? firstGrapheme(person.initials) : ''} size={member} hue={person.hue} {...(person.src === undefined ? {} : { src: person.src })} />
  )
  return (
    <span role={name ? 'img' : undefined} aria-label={name} aria-hidden={name ? undefined : true} data-group-avatar="" {...stylex.props(styles.box, boxes[size])}>
      {back === undefined ? null : <span {...stylex.props(styles.back, cuts[size])}>{draw(back)}</span>}
      {front === undefined ? null : <span {...stylex.props(styles.front)}>{draw(front)}</span>}
    </span>
  )
}

const styles = stylex.create({
  box: {
    position: 'relative',
    display: 'inline-flex',
    flexShrink: 0,
    verticalAlign: 'middle',
  },
  // Physical sides on purpose: the cut's centre is a physical point.
  back: {
    position: 'absolute',
    top: 0,
    left: 0,
    display: 'inline-flex',
  },
  front: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    display: 'inline-flex',
  },
})

const boxes = stylex.create({
  44: { width: sizes['--tile-44'], height: sizes['--tile-44'] },
  16: { width: sizes['--icon-16'], height: sizes['--icon-16'] },
})

// The front member's circle plus a gap, centred where it sits over the back
// one: 28px members 16px apart (centre 30, radius 14 + 2), or 11px members
// 5px apart (centre 10.5, radius 5.5 + 1). Only the mask's alpha counts.
const CUT_44 = 'radial-gradient(circle at 30px 30px, transparent 16px, black 16.5px)' // tokens-allow: mask geometry, not a colour
const CUT_16 = 'radial-gradient(circle at 10.5px 10.5px, transparent 6.5px, black 7px)' // tokens-allow: mask geometry, not a colour

const cuts = stylex.create({
  44: { maskImage: CUT_44 },
  16: { maskImage: CUT_16 },
})
