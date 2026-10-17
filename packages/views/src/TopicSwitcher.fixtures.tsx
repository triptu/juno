import * as stylex from '@stylexjs/stylex'
import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { engTopics } from './fixtures/messages'
import { art, NOW } from './fixtures/topics'
import { TopicSwitcher, type TopicSwitcherProps } from './TopicSwitcher'

const noop = () => {}

// Drawn art on Main and the first threads; the rest show the placeholder, as before their art is drawn.
const drawn = [art.database, art.calendar, art.coins]

const base: TopicSwitcherProps = {
  mainId: 'C0ENG:main',
  mainUnread: 3,
  mainArt: art.people,
  currentId: 'C0ENG:1760000000.000100',
  threads: engTopics.map((thread, i) => (drawn[i] === undefined ? thread : { ...thread, art: drawn[i] })),
  now: NOW,
  query: '',
  onQuery: noop,
  onOpen: noop,
}

// A thread whose title is too long for the row, first after Main, so the ellipsis shows.
const long = {
  ...engTopics[0]!,
  id: 'C0ENG:1760000000.000900',
  title: 'Two options for the thread list: compact rows versus two-line previews, and what we lose with each one',
}

// The popover's width (`--menu-width-browse` 300), on the popover's surface.
const frame: FixtureFrame = { width: 300, surface: 'surface', padded: false }

// As wide as the frame, as the popover's panel makes it; the frame alone sizes it to its longest row.
const fixture = (props: TopicSwitcherProps, at: FixtureFrame) =>
  scene<TopicSwitcherProps>(
    () => (
      <div {...stylex.props(styles.panel)}>
        <TopicSwitcher {...props} />
      </div>
    ),
    at,
  )

const styles = stylex.create({
  panel: { alignSelf: 'stretch' },
})

export default defineFixtures(
  TopicSwitcher,
  {
    List: {
      thread: fixture(base, frame),
      main: fixture({ ...base, currentId: 'C0ENG:main' }, frame),
      loading: fixture({ ...base, threads: undefined }, frame),
      'long-title': fixture({ ...base, threads: [long, ...base.threads!] }, frame),
      'nothing-else': fixture({ ...base, threads: [], mainUnread: 0, currentId: 'C0ENG:main' }, frame),
    },
    Search: {
      search: fixture({ ...base, query: 'postgres' }, frame),
      'search-resolved': fixture({ ...base, query: 'pin' }, frame),
      'no-match': fixture({ ...base, query: 'kubernetes' }, frame),
    },
    Interaction: {
      'hover-row': fixture(base, { ...frame, hover: '[role="option"]:nth-of-type(3)' }),
    },
  },
)
