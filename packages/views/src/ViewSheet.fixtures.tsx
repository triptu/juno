import { defineFixtures, fixture } from '@juno/ui'
import { ViewSheet, type ViewSheetProps } from './ViewSheet'

const noop = () => {}

const base: ViewSheetProps = {
  mode: 'new',
  name: '',
  keepOutOfAll: false,
  chosen: [],
  query: '',
  results: [
    { id: 'C0ENG', name: 'eng', kind: 'public' },
    { id: 'D0MAYA', name: 'Maya Chen', kind: 'im' },
    { id: 'G0OFFSITE', name: 'Maya, Leo, Dev', kind: 'mpim' },
    { id: 'C0HIRING', name: 'hiring', kind: 'private' },
  ],
  onNameChange: noop,
  onIconChange: noop,
  onKeepOutOfAllChange: noop,
  onQueryChange: noop,
  onToggle: noop,
  onSave: noop,
  onCancel: noop,
}

const sheet = (props: Partial<ViewSheetProps>) => fixture<ViewSheetProps>({ ...base, ...props })

const alerts = [
  { id: 'C0ALERTSPROD', name: 'alerts-prod', kind: 'public' },
  { id: 'C0ALERTSSTAGING', name: 'alerts-staging', kind: 'public' },
  { id: 'C0DEPLOYS', name: 'deploys', kind: 'public' },
] as const

export default defineFixtures(
  ViewSheet,
  {
    Sheet: {
      // Nothing typed: Save waits for a name; the list offers recent conversations.
      empty: sheet({}),
      filled: sheet({ name: 'Bots', icon: 'robot', keepOutOfAll: true, chosen: alerts, query: 'alerts', results: [...alerts, { id: 'C0ALERTSBILLING', name: 'alerts-billing', kind: 'private' }] }),
      // An edit with no icon and a name at the limit.
      edit: sheet({ mode: 'edit', name: 'Customer escalations and incide', chosen: alerts.slice(0, 1), results: [] }),
      // Many conversations: the list scrolls, the sheet does not grow.
      'many-chosen': sheet({
        name: 'Everything',
        chosen: Array.from({ length: 14 }, (_, i) => ({ id: `C0CH${i}`, name: `channel-${i + 1}`, kind: 'public' as const })),
      }),
    },
  },
  { width: 300, padded: true, surface: 'surface' },
)
