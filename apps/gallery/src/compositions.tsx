/**
 * Views from two packages drawn together, as the app will compose them.
 * The gallery is the one place that depends on both, so these live here.
 *
 * `HuddleInSidebar` puts the huddle bar (`@juno/huddle-views`) in the real
 * sidebar's (`@juno/views`) `top` slot, under the title bar.
 */
import * as stylex from '@stylexjs/stylex'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { HuddleBar, HuddleDeviceMenu, type HuddleBarProps, type HuddlePerson } from '@juno/huddle-views'
import { defineFixtures, scene, type FixtureFrame, type FixtureSet } from '@juno/ui'
import { fixtures as views } from '@juno/views/fixtures'

const noop = () => {}

interface SidebarWithBarProps {
  readonly bar: ReactNode
}

// The Sidebar's own List/default state (its rows, filters and title bar), with the bar in its `top` slot.
function SidebarWithBar({ bar }: SidebarWithBarProps) {
  const state = views['Sidebar']?.groups.find((group) => group.id === 'list')?.states.find((entry) => entry.key === 'default')
  const sidebar = state?.fixture.render?.()
  return <div {...stylex.props(styles.root)}>{isValidElement(sidebar) ? cloneElement(sidebar as ReactElement<{ top?: ReactNode }>, { top: bar }) : null}</div>
}

const people: ReadonlyArray<HuddlePerson> = [
  { id: 'U0MAYA', name: 'Maya Chen', initials: 'MC', hue: 'rose' },
  { id: 'U0LEO', name: 'Leo Park', initials: 'LP', hue: 'emerald' },
  { id: 'U0PRIYA', name: 'Priya Natarajan', initials: 'PN', hue: 'plum' },
  { id: 'U0SAM', name: 'Sam Okafor', initials: 'SO', hue: 'midnight' },
  { id: 'U0ALEX', name: 'Alex Kim', initials: 'AK', hue: 'emeraldDark' },
]

const base: HuddleBarProps = {
  place: { name: 'eng', kind: 'public' },
  connection: 'live',
  duration: '12:04',
  people: people.slice(0, 2),
  muted: false,
  sharing: false,
  canShare: true,
  devicesOpen: false,
  onOpen: noop,
  onMute: noop,
  onShare: noop,
  onDevices: noop,
  onLeave: noop,
}

const devices = (
  <HuddleDeviceMenu
    microphones={[{ id: 'mic-airpods', name: 'AirPods Pro' }]}
    speakers={[{ id: 'out-airpods', name: 'AirPods Pro' }]}
    systemMicrophone="MacBook Pro Microphone"
    systemSpeaker="MacBook Pro Speakers"
    microphone="system"
    speaker="system"
    noiseReduction
    onMicrophone={noop}
    onSpeaker={noop}
    onNoiseReduction={noop}
  />
)

const inSidebar = (props: Partial<HuddleBarProps> = {}, frame?: FixtureFrame) => scene<SidebarWithBarProps>(() => <SidebarWithBar bar={<HuddleBar {...base} {...props} />} />, frame)

const frame: FixtureFrame = { width: 384, height: 720, padded: false, surface: 'subtle' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const compositions: Readonly<Record<string, FixtureSet<any>>> = {
  HuddleInSidebar: defineFixtures(
    SidebarWithBar,
    {
      Bar: {
        'two people': inSidebar(),
        speaking: inSidebar({ people: people.slice(0, 3).map((person) => (person.id === 'U0LEO' ? { ...person, speaking: true } : person)) }),
        muted: inSidebar({ muted: true, people: people.slice(0, 4) }),
        'someone sharing': inSidebar({ people: people.slice(0, 3), sharers: ['Maya'] }),
        reconnecting: inSidebar({ connection: 'reconnecting', people: people.slice(0, 3) }),
        alone: inSidebar({ people: [], duration: '0:42' }),
        devices: inSidebar({ devicesOpen: true, devices }),
        'five people sharing': inSidebar({ people, sharers: ['Maya', 'Leo'] }),
      },
    },
    frame,
  ),
}

const styles = stylex.create({
  root: {
    display: 'flex',
    height: '100%',
  },
})
