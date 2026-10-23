import { defineFixtures, fixture } from './fixtures/define'
import { Segmented } from './Segmented'

const options = [
  { value: 'now', label: 'Now' },
  { value: 'digest', label: 'Digest' },
  { value: 'silent', label: 'Silent' },
]

export default defineFixtures(Segmented, {
  Value: {
    now: fixture({ options, value: 'now', onChange: () => {}, label: 'Decision' }),
    digest: fixture({ options, value: 'digest', onChange: () => {}, label: 'Decision' }),
    silent: fixture({ options, value: 'silent', onChange: () => {}, label: 'Decision' }),
    // Nothing chosen yet: no segment is raised.
    none: fixture({ options, value: null, onChange: () => {}, label: 'Decision' }),
  },
  Interaction: {
    hover: fixture({ options, value: 'now', onChange: () => {}, label: 'Decision' }, { hover: '[role="radio"]:nth-of-type(2)' }),
    'active-press': fixture({ options, value: 'now', onChange: () => {}, label: 'Decision' }, { press: '[role="radio"]:nth-of-type(2)' }),
  },
  Counts: {
    // All topics' status tabs: content-sized segments, the count muted and tabular.
    counts: fixture(
      {
        options: [
          { value: 'all', label: 'All', count: 1430 },
          { value: 'open', label: 'Open', count: 549 },
          { value: 'resolved', label: 'Resolved', count: 17 },
          { value: 'quiet', label: 'Quiet', count: 863 },
          { value: 'unsubscribed', label: 'Unfollowed', count: 1 },
        ],
        value: 'all',
        onChange: () => {},
        label: 'Status',
      },
    ),
  },
  Availability: {
    disabled: fixture({ options, value: 'digest', onChange: () => {}, label: 'Decision', disabled: true }),
  },
})
