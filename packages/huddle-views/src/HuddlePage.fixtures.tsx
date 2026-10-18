import * as stylex from '@stylexjs/stylex'
import { defineFixtures, fixture, type FixtureFrame } from '@juno/ui'
import { eng, maya, noop, others, pictures, you } from './fixtures/data'
import { deviceMenu } from './HuddleDeviceMenu.fixtures'
import { HuddlePage, type HuddleInState, type HuddlePageProps } from './HuddlePage'
import type { HuddleShare } from './model'

/** A huddle tab in a 1200 by 760 window with the sidebar shown. */
const frame: FixtureFrame = { width: 816, height: 716, padded: false }

const inCall: HuddleInState = {
  kind: 'in',
  connection: 'live',
  duration: '12:04',
  muted: false,
  sharing: false,
  canShare: true,
  devicesOpen: false,
  onMute: noop,
  onShare: noop,
  onDevices: noop,
  onLeave: noop,
}

const base: HuddlePageProps = {
  place: eng,
  state: inCall,
  people: [you, ...others(2)],
  onPlace: noop,
  onOpenThread: noop,
}

// The container's video element in a real tab; a drawn screen here, fitted the same way.
const pictureFor: Record<string, string> = { maya: pictures.maya, leo: pictures.leo, tall: pictures.tall }
const renderShare = (id: string) => <img alt="" src={pictureFor[id] ?? pictures.maya} draggable={false} {...stylex.props(styles.picture)} />

const mayaShare: HuddleShare = { id: 'maya', ownerName: 'Maya' }
const leoShare: HuddleShare = { id: 'leo', ownerName: 'Leo' }

const page = (props: Partial<HuddlePageProps> = {}, state: Partial<HuddleInState> = {}) => ({ ...base, ...props, state: props.state ?? { ...inCall, ...state } })

export default defineFixtures(
  HuddlePage,
  {
    'Audio only': {
      'two people': fixture(page()),
      'five people': fixture(page({ people: [you, ...others(4, { speaking: 'U0LEO', muted: ['U0PRIYA'] })] })),
      'nine people': fixture(page({ people: [you, ...others(9, { muted: ['U0MAYA', 'U0SAM'] })] }, { duration: '1:02:33' })),
      'you speaking': fixture(page({ people: [{ ...you, speaking: true }, ...others(2)] })),
      'you muted': fixture(page({ people: [{ ...you, muted: true }, ...others(2)] }, { muted: true })),
      alone: fixture(page({ people: [you] })),
      dm: fixture(page({ place: maya, people: [you, ...others(1)] })),
      'no thread yet': fixture(page({ onOpenThread: undefined })),
    },
    'One share': {
      watching: fixture(page({ people: [you, ...others(3, { speaking: 'U0MAYA' })], shares: [mayaShare], renderShare })),
      loading: fixture(page({ people: [you, ...others(3)], shares: [{ ...mayaShare, loading: true }], renderShare })),
      'tall screen': fixture(page({ people: [you, ...others(3)], shares: [{ id: 'tall', ownerName: 'Priya' }], renderShare })),
      'many people': fixture(page({ people: [you, ...others(9, { muted: ['U0LEO'] })], shares: [mayaShare], renderShare })),
    },
    'Two shares': {
      'side by side': fixture(page({ people: [you, ...others(4)], shares: [mayaShare, leoShare], renderShare }, { shareFull: true })),
      stacked: fixture(page({ people: [you, ...others(4)], shares: [mayaShare, leoShare], renderShare }, { shareFull: true }), { width: 600, height: 716 }),
      expanded: fixture(page({ people: [you, ...others(4)], shares: [mayaShare, leoShare], renderShare, expandedShare: 'leo' }, { shareFull: true })),
      'expand hover': fixture(page({ people: [you, ...others(4)], shares: [mayaShare, leoShare], renderShare }, { shareFull: true }), { ...frame, hover: '[data-share="maya"]' }),
    },
    You: {
      sharing: fixture(page({ people: [you, ...others(2)] }, { sharing: true, sharingSource: 'Entire screen' })),
      'sharing while watching': fixture(page({ people: [you, ...others(3)], shares: [mayaShare], renderShare }, { sharing: true, sharingSource: 'Q4 roadmap — Docs' })),
      'mic blocked': fixture(page({}, { micBlocked: true, muted: true, onOpenMicSettings: noop })),
      devices: fixture(page({ devices: deviceMenu() }, { devicesOpen: true })),
    },
    Connection: {
      joining: fixture(page({}, { connection: 'joining' })),
      reconnecting: fixture(page({ people: [you, ...others(3)] }, { connection: 'reconnecting' })),
    },
    'Not in it': {
      running: fixture(page({ people: others(3), state: { kind: 'out', duration: '8:12', onJoin: noop } })),
      'in another huddle': fixture(page({ people: others(3), state: { kind: 'out', duration: '8:12', switching: true, onJoin: noop } })),
      ended: fixture(page({ people: [], state: { kind: 'ended', lasted: '24 minutes' } })),
      'ended, no thread': fixture(page({ people: [], onOpenThread: undefined, state: { kind: 'ended', lasted: '3 minutes' } })),
    },
    Failure: {
      full: fixture(page({ people: others(3), state: { kind: 'failed', reason: 'This huddle is full.', onRetry: noop } })),
      'turned off': fixture(page({ people: [], onOpenThread: undefined, state: { kind: 'failed', reason: 'Huddles are turned off in this workspace.', onRetry: noop } })),
      'no answer': fixture(page({ people: [], state: { kind: 'failed', reason: "Slack didn't answer. Try again in a moment.", onRetry: noop } })),
    },
  },
  frame,
)

const styles = stylex.create({
  picture: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
})
