/**
 * Views from two packages drawn together, as the app will compose them.
 * The gallery is the one place that depends on both, so these live here.
 *
 * `HuddleInSidebar` puts the huddle bar (`@juno/huddle-views`) in the real
 * sidebar's (`@juno/views`) `top` slot, under the title bar.
 *
 * `TopicHeaderInPage` puts the huddle control (`@juno/huddle-views`) in the
 * topic header (`@juno/views`) of the Workspace's Header pages, as the
 * app's container decides it.
 */
import * as stylex from '@stylexjs/stylex'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { HuddleBar, HuddleDeviceMenu, HuddleHeaderButton, type HuddleBarProps, type HuddleHeaderMode, type HuddlePerson } from '@juno/huddle-views'
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

interface HeaderPageProps {
  /** A state of the Workspace's Header group. */
  readonly page: string
  readonly huddle?: HuddleHeaderMode
}

type Element<P> = ReactElement<P & { readonly children?: ReactNode }>

// The Workspace's page with the huddle control in its topic header's `actions`.
function HeaderPage({ page, huddle }: HeaderPageProps) {
  const state = views['Workspace']?.groups.find((group) => group.id === 'header')?.states.find((entry) => entry.key === page)
  const workspace = state?.fixture.render?.()
  if (!isValidElement(workspace)) return null
  const topic = (workspace as Element<object>).props.children
  if (huddle === undefined || !isValidElement(topic)) return workspace
  const view = topic as Element<{ header?: ReactNode }>
  const header = view.props.header
  if (!isValidElement(header)) return workspace
  const control = <HuddleHeaderButton mode={huddle} people={people.slice(0, 3)} place="#eng" current="#design" onClick={noop} />
  return cloneElement(workspace as Element<object>, {}, cloneElement(view, { header: cloneElement(header as Element<{ actions?: ReactNode }>, { actions: control }) }))
}

const headerPage = (page: string, huddle?: HuddleHeaderMode) => scene<HeaderPageProps>(() => <HeaderPage page={page} {...(huddle === undefined ? {} : { huddle })} />, { width: 1100, height: 640, padded: false })

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
  TopicHeaderInPage: defineFixtures(
    HeaderPage,
    {
      Header: {
        'dm-thread': headerPage('dm-thread', 'start'),
        'dm-main': headerPage('dm-main', 'start'),
        'channel-main': headerPage('channel-main', 'start'),
        'channel-main-huddle': headerPage('channel-main', 'join'),
        'thread-resolve': headerPage('thread-resolve'),
        'thread-follow': headerPage('thread-follow'),
      },
    },
    { width: 1100, height: 640, padded: false },
  ),
}

const styles = stylex.create({
  root: {
    display: 'flex',
    height: '100%',
  },
})
