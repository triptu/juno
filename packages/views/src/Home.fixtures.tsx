import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { homeItems, rewritten } from './fixtures/home'
import { NOW } from './fixtures/topics'
import { Home, type HomeProps } from './Home'
import { HomeScene, type HomeSceneName } from './HomeScene'

const noop = () => {}

const base: HomeProps = {
  scene: 'morning',
  title: 'Morning, Tushar.',
  line: 'Three things want you.',
  items: [homeItems.waiting, homeItems.resume, homeItems.moved],
  now: NOW,
  caughtUp: false,
  enter: false,
  onOpen: noop,
  onMarkDone: noop,
  onResolveAll: noop,
  onAsk: noop,
  onBrowseAll: noop,
}

const state = (props: Partial<HomeProps> = {}, frame?: FixtureFrame) => fixture<HomeProps>({ ...base, ...props }, frame)

const scenes: ReadonlyArray<HomeSceneName> = ['morning', 'midday', 'evening', 'night', 'friday', 'winter', 'autumn', 'caughtUp']

const strip = stylex.create({ row: { display: 'flex', flexWrap: 'wrap', gap: spacing['--space-6'] } })

export default defineFixtures(
  Home,
  {
    Items: {
      three: state(),
      // The same rows with the assistant's title lines: every box stays where it was (gallery behaviour test).
      'ai-titles': state({ items: [rewritten.waiting, rewritten.resume, rewritten.moved] }),
      'follow-up-and-tidy-up': state({ scene: 'evening', title: 'Evening, Tushar.', items: [homeItems.waiting, homeItems.followUp, homeItems.tidyUp] }),
      'buttons-used': state({ scene: 'evening', title: 'Evening, Tushar.', items: [homeItems.waiting, homeItems.followUp, homeItems.tidyUp], done: new Set([homeItems.followUp.id, homeItems.tidyUp.id]) }),
      one: state({ scene: 'friday', title: 'Happy Friday, Tushar.', line: 'One thing wants you.', items: [homeItems.resume] }),
      'short-window': state({ line: 'Two things want you.', items: [homeItems.waiting, homeItems.resume] }, { width: 720, height: 520, padded: false }),
    },
    Empty: {
      'caught-up': state({ scene: 'caughtUp', title: 'All caught up.', line: 'Nothing is waiting on you.', items: [], caughtUp: true }),
      'nothing-waiting': state({ scene: 'night', title: 'Still up, Tushar.', line: 'Nothing is waiting on you.', items: [] }),
      'no-name': state({ scene: 'midday', title: 'Hello.', line: 'One thing wants you.', items: [homeItems.waiting] }),
    },
    Interaction: {
      'hover-row': state({}, { width: 720, height: 560, padded: false, hover: '[data-home-item="waiting"] a' }),
      'focus-row': state({}, { width: 720, height: 560, padded: false, focus: '[data-home-item="resume"] a' }),
      'hover-follow-up': state({ items: [homeItems.waiting, homeItems.followUp, homeItems.tidyUp] }, { width: 720, height: 560, padded: false, hover: '[data-home-item="followUp"] a' }),
      'hover-ask': state({}, { width: 720, height: 560, padded: false, hover: 'button[aria-label="Ask Juno"]' }),
      entrance: state({ enter: true }),
    },
    Overview: {
      scenes: scene(
        () => (
          <div {...stylex.props(strip.row)}>
            {scenes.map((name) => (
              <HomeScene key={name} name={name} />
            ))}
          </div>
        ),
        { width: 640 },
      ),
    },
  },
  { width: 720, height: 560, padded: false },
)
