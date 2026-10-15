import { AppInfo } from './AppInfo'
import { Updates } from './Updates'
import { accentAtom, densityAtom, ignoredChannelsAtom, peekKeyAtom, stopIgnoring, persistAccent, persistDensity, persistTheme, registry, setPeekKey, themeAtom, type Accent, type Density, type PeekKey, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { PreferencesPage as PreferencesPageView } from '@juno/views'
import { openNotifications } from './navigation'

function changePeekKey(key: PeekKey): void {
  setPeekKey(registry, key)
}

/** Preferences (SPEC 14): Appearance, saved to main for the next launch's first frame, the peek key and the ignore list. */
export function PreferencesPage() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const [density, setDensity] = useAtom(densityAtom)
  const peekKey = useAtomValue(peekKeyAtom)
  const ignored = useAtomValue(ignoredChannelsAtom, (result) => (result._tag === 'Success' ? result.value : undefined))
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
      ignored={ignored}
      onStopIgnoring={(channel) => void stopIgnoring(registry, channel)}
      onOpenNotifications={() => openNotifications()}
    />
  )
}
