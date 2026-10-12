import { defineFixtures, fixture } from '@juno/ui'
import { ThemeToggleView } from './ThemeToggleView'

export default defineFixtures(ThemeToggleView, {
  light: fixture({ theme: 'light', onToggle: () => {} }),
  dark: fixture({ theme: 'dark', onToggle: () => {} }),
  hover: fixture({ theme: 'light', onToggle: () => {} }, { hover: 'button' }),
})
