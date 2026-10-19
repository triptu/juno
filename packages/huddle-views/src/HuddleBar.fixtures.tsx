import { defineFixtures, fixture, scene, TooltipLayer, type FixtureFrame } from '@juno/ui'
import { eng, group, hiring, longPlace, maya, noop, others } from './fixtures/data'
import { deviceMenu } from './HuddleDeviceMenu.fixtures'
import { HuddleBar, type HuddleBarProps } from './HuddleBar'

/** The bar as the sidebar's top slot draws it: in a 384px sidebar, on its fill. */
const frame: FixtureFrame = { width: 384, padded: false, surface: 'subtle' }

const base: HuddleBarProps = {
  place: eng,
  connection: 'live',
  duration: '12:04',
  people: others(2),
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

const bar = (props: Partial<HuddleBarProps> = {}) => ({ ...base, ...props })

export default defineFixtures(
  HuddleBar,
  {
    People: {
      alone: fixture(bar({ people: [], duration: '0:42' })),
      'two people': fixture(bar()),
      'five people': fixture(bar({ people: others(5), duration: '48:17' })),
      'nine people': fixture(bar({ people: others(9), duration: '1:02:33' })),
      speaking: fixture(bar({ people: others(3, { speaking: 'U0LEO' }) })),
    },
    You: {
      muted: fixture(bar({ muted: true })),
      'mic blocked': fixture(bar({ microphone: 'blocked', muted: true, onOpenMicSettings: noop })),
      'no microphone': fixture(bar({ microphone: 'missing', muted: true })),
      'sharing a screen': fixture(bar({ sharing: true, sharingSource: 'Built-in display' })),
      'sharing a window': fixture(bar({ sharing: true, sharingSource: 'Q4 roadmap — Docs' })),
    },
    Sharing: {
      'someone sharing': fixture(bar({ people: others(3), sharers: ['Maya'] })),
      'two sharing': fixture(bar({ people: others(4), sharers: ['Maya', 'Leo'], shareFull: true })),
      'you and someone': fixture(bar({ people: others(3), sharers: ['Maya'], sharing: true, sharingSource: 'Built-in display' })),
    },
    Connection: {
      joining: fixture(bar({ connection: 'joining', people: others(2) })),
      reconnecting: fixture(bar({ connection: 'reconnecting', people: others(3) })),
    },
    Place: {
      private: fixture(bar({ place: hiring })),
      dm: fixture(bar({ place: maya, people: others(1) })),
      'group dm': fixture(bar({ place: group, people: others(3) })),
      'long name': fixture(bar({ place: longPlace, people: others(4), sharers: ['Priya'] })),
      'narrowest sidebar': fixture(bar({ place: longPlace, people: others(5), sharers: ['Maya', 'Leo'] }), { width: 312 }),
    },
    // Phase 3 ships without screen share: the button takes no room until it is offered.
    'Audio only': {
      'no share button': fixture(bar({ canShare: false })),
    },
    Menu: {
      devices: fixture(bar({ devicesOpen: true, devices: deviceMenu() }), { height: 420 }),
    },
    Interaction: {
      'open hover': fixture(bar(), { hover: '[data-huddle-bar] button' }),
      'open press': fixture(bar(), { press: '[data-huddle-bar] button' }),
      'open focus': fixture(bar(), { focus: '[data-huddle-bar] button' }),
      'mute hover': fixture(bar(), { hover: '[aria-label^="Mute"]' }),
      'leave hover': fixture(bar(), { hover: '[data-huddle-bar] [role="group"] > :last-child > button' }),
      'mute tooltip': scene(
        () => (
          <>
            <HuddleBar {...bar()} />
            <TooltipLayer />
          </>
        ),
        { tooltip: '[aria-label^="Mute"]', height: 120 },
      ),
    },
  },
  frame,
)
