import * as stylex from '@stylexjs/stylex'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Headphones } from '@phosphor-icons/react/dist/icons/Headphones'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { accent, colors, motion, radii, shadows, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, Button, focusRing, Icon, IconButton, Text, tooltip, type ActivateEvent } from '@juno/ui'
import { barCard } from './barCard'
import { placeIcons, placeLabel } from './look'
import type { HuddlePerson, HuddlePlace } from './model'
import { PeopleStack } from './Speaking'

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
function startedLine(place: HuddlePlace, starter: string): string {
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
    <section aria-label="Incoming huddle" data-incoming-huddle="" {...stylex.props(barCard.root)}>
      <div {...stylex.props(barCard.card, styles.edge)}>
        {pulse ? <span aria-hidden data-pulse="" {...stylex.props(styles.glow)} /> : null}
        <button type="button" aria-label={`Open huddle in ${where}`} {...activateHandlers<HTMLButtonElement>(onOpen)} {...stylex.props(barCard.open, focusRing.outside)}>
          <span {...stylex.props(barCard.placeIcon)}>
            <Icon icon={placeIcons[place.kind]} size={16} />
          </span>
          <Text variant="ui" weight="medium" tone="default" truncate tooltipWhenTruncated dir="auto" sx={barCard.name}>
            {place.name}
          </Text>
          <span {...stylex.props(barCard.spacer)} />
          {people.length > 0 ? <PeopleStack people={people} ring="background" /> : null}
          <span {...stylex.props(barCard.caret)}>
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
          <span role="status" {...stylex.props(barCard.announce)}>
            {`${line} in ${where}`}
          </span>
          <IconButton icon={X} label="Dismiss" size={28} iconSize={16} radius="lg" onClick={onDismiss} />
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
  // The accent itself for the edge, so an incoming huddle reads apart from a call.
  edge: {
    position: 'relative',
    borderColor: accent['--hl'],
  },
  // The pulse: a glow around the edge whose opacity breathes, so only the compositor works each frame.
  // It sits on the padding box, so its ring covers the 1px edge. With reduced motion it does not show; the
  // accent edge stays.
  glow: {
    position: 'absolute',
    inset: 0,
    borderRadius: radii['--radius-xl'],
    boxShadow: shadows['--huddle-incoming-glow'],
    pointerEvents: 'none',
    opacity: { default: null, [REDUCED]: 0 },
    animationName: { default: breathe, [REDUCED]: 'none' },
    animationDuration: motion['--duration-pulse'],
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  // The headphones sit under the place glyph, 6px in, as the first row's.
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    height: sizes['--control-28'],
    paddingInlineStart: spacing['--space-1-5'],
  },
  // Green says live, as on the header's Join and a running huddle's row. 16 wide and 4 more, so the line starts under the name.
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
})
