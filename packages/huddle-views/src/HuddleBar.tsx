import * as stylex from '@stylexjs/stylex'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import type { ReactNode } from 'react'
import { colors, layout, motion, radii, shadows, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { activateHandlers, focusRing, Icon, Text, type ActivateEvent } from '@juno/ui'
import { HuddleControls } from './HuddleControls'
import { placeIcons, placeLabel, statusLine } from './look'
import type { HuddleConnection, HuddleControlsActions, HuddleControlsState, HuddlePerson, HuddlePlace } from './model'
import { PeopleStack } from './Speaking'

// Hover styles only apply on devices with a real pointer. Local because
// StyleX cannot read constants from other modules.
const HOVER = '@media (hover: hover)'

export interface HuddleBarProps extends HuddleControlsState, HuddleControlsActions {
  readonly place: HuddlePlace
  readonly connection: HuddleConnection
  /** How long the huddle has run ("4:05"): a leaf the container ticks, so the bar does not re-render each second. */
  readonly duration: ReactNode
  /** Everyone in the huddle but the user, in join order. */
  readonly people: ReadonlyArray<HuddlePerson>
  /** First names of the others who share their screen. */
  readonly sharers?: ReadonlyArray<string>
  /** Opens the huddle tab; `metaKey` for a new tab. */
  readonly onOpen: (event: ActivateEvent) => void
  /** The device menu's content, shown while `devicesOpen`. */
  readonly devices?: ReactNode
}

/**
 * The bar at the top of the sidebar while the user is in a huddle (SPEC
 * 20). Row one is one button that opens the huddle tab: the place, one
 * status line and who else is there. Row two holds Mute, Share screen,
 * Microphone and speaker, and Leave. Every state is the same height, so a
 * change in the huddle moves nothing in the sidebar.
 */
export function HuddleBar({ place, connection, duration, people, sharers = [], onOpen, devices, ...controls }: HuddleBarProps) {
  const status = statusLine({ connection, micBlocked: controls.micBlocked ?? false, sharers, sharing: controls.sharing, duration })
  return (
    <section aria-label="Huddle" data-huddle-bar="" {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.card)}>
        <button type="button" aria-label={`Open huddle in ${placeLabel(place)}`} {...activateHandlers<HTMLButtonElement>(onOpen)} {...stylex.props(styles.open, focusRing.outside)}>
          <span {...stylex.props(styles.placeIcon)}>
            <Icon icon={placeIcons[place.kind]} size={16} />
          </span>
          <Text variant="ui" weight="medium" tone="default" truncate dir="auto" sx={styles.name}>
            {place.name}
          </Text>
          <Text variant="meta" tone="muted" numeric truncate role="status" sx={styles.status}>
            {status}
          </Text>
          <span {...stylex.props(styles.spacer)} />
          {people.length > 0 ? <PeopleStack people={people} dim={connection === 'reconnecting'} /> : null}
          <span {...stylex.props(styles.caret)}>
            <Icon icon={CaretRight} size={12} weight="bold" />
          </span>
        </button>
        <div role="group" aria-label="Huddle controls" {...stylex.props(styles.controls)}>
          <HuddleControls shape="bar" devices={devices} {...controls} />
        </div>
      </div>
    </section>
  )
}

const styles = stylex.create({
  // The sidebar's inset at the sides, and 4px above and below, so with the nav's own 4px it sits 8px over Juno.
  root: {
    flexShrink: 0,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    paddingInline: layout['--sidebar-inset'],
    paddingBlock: spacing['--space-1'],
    userSelect: 'none',
  },
  // A raised card, as the header islands are: 4px around two 28px rows, 2px between them, as between the controls.
  // 12 = the controls' 8 + the 4 around them.
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    padding: spacing['--space-1'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: radii['--radius-xl'],
    backgroundColor: colors['--surface-default'],
    boxShadow: shadows['--card-ring'],
    WebkitAppRegion: 'no-drag',
  },
  // Its glyph sits 6px in, over the Mute glyph's 6px inside its 28px button.
  open: {
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
      ':hover': { default: null, [HOVER]: colors['--secondary-default'] },
      ':active': { default: colors['--secondary-default'], [HOVER]: colors['--secondary-default'] },
    },
    transitionProperty: 'scale, background-color',
    transitionDuration: { default: motion['--duration-fast'], '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: motion['--ease-out'],
    scale: { default: '1', ':active': motion['--press-scale'] },
  },
  placeIcon: {
    display: 'inline-flex',
    flexShrink: 0,
    color: colors['--foreground-subtle'],
  },
  // The name keeps its room first; a long status line shortens before it does.
  name: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  status: {
    flexGrow: 0,
    flexShrink: 4,
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
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: sizes['--control-28'],
  },
})
