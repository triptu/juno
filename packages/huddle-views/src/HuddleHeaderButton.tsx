import * as stylex from '@stylexjs/stylex'
import { Headphones } from '@phosphor-icons/react/dist/icons/Headphones'
import { colors, radii, spacing } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, IconButton, tooltip } from '@juno/ui'
import { islandText } from './islandText'
import type { HuddlePerson } from './model'
import { PeopleStack } from './Speaking'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'
// The topic header's narrow form (inventory 5): a container query on the header layer. Container queries cannot read tokens.
const NARROW = '@container (width < 480px)'

/**
 * `start`: no huddle runs here. `join`: one runs and the user is not in it.
 * `switch`: one runs here and the user is in another. `joined`: the user is
 * in this one.
 */
export type HuddleHeaderMode = 'start' | 'join' | 'switch' | 'joined'

export interface HuddleHeaderButtonProps {
  readonly mode: HuddleHeaderMode
  /** Who is in this channel's huddle, for Join and Switch: the first three show. */
  readonly people?: ReadonlyArray<HuddlePerson>
  /** "#design": the huddle the user is in now, for Switch's tooltip. */
  readonly current?: string
  /** "#eng": this channel, for Join's tooltip. */
  readonly place: string
  readonly onClick: () => void
}

/**
 * The huddle control first in the right island of a channel's or DM's
 * Main (SPEC 20): Start huddle as an icon, or Join, Switch or In huddle as
 * text with the green headphones. Under 480px the text and the faces go
 * and the icon stays, as Resolve and Follow do.
 */
export function HuddleHeaderButton({ mode, people = [], current, place, onClick }: HuddleHeaderButtonProps) {
  if (mode === 'start') {
    return <IconButton icon={Headphones} label="Start huddle" size={28} iconSize={16} radius="full" variant="island" onClick={onClick} />
  }
  const label = mode === 'join' ? 'Join' : mode === 'switch' ? 'Switch' : 'In huddle'
  // The name starts with the visible word, so Voice Control's "click Switch" works; the tooltip says what it does.
  const name = mode === 'join' ? `Join the huddle in ${place}` : mode === 'switch' ? `Switch to the huddle in ${place}` : 'In huddle, open it'
  const hint = mode === 'join' ? name : mode === 'switch' ? `Leave the huddle in ${current ?? 'the other channel'} and join this one` : 'Open huddle'
  const faces = mode !== 'joined' && people.length > 0
  return (
    <button
      type="button"
      aria-label={name}
      {...tooltip(hint)}
      onClick={onClick}
      {...stylex.props(islandText.base, styles.button, faces && styles.withFaces, mode === 'joined' && styles.joined, focusRing.outside)}
    >
      <span {...stylex.props(styles.icon)}>
        <Icon icon={Headphones} size={14} weight="fill" />
      </span>
      <span {...stylex.props(styles.label)}>{label}</span>
      {faces ? (
        <span aria-hidden {...stylex.props(styles.faces)}>
          <PeopleStack people={people} max={3} />
        </span>
      ) : null}
    </button>
  )
}

const styles = stylex.create({
  // The island text button as a pill; the narrow form is its icon alone.
  button: {
    paddingInlineStart: { default: spacing['--space-2-5'], [NARROW]: 0 },
    paddingInlineEnd: { default: spacing['--space-2-5'], [NARROW]: 0 },
    borderRadius: radii['--radius-pill'],
  },
  // Green says a huddle is running here, as on the sidebar row.
  icon: {
    display: 'inline-flex',
    color: colors['--huddle-live'],
  },
  // In this huddle: the island's pressed fill, so the narrow icon tells In huddle from Join.
  joined: {
    backgroundColor: {
      default: colors['--secondary-hover'],
      ':hover': { default: null, [HOVER]: colors['--secondary-active'] },
      ':active': { default: colors['--secondary-active'], [HOVER]: colors['--secondary-active'] },
    },
  },
  // The faces end as far from the pill's end as they are from its top and bottom: (28 - 18) / 2.
  withFaces: {
    paddingInlineEnd: { default: spacing['--space-1'], [NARROW]: 0 },
  },
  label: {
    display: { default: 'inline', [NARROW]: 'none' },
  },
  faces: {
    display: { default: 'inline-flex', [NARROW]: 'none' },
    paddingInlineEnd: spacing['--space-pixel'],
  },
})
