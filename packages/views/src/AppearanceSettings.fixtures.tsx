import { defineFixtures, fixture } from '@juno/ui'
import { AppearanceSettings } from './AppearanceSettings'

const noop = () => {}

export default defineFixtures(AppearanceSettings, {
  Theme: {
    'light-coral': fixture({ theme: 'light', accent: 'coral', onThemeChange: noop, onAccentChange: noop }),
    'dark-coral': fixture({ theme: 'dark', accent: 'coral', onThemeChange: noop, onAccentChange: noop }),
  },
  Accent: {
    'light-teal': fixture({ theme: 'light', accent: 'teal', onThemeChange: noop, onAccentChange: noop }),
    'light-ink': fixture({ theme: 'light', accent: 'ink', onThemeChange: noop, onAccentChange: noop }),
  },
  System: {
    'system-density': fixture({ theme: 'system', accent: 'coral', density: 'compact', onThemeChange: noop, onAccentChange: noop, onDensityChange: noop }),
  },
  Layout: {
    stacked: fixture({ theme: 'light', accent: 'coral', layout: 'stack', onThemeChange: noop, onAccentChange: noop }, { width: 300 }),
  },
  Interaction: {
    'hover-swatch': fixture({ theme: 'light', accent: 'coral', onThemeChange: noop, onAccentChange: noop }, { hover: '[role="group"] button:nth-of-type(4)' }),
    'focus-swatch': fixture({ theme: 'light', accent: 'coral', onThemeChange: noop, onAccentChange: noop }, { focus: '[role="group"] button:nth-of-type(4)' }),
  },
})
