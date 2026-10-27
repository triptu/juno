import { defineFixtures, fixture } from '@juno/ui'
import { ChannelSheet, type ChannelSheetProps } from './ChannelSheet'
import { people } from './fixtures/topics'

const noop = () => {}

const recent = [people.maya, people.leo, people.dev, people.sam, people.priya]

const sheet = (props: Partial<ChannelSheetProps>) =>
  fixture<ChannelSheetProps>({
    mode: 'new',
    name: '',
    adjusted: false,
    isPrivate: false,
    members: [],
    query: '',
    results: recent,
    onNameChange: noop,
    onPrivateChange: noop,
    onQueryChange: noop,
    onToggle: noop,
    onRemove: noop,
    onSubmit: noop,
    onCancel: noop,
    ...props,
  })

export default defineFixtures(
  ChannelSheet,
  {
    New: {
      empty: sheet({}),
      // "Launch Plan" as typed: Slack's rules made it lowercase with a hyphen, and the line says so.
      adjusted: sheet({ name: 'launch-plan', adjusted: true }),
      'private-with-members': sheet({ name: 'launch-plan', isPrivate: true, members: [people.maya, people.leo], results: [people.maya, people.leo, people.dev] }),
      'name-taken': sheet({ name: 'launch-plan', error: 'That name is taken.' }),
      creating: sheet({ name: 'launch-plan', members: [people.maya], busy: true }),
      // An 80-character name and a long person name keep inside the sheet.
      'long-names': sheet({ name: 'quarterly-planning-for-the-platform-infrastructure-and-reliability-working-group', members: [people.mohammed, { ...people.priya, name: 'Priya Raman-Subramanian from Platform Reliability' }] }),
    },
    Edit: {
      members: sheet({ mode: 'edit', name: 'launch-plan', members: [people.maya, people.leo, people.sam] }),
      loading: sheet({ mode: 'edit', name: 'launch-plan', membersLoading: true }),
      searching: sheet({ mode: 'edit', name: 'launch-plan', members: [people.maya], query: 'pr', results: [people.priya] }),
    },
  },
  { width: 520, padded: true, surface: 'subtle' },
)
