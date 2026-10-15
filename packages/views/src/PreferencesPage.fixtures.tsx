import { defineFixtures, fixture } from '@juno/ui'
import { PreferencesPage, type PreferencesPageProps } from './PreferencesPage'

const noop = () => {}
const base: PreferencesPageProps = {
  theme: 'system',
  accent: 'coral',
  density: 'comfortable',
  onThemeChange: noop,
  onAccentChange: noop,
  onDensityChange: noop,
  peekKey: 'option',
  onPeekKeyChange: noop,
  onOpenNotifications: noop,
}

export default defineFixtures(
  PreferencesPage,
  {
    Page: {
      default: fixture(base),
      'dark-teal-compact': fixture({ ...base, theme: 'dark', accent: 'teal', density: 'compact', peekKey: 'space' }),
    },
  },
  { width: 900, height: 600 },
)
