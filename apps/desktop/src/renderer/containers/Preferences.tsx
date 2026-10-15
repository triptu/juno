import { prefsGet, prefsSet } from '@juno/contract'
import { AppInfo } from './AppInfo'
import { Updates } from './Updates'
import { liveQuery, runCommand, accentAtom, densityAtom, ignoredChannelsAtom, peekKeyAtom, stopIgnoring, persistAccent, persistDensity, persistTheme, registry, setPeekKey, themeAtom, type Accent, type Density, type PeekKey, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { PreferencesPage as PreferencesPageView } from '@juno/views'
import { openNotifications } from './navigation'

const modelsAtom = liveQuery(prefsGet)({ key: 'aiModels' })

function changePeekKey(key: PeekKey): void {
  setPeekKey(registry, key)
}

/** Preferences (SPEC 14): Appearance, saved to main for the next launch's first frame, the peek key and the ignore list. */
export function PreferencesPage() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const [density, setDensity] = useAtom(densityAtom)
  const models = useAtomValue(modelsAtom)
  const modelPrefs = models._tag === 'Success' && typeof models.value === 'object' && models.value !== null && !Array.isArray(models.value) ? models.value : {}
  const classifier = !('classifier' in modelPrefs) || modelPrefs.classifier !== ''
  const changeClassifier = (enabled: boolean) => {
    const value = Object.fromEntries(Object.entries(modelPrefs).filter(([key]) => key !== 'classifier'))
    void runCommand(registry, prefsSet, { key: 'aiModels', value: enabled ? value : { ...value, classifier: '' } })
  }
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
      classifier={classifier}
      onClassifierChange={changeClassifier}
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
