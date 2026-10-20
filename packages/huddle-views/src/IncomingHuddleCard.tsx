import * as stylex from '@stylexjs/stylex'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Headphones } from '@phosphor-icons/react/dist/icons/Headphones'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { accent, colors, layout, motion, radii, shadows, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, focusRing, Icon, IconButton, Text, tooltip, type ActivateEvent } from '@juno/ui'
import { placeIcons, placeLabel } from './look'
import type { HuddlePerson, HuddlePlace } from './model'
import { PeopleStack } from './Speaking'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'
const REDUCED = '@media (prefers-reduced-motion: reduce)'

export interface IncomingHuddleCardProps {
  readonly place: HuddlePlace
  /** The first name of who started it: "Maya". */
  readonly starter: string
  /** Everyone in the huddle, in join order. */
  readonly people: ReadonlyArray<HuddlePerson>
  /** The huddle the user is in now ("#design"): the card offers Switch, which leaves it. */
  readonly current?: string
  /** The card pulses until the user acts or the huddle ends. False when the notification rules hold it quiet. */
  readonly pulse: boolean
  /** Opens the huddle's tab; `metaKey` for a new tab. */
  readonly onOpen: (event: ActivateEvent) => void
  readonly onJoin: () => void
  readonly onDismiss: () => void
}

/** "Maya started a huddle"; in a DM the place already names her. */
export function startedLine(place: HuddlePlace, starter: string): string {
  return place.kind === 'dm' ? 'Started a huddle' : `${starter} started a huddle`
}

/**
 * The card at the top of the sidebar when someone starts a huddle where the
 * user is (SPEC 20, "Incoming huddles"). It has the bar's frosted accent
 * material and height, an accent edge, and a soft glow that pulses while it
 * may interrupt; with reduced motion the edge stays and nothing pulses. Row
 * one opens the huddle's tab: the place and who is in it. Row two says who
 * started it, with Dismiss and Join (Switch while the user is in another).
 */
export function IncomingHuddleCard({ place, starter, people, current, pulse, onOpen, onJoin, onDismiss }: IncomingHuddleCardProps) {
  const where = placeLabel(place)
  const line = startedLine(place, starter)
  const switching = current !== undefined
  return (
    <section aria-label="Incoming huddle" data-incoming-huddle="" {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.card)}>
        {pulse ? <span aria-hidden data-pulse="" {...stylex.props(styles.glow)} /> : null}
        <button type="button" aria-label={`Open huddle in ${where}`} {...activateHandlers<HTMLButtonElement>(onOpen)} {...stylex.props(styles.open, focusRing.outside)}>
          <span {...stylex.props(styles.placeIcon)}>
            <Icon icon={placeIcons[place.kind]} size={16} />
          </span>
          <Text variant="ui" weight="medium" tone="default" truncate tooltipWhenTruncated dir="auto" sx={styles.name}>
            {place.name}
          </Text>
          <span {...stylex.props(styles.spacer)} />
          {people.length > 0 ? <PeopleStack people={people} ring="background" /> : null}
          <span {...stylex.props(styles.caret)}>
            <Icon icon={CaretRight} size={12} weight="bold" />
          </span>
        </button>
        <div {...stylex.props(styles.actions)}>
          <span {...stylex.props(styles.live)}>
            <Icon icon={Headphones} size={14} weight="fill" />
          </span>
          <Text variant="meta" tone="subtle" truncate tooltipWhenTruncated sx={styles.line}>
            {line}
          </Text>
          <span role="status" {...stylex.props(styles.announce)}>
            {`${line} in ${where}`}
          </span>
          <span {...stylex.props(styles.fills)}>
            <IconButton icon={X} label="Dismiss" size={28} iconSize={16} radius="lg" variant="island" onClick={onDismiss} />
          </span>
          <span {...(switching ? tooltip(`Leave the huddle in ${current} and join this one`) : {})}>
            <Button variant="primary" size="sm" iconStart={Headphones} iconWeight="fill" aria-label={switching ? `Switch to the huddle in ${where}` : `Join the huddle in ${where}`} onClick={onJoin}>
              {switching ? 'Switch' : 'Join'}
            </Button>
          </span>
        </div>
      </div>
    </section>
  )
}

const breathe = stylex.keyframes({
  '0%': { opacity: 0.15 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0.15 },
})

const styles = stylex.create({
  // As the bar: the sidebar's inset at the sides, 4px above and below.
  root: {
    flexShrink: 0,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    paddingInline: layout['--sidebar-inset'],
    paddingBlock: spacing['--space-1'],
    userSelect: 'none',
  },
  // The bar's frosted card, with the accent itself for its edge, so an incoming huddle reads apart from a call.
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    padding: spacing['--space-1'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: accent['--hl'],
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--huddle-bar'],
    backgroundImage: colors['--huddle-bar-sheen'],
    boxShadow: shadows['--huddle-bar-shadow'],
    WebkitAppRegion: 'no-drag',
  },
  // The pulse: a glow outside the edge whose opacity breathes, so only the compositor works each frame.
  // With reduced motion it does not show; the accent edge stays.
  glow: {
    position: 'absolute',
    inset: '-1px', // tokens-allow: over the card's 1px edge
    borderRadius: radii['--radius-xl'],
    boxShadow: shadows['--huddle-incoming-glow'],
    pointerEvents: 'none',
    opacity: { default: 0.15, [REDUCED]: 0 },
    animationName: { default: breathe, [REDUCED]: 'none' },
    animationDuration: motion['--duration-pulse'],
    animationTimingFunction: motion['--ease-in-out'],
    animationIterationCount: 'infinite',
  },
  // As the bar's first row. Muted falls under 4.5:1 on the tint, so the caret and "+N" take subtle.
  open: {
    '--foreground-muted': colors['--foreground-subtle'],
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    width: '100%',
    minWidth: 0,
    height: sizes['--control-28'],
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: spacing['--space-1-5'],
    paddingInlineEnd: spacing['--space-2'],
    boxSizing: 'border-box',
    borderWidth: 0,
    borderRadius: radii['--radius-lg'],
    color: colors['--foreground-default'],
    textAlign: 'start',
    cursor: 'default',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, [HOVER]: colors['--huddle-bar-hover'] },
      ':active': { default: colors['--huddle-bar-hover'], [HOVER]: colors['--huddle-bar-hover'] },
    },
    '--background': {
      default: colors['--huddle-bar'],
      ':hover': { default: null, [HOVER]: colors['--huddle-bar-hover'] },
      ':active': { default: colors['--huddle-bar-hover'], [HOVER]: colors['--huddle-bar-hover'] },
    },
    transitionProperty: 'scale, background-color',
    transitionDuration: { default: motion['--duration-fast'], [REDUCED]: '0ms' },
    transitionTimingFunction: motion['--ease-out'],
    scale: { default: '1', ':active': motion['--press-scale'] },
  },
  placeIcon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-subtle'],
  },
  name: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  spacer: {
    flexGrow: 1,
  },
  caret: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  // The headphones sit under the place glyph: 6px in, as the first row's.
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    height: sizes['--control-28'],
    paddingInlineStart: spacing['--space-1-5'],
  },
  // Green says live, as on the header's Join and a running huddle's row.
  live: {
    display: 'inline-flex',
    flexShrink: 0,
    width: sizes['--icon-16'],
    justifyContent: 'center',
    marginInlineEnd: spacing['--space-1'],
    color: colors['--huddle-live'],
  },
  line: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  // Dismiss takes the bar controls' fills: steps of the card's tint.
  fills: {
    display: 'contents',
    '--secondary-default': 'transparent',
    '--secondary-hover': colors['--huddle-bar-hover'],
    '--secondary-active': colors['--huddle-bar-pressed'],
  },
  // Heard once when the card comes.
  announce: {
    position: 'absolute',
    width: '1px', // tokens-allow: the visually hidden pattern
    height: '1px', // tokens-allow: the visually hidden pattern
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
})
