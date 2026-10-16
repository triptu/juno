import { memo, Suspense } from 'react'
import { prefsGet, prefsSet, type SettingsSection } from '@juno/contract'
import { sendCheckPrefsAtom, aiAvailableAtom, aiAssistOnAtom, setSendCheckPref, liveQuery, runCommand, accentAtom, densityAtom, ignoredChannelsAtom, newTabPageAtom, peekKeyAtom, stopIgnoring, persistAccent, persistDensity, persistTheme, registry, setNewTabPage, setPeekKey, themeAtom, type Accent, type Density, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { SettingsAbout, SettingsAppearance, SettingsGeneral, SettingsIgnored, SettingsPage } from '@juno/views'
import { AppInfo } from './AppInfo'
import { EngineStatus } from './EngineStatus'
import { JunoBackup, JunoConnections, JunoSettings } from './juno/lazy'
import { openSettings } from './navigation'
import { NotificationsPage } from './Notifications'
import { Updates } from './Updates'

const modelsAtom = liveQuery(prefsGet)({ key: 'aiModels' })

function selectSection(section: SettingsSection): void {
  openSettings(section)
}

/**
 * Settings (SPEC 14) in its tab: the list of sections and the open
 * section. Juno, Connections and Backup & This Mac come from the Juno
 * chunk, as the Juno pages do.
 */
export const SettingsTab = memo(function SettingsTab({ section }: { readonly section: SettingsSection }) {
  return (
    <SettingsPage section={section} onSection={selectSection}>
      <Suspense fallback={null}>
        <Section section={section} />
      </Suspense>
    </SettingsPage>
  )
})

function Section({ section }: { readonly section: SettingsSection }) {
  switch (section) {
    case 'general':
      return <General />
    case 'appearance':
      return <Appearance />
    case 'notifications':
      return <NotificationsPage />
    case 'ignored':
      return <Ignored />
    case 'juno':
      return <JunoSettings />
    case 'connections':
      return <JunoConnections />
    case 'backup':
      return <JunoBackup />
    case 'about':
      return <SettingsAbout build={<AppInfo />} updates={<Updates />} diagnostics={<EngineStatus />} />
  }
}

/** What a new tab opens, the peek key, and the fast classifier, saved in the `aiModels` preference as an empty classifier slug when off. */
function General() {
  const checks = useAtomValue(sendCheckPrefsAtom)
  const available = useAtomValue(aiAvailableAtom)
  const aiAssist = useAtomValue(aiAssistOnAtom)
  const grammarUnavailable = !aiAssist ? 'Turn on AI assist to check grammar.' : available._tag !== 'Success' || !available.value ? 'Add an OpenRouter key to check grammar.' : undefined
  const models = useAtomValue(modelsAtom)
  const modelPrefs = models._tag === 'Success' && typeof models.value === 'object' && models.value !== null && !Array.isArray(models.value) ? models.value : {}
  const classifier = !('classifier' in modelPrefs) || modelPrefs.classifier !== ''
  const changeClassifier = (enabled: boolean) => {
    const value = Object.fromEntries(Object.entries(modelPrefs).filter(([key]) => key !== 'classifier'))
    void runCommand(registry, prefsSet, { key: 'aiModels', value: enabled ? value : { ...value, classifier: '' } })
  }
  const peekKey = useAtomValue(peekKeyAtom)
  const newTabPage = useAtomValue(newTabPageAtom)
  return <SettingsGeneral checks={checks} grammarUnavailable={grammarUnavailable} onCheckChange={(key, enabled) => void setSendCheckPref(registry, key, enabled)} newTabPage={newTabPage} onNewTabPageChange={(page) => setNewTabPage(registry, page)} peekKey={peekKey} onPeekKeyChange={(key) => setPeekKey(registry, key)} classifier={classifier} onClassifierChange={changeClassifier} />
}

/** Theme, accent and density, saved to main for the next launch's first frame. */
function Appearance() {
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
  return <SettingsAppearance theme={theme} accent={accent} density={density} onThemeChange={changeTheme} onAccentChange={changeAccent} onDensityChange={changeDensity} />
}

function Ignored() {
  const ignored = useAtomValue(ignoredChannelsAtom, (result) => (result._tag === 'Success' ? result.value : undefined))
  return <SettingsIgnored ignored={ignored} onStopIgnoring={(channel) => void stopIgnoring(registry, channel)} />
}
