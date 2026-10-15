import { accentAtom, densityAtom, persistAccent, persistDensity, persistTheme, themeAtom, type Accent, type Density, type Theme } from '@juno/state'
import { useAtom } from '@juno/state/react'
import { PreferencesPage as PreferencesPageView } from '@juno/views'
import { openNotifications } from './navigation'

/** Preferences (SPEC 14): Appearance, saved to main for the next launch's first frame. */
export function PreferencesPage() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const [density, setDensity] = useAtom(densityAtom)
  const changeTheme = (next: Theme) => {
    setTheme(next)
    persistTheme(next)
  }
  const changeAccent = (next: Accent) => {
    setAccent(next)
    persistAccent(next)
  }
  const changeDensity = (next: Density) => {
    setDensity(next)
    persistDensity(next)
  }
  return (
    <PreferencesPageView
      theme={theme}
      accent={accent}
      density={density}
      onThemeChange={changeTheme}
      onAccentChange={changeAccent}
      onDensityChange={changeDensity}
      onOpenNotifications={() => openNotifications()}
    />
  )
}
