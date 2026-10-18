import * as stylex from '@stylexjs/stylex'
import { Headphones } from '@phosphor-icons/react/dist/icons/Headphones'
import { colors, motion, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, IconButton, tooltip } from '@juno/ui'
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
  const hint =
    mode === 'join'
      ? `Join the huddle in ${place}`
      : mode === 'switch'
        ? `Leave the huddle in ${current ?? 'the other channel'} and join this one`
        : 'Open huddle'
  const faces = mode !== 'joined' && people.length > 0
  return (
    <button type="button" aria-label={hint} {...tooltip(hint)} onClick={onClick} {...stylex.props(styles.button, faces && styles.withFaces, focusRing.outside)}>
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
  // IslandButton's look: a 28px pill text button with the island controls' fills.
  button: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    gap: spacing['--space-1-5'],
    height: sizes['--control-28'],
    minWidth: sizes['--control-28'],
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: { default: spacing['--space-2-5'], [NARROW]: 0 },
    paddingInlineEnd: { default: spacing['--space-2-5'], [NARROW]: 0 },
    boxSizing: 'border-box',
    borderWidth: 0,
    borderRadius: radii['--radius-pill'],
    color: colors['--foreground-default'],
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    whiteSpace: 'nowrap',
    userSelect: 'none',
    cursor: 'default',
    WebkitAppRegion: 'no-drag',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
      ':active': { default: colors['--secondary-default'], [HOVER]: colors['--secondary-default'] },
    },
    transitionProperty: 'scale, background-color',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: motion['--ease-out'],
    scale: { default: '1', ':active': motion['--press-scale'] },
  },
  // Green says a huddle is running here, as on the sidebar row.
  icon: {
    display: 'inline-flex',
    color: colors['--huddle-live'],
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
