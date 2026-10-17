import { defineFixtures, fixture, type FixtureFrame } from '@juno/ui'
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

// The popover's width (`--menu-width-browse` 300), on the popover's surface.
const frame: FixtureFrame = { width: 300, surface: 'surface', padded: false }

export default defineFixtures(
  TopicSwitcher,
  {
    List: {
      thread: fixture(base, frame),
      main: fixture({ ...base, currentId: 'C0ENG:main' }, frame),
      loading: fixture({ ...base, threads: undefined }, frame),
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
