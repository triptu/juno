import * as stylex from '@stylexjs/stylex'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import type { ReactNode } from 'react'
import { sizes } from '@juno/tokens/tokens.stylex'
import { activateHandlers, focusRing, Icon, Text, type ActivateEvent } from '@juno/ui'
import { barCard } from './barCard'
import { HuddleControls } from './HuddleControls'
import { placeIcons, placeLabel, statusLine } from './look'
import type { HuddleConnection, HuddleControlsActions, HuddleControlsState, HuddlePerson, HuddlePlace } from './model'
import { PeopleStack } from './Speaking'

export interface HuddleBarProps extends HuddleControlsState, HuddleControlsActions {
  readonly place: HuddlePlace
  readonly connection: HuddleConnection
  /** How long the huddle has run ("4:05"): a leaf the container ticks, so the bar does not re-render each second. */
  readonly duration: ReactNode
  /** Everyone in the huddle but the user, in join order. */
  readonly people: ReadonlyArray<HuddlePerson>
  /** First names of the others who share their screen. */
  readonly sharers?: ReadonlyArray<string>
  /** The screen's or window's name while the user shares: "You're sharing Built-in display". */
  readonly sharingSource?: string
  /** Opens the huddle tab; `metaKey` for a new tab. */
  readonly onOpen: (event: ActivateEvent) => void
  /** The device menu's content, shown while `devicesOpen`. */
  readonly devices?: ReactNode
  /** Said once to a screen reader: "Maya joined", "Muted". The status line's notices are said too; the duration never is. */
  readonly announcement?: string
}

/**
 * The bar at the top of the sidebar while the user is in a huddle (SPEC
 * 20). Row one is one button that opens the huddle tab: the place, one
 * status line and who else is there. Row two holds Mute, Share screen,
 * Microphone and speaker, and Leave. Every state is the same height, so a
 * change in the huddle moves nothing in the sidebar.
 */
export function HuddleBar({ place, connection, duration, people, sharers = [], sharingSource, onOpen, devices, announcement, ...controls }: HuddleBarProps) {
  // While the user shares, the bar names only what they share: with the others too it would push out the place's name.
  const others = controls.sharing && sharingSource !== undefined ? [] : sharers
  const status = statusLine({ connection, microphone: controls.microphone, sharers: others, sharing: controls.sharing, ...(sharingSource === undefined ? {} : { sharingSource }), duration })
  // A notice keeps its share of the room; the duration gives way first.
  const notice = status !== duration
  return (
    <section aria-label="Huddle" data-huddle-bar="" {...stylex.props(barCard.root)}>
      <div {...stylex.props(barCard.card)}>
        <button type="button" aria-label={`Open huddle in ${placeLabel(place)}`} {...activateHandlers<HTMLButtonElement>(onOpen)} {...stylex.props(barCard.open, focusRing.outside)}>
          <span {...stylex.props(barCard.placeIcon)}>
            <Icon icon={placeIcons[place.kind]} size={16} />
          </span>
          <Text variant="ui" weight="medium" tone="default" truncate tooltipWhenTruncated dir="auto" sx={barCard.name}>
            {place.name}
          </Text>
          <Text variant="meta" tone="subtle" numeric truncate tooltipWhenTruncated sx={[styles.status, notice && styles.keeping]}>
            {status}
          </Text>
          <span {...stylex.props(barCard.spacer)} />
          {people.length > 0 ? <PeopleStack people={people} dim={connection === 'reconnecting'} ring="background" /> : null}
          <span {...stylex.props(barCard.caret)}>
            <Icon icon={CaretRight} size={12} weight="bold" />
          </span>
        </button>
        <span role="status" {...stylex.props(barCard.announce)}>
          {notice ? status : (announcement ?? '')}
        </span>
        <div role="group" aria-label="Huddle controls" {...stylex.props(styles.controls)}>
          <HuddleControls shape="bar" devices={devices} {...controls} />
        </div>
      </div>
    </section>
  )
}

const styles = stylex.create({
  status: {
    flexGrow: 0,
    flexShrink: 4,
    minWidth: 0,
  },
  // While the status line is a notice (Reconnecting…, a microphone problem, who shares), it shortens with the name, by their widths.
  keeping: { flexShrink: 1 },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: sizes['--control-28'],
  },
})
