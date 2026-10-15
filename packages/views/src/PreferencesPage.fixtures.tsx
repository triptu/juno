import { defineFixtures, fixture } from '@juno/ui'
import { PreferencesPage, type PreferencesPageProps } from './PreferencesPage'

const noop = () => {}
const base: PreferencesPageProps = {
  newTabPage: 'newChat',
  onNewTabPageChange: noop,
  classifier: true,
  onClassifierChange: noop,
  theme: 'system',
  accent: 'coral',
  density: 'comfortable',
  onThemeChange: noop,
  onAccentChange: noop,
  onDensityChange: noop,
  peekKey: 'option',
  onPeekKeyChange: noop,
  ignored: [],
  onStopIgnoring: noop,
  onOpenNotifications: noop,
}

const ignored: PreferencesPageProps['ignored'] = [
  { id: 'C1', name: 'deploys', kind: 'public', hidden: 3 },
  { id: 'C2', name: 'alerts-prod', kind: 'public', hidden: 1000 },
  { id: 'C3', name: 'oncall-pages', kind: 'private', hidden: 1 },
  { id: 'C4', name: 'ci-builds', kind: 'public', hidden: 0 },
]

export default defineFixtures(
  PreferencesPage,
  {
    Page: {
      default: fixture(base),
      'new-tab-home': fixture({ ...base, newTabPage: 'home' }),
      'classifier-off': fixture({ ...base, classifier: false }),
      ignored: fixture({ ...base, ignored }),
      'ignored-loading': fixture({ ...base, ignored: undefined }),
      'dark-teal-compact': fixture({ ...base, theme: 'dark', accent: 'teal', density: 'compact', peekKey: 'space' }),
    },
  },
  { width: 900, height: 900 },
)
