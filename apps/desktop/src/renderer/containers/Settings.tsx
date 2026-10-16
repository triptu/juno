import { memo, Suspense, useEffect, useState } from 'react'
import { prefsGet, prefsSet, MIRROR_READS_PREF, readsCatchUp, type SettingsSection, type SharingSetting } from '@juno/contract'
import { getSharingSetting, setSharingSetting, quietDaysAtom, setQuietDays, liveQuery, runCommand, mirrorReadsAtom, readCatchUpAtom, accentAtom, densityAtom, ignoredChannelsAtom, newTabPageAtom, peekKeyAtom, stopIgnoring, persistAccent, persistDensity, persistTheme, registry, setNewTabPage, setPeekKey, themeAtom, type Accent, type Density, type Theme } from '@juno/state'
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
  const mirror = useAtomValue(mirrorReadsAtom)
  const served = mirror._tag === 'Success' ? mirror.value.on : true
  // The switch moves on the click; the saved value takes over once it agrees, or if the save fails.
  const [shown, setShown] = useState<boolean | undefined>(undefined)
  if (shown !== undefined && shown === served) setShown(undefined)
  const changeMirror = (value: boolean) => {
    setShown(value)
    void runCommand(registry, prefsSet, { key: MIRROR_READS_PREF, value }).then((exit) => {
      if (exit._tag === 'Failure') setShown(undefined)
    })
  }
  const catchUp = useAtomValue(readCatchUpAtom)
  const models = useAtomValue(modelsAtom)
  const modelPrefs = models._tag === 'Success' && typeof models.value === 'object' && models.value !== null && !Array.isArray(models.value) ? models.value : {}
  const classifier = !('classifier' in modelPrefs) || modelPrefs.classifier !== ''
  const changeClassifier = (enabled: boolean) => {
    const value = Object.fromEntries(Object.entries(modelPrefs).filter(([key]) => key !== 'classifier'))
    void runCommand(registry, prefsSet, { key: 'aiModels', value: enabled ? value : { ...value, classifier: '' } })
  }
  const quietDays = useAtomValue(quietDaysAtom)
  const peekKey = useAtomValue(peekKeyAtom)
  const newTabPage = useAtomValue(newTabPageAtom)
  const [sharing, setSharing] = useSharingSetting()
  return <SettingsGeneral hideWhileSharing={sharing.hide} sharingAvailable={sharing.available} onHideWhileSharingChange={setSharing} quietDays={quietDays} onQuietDaysChange={(days) => setQuietDays(registry, days)} mirrorReads={shown ?? served} onMirrorReadsChange={changeMirror}
    catchUp={catchUp._tag === 'Success' ? catchUp.value : { available: 0, pending: 0 }}
    onCatchUp={() => void runCommand(registry, readsCatchUp, undefined)} newTabPage={newTabPage} onNewTabPageChange={(page) => setNewTabPage(registry, page)} peekKey={peekKey} onPeekKeyChange={(key) => setPeekKey(registry, key)} classifier={classifier} onClassifierChange={changeClassifier} />
}

/**
 * "Hide message text while sharing the screen", which main holds (screenWatch.ts). Shown on until
 * main answers, as it is by default; the switch moves on the click and takes main's answer after.
 */
function useSharingSetting(): readonly [SharingSetting, (hide: boolean) => void] {
  const [setting, setSetting] = useState<SharingSetting>({ hide: true, available: true })
  useEffect(() => {
    let active = true
    void getSharingSetting().then((value) => { if (active && value !== undefined) setSetting(value) })
    return () => { active = false }
  }, [])
  const change = (hide: boolean) => {
    setSetting((current) => ({ ...current, hide }))
    void setSharingSetting(hide).then((value) => { if (value !== undefined) setSetting(value) })
  }
  return [setting, change]
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
