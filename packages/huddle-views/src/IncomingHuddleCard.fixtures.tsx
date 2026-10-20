import { defineFixtures, fixture, scene, TooltipLayer, type FixtureFrame } from '@juno/ui'
import { eng, group, hiring, longPlace, maya, noop, others } from './fixtures/data'
import { HuddleBar } from './HuddleBar'
import { IncomingHuddleCard, type IncomingHuddleCardProps } from './IncomingHuddleCard'

/** The card as the sidebar's top slot draws it: in a 384px sidebar, on its fill. */
const frame: FixtureFrame = { width: 384, padded: false, surface: 'subtle' }

const base: IncomingHuddleCardProps = {
  place: eng,
  starter: 'Maya',
  people: others(1),
  pulse: true,
  onOpen: noop,
  onJoin: noop,
  onDismiss: noop,
}

const card = (props: Partial<IncomingHuddleCardProps> = {}) => ({ ...base, ...props })

export default defineFixtures(
  IncomingHuddleCard,
  {
    Place: {
      channel: fixture(card()),
      private: fixture(card({ place: hiring, starter: 'Leo', people: others(2).toReversed() })),
      dm: fixture(card({ place: maya })),
      'group dm': fixture(card({ place: group, people: others(3) })),
      'long name': fixture(card({ place: longPlace, starter: 'Priya', people: others(6) })),
      'narrowest sidebar': fixture(card({ place: longPlace, starter: 'Priya', people: others(6) }), { width: 312 }),
    },
    State: {
      'already in a huddle': fixture(card({ current: '#design' })),
      quiet: fixture(card({ pulse: false })),
      'under the bar': scene(
        () => (
          <>
            <HuddleBar place={hiring} connection="live" duration="12:04" people={others(2)} muted={false} sharing={false} canShare devicesOpen={false} onOpen={noop} onMute={noop} onShare={noop} onDevices={noop} onLeave={noop} />
            <IncomingHuddleCard {...card({ current: '#hiring-loop', people: others(3) })} />
          </>
        ),
      ),
    },
    Interaction: {
      'open hover': fixture(card(), { hover: '[data-incoming-huddle] button' }),
      'join hover': fixture(card(), { hover: '[aria-label^="Join"]' }),
      'join focus': fixture(card(), { focus: '[aria-label^="Join"]' }),
      'dismiss hover': fixture(card(), { hover: '[aria-label="Dismiss"]' }),
      'switch tooltip': scene(
        () => (
          <>
            <IncomingHuddleCard {...card({ current: '#design' })} />
            <TooltipLayer />
          </>
        ),
        { tooltip: '[aria-label^="Switch"]', height: 140 },
      ),
    },
  },
  frame,
)
