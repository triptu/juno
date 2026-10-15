import { AppInfo } from './AppInfo'
import { Updates } from './Updates'
import { accentAtom, densityAtom, peekKeyAtom, persistAccent, persistDensity, persistTheme, registry, setPeekKey, themeAtom, type Accent, type Density, type PeekKey, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { PreferencesPage as PreferencesPageView } from '@juno/views'
import { openNotifications } from './navigation'

function changePeekKey(key: PeekKey): void {
  setPeekKey(registry, key)
}

/** Preferences (SPEC 14): Appearance, saved to main for the next launch's first frame, and the peek key. */
export function PreferencesPage() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const [density, setDensity] = useAtom(densityAtom)
  const peekKey = useAtomValue(peekKeyAtom)
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
      about={<><AppInfo /><Updates /></>}
      theme={theme}
      accent={accent}
      density={density}
      onThemeChange={changeTheme}
      onAccentChange={changeAccent}
      onDensityChange={changeDensity}
      peekKey={peekKey}
      onPeekKeyChange={changePeekKey}
      onOpenNotifications={() => openNotifications()}
    />
  )
}
