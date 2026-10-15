import { defineFixtures, fixture, type FixtureFrame } from '@juno/ui'
import { engTopics } from './fixtures/messages'
import { NOW } from './fixtures/topics'
import { TopicSwitcher, type TopicSwitcherProps } from './TopicSwitcher'

const noop = () => {}

const base: TopicSwitcherProps = {
  mainId: 'C0ENG:main',
  mainUnread: 3,
  currentId: 'C0ENG:1760000000.000100',
  threads: engTopics,
  now: NOW,
  query: '',
  onQuery: noop,
  onOpen: noop,
  onClose: noop,
}

// The popover's width (`--browse-width`), on the popover's surface.
const frame: FixtureFrame = { width: 360, surface: 'surface', padded: false }

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
