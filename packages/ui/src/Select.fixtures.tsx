import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { Select } from './Select'

const kinds = [
  { value: 'all', label: 'Channels and DMs' },
  { value: 'channels', label: 'Channels' },
  { value: 'dms', label: 'DMs' },
]

export default defineFixtures(Select, {
  Value: {
    default: fixture({ options: kinds, defaultValue: 'all', label: 'Kind' }),
    small: fixture({ options: kinds, defaultValue: 'all', size: 30, label: 'Kind' }),
  },
  'In context': {
    'filter-row': scene(() => (
      <Row gap="sm">
        <Select size={30} label="Kind" options={kinds} defaultValue="all" />
        <Select
          size={30}
          label="Where"
          options={[
            { value: 'any', label: 'Anywhere' },
            { value: 'eng', label: '#eng' },
            { value: 'maya', label: 'Maya Chen' },
          ]}
          defaultValue="any"
        />
        <Select
          size={30}
          label="Sort"
          options={[
            { value: 'recent', label: 'Most recent' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'most', label: 'Most messages' },
          ]}
          defaultValue="recent"
        />
      </Row>
    )),
  },
  Interaction: {
    hover: fixture({ options: kinds, defaultValue: 'all', label: 'Kind' }, { hover: 'select' }),
  },
  Availability: {
    disabled: fixture({ options: kinds, defaultValue: 'all', label: 'Kind', disabled: true }),
  },
})
