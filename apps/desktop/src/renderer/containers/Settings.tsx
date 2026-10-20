import { memo, Suspense, useEffect, useState } from 'react'
import { prefsGet, prefsSet, MIRROR_READS_PREF, readsCatchUp, type IgnorableChannel, type SendCheckPref, type SettingsSection, type SharingSetting } from '@juno/contract'
import { tidyUpPrefsAtom, setTidyUpPrefs, aiActivityAtom, copyText, nowAtom, getSharingSetting, setSharingSetting, quietDaysAtom, setQuietDays, sendCheckPrefsAtom, aiAvailableAtom, aiAssistOnAtom, setSendCheckPref, liveQuery, runCommand, mirrorReadsAtom, readCatchUpAtom, accentAtom, densityAtom, homeThoughtsOnAtom, setHomeThoughtsOn, homePicturesOnAtom, setHomePicturesOn, topicTitleLinesAtom, persistTopicTitleLines, type TopicTitleLines, ignorableChannelsAtom, ignoreChannel, ignoredChannelsAtom, peekKeyAtom, stopIgnoring, persistAccent, persistDensity, persistTheme, registry, setPeekKey, setTabExpiry, setWebPanelOn, tabExpiryAtom, themeAtom, webPanelOnAtom, type Accent, type Density, type Theme } from '@juno/state'
import { junoPageActions, junoSettingsAtom } from '@juno/state/agent'
import { useAtom, useAtomValue } from '@juno/state/react'
import { AiActivityPage, IgnoreChannelRow, SettingsAbout, SettingsAppearance, SettingsGeneral, SettingsIgnored, SettingsPage, SettingsTidyUp } from '@juno/views'
import { AppInfo } from './AppInfo'
import { Diagnostics } from './Diagnostics'
import { JunoBackup, JunoConnections, JunoSettings } from './juno/lazy'
import { openGallery, openSettings, showTheTour } from './navigation'
import { NotificationsPage } from './Notifications'
import { QuickReactions } from './QuickReactions'
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
    case 'tidy-up':
      return <TidyUp />
    case 'juno':
      return <JunoSettings />
    case 'ai-activity':
      return <AiActivity />
    case 'connections':
      return <JunoConnections />
    case 'backup':
      return <JunoBackup />
    case 'about':
      return <SettingsAbout build={<AppInfo />} updates={<Updates />} diagnostics={<Diagnostics />} onShowTour={showTheTour} />
  }
}

/** The peek key and fast classifier, saved in the `aiModels` preference as an empty classifier slug when off. */
function General() {
  const servedChecks = useAtomValue(sendCheckPrefsAtom)
  // Each check moves on the click too, until its saved value agrees or the save fails.
  const [shownChecks, setShownChecks] = useState<Partial<Record<SendCheckPref, boolean>>>({})
  const settled = servedChecks.filter(({ key, enabled }) => shownChecks[key] === enabled)
  if (settled.length > 0) setShownChecks(Object.fromEntries(Object.entries(shownChecks).filter(([key]) => !settled.some((check) => check.key === key))))
  const checks = servedChecks.map(({ key, enabled }) => ({ key, enabled: shownChecks[key] ?? enabled }))
  const changeCheck = (key: SendCheckPref, enabled: boolean) => {
    setShownChecks((shown) => ({ ...shown, [key]: enabled }))
    void setSendCheckPref(registry, key, enabled).then((exit) => {
      if (exit._tag === 'Failure') setShownChecks((shown) => Object.fromEntries(Object.entries(shown).filter(([shownKey]) => shownKey !== key)))
    })
  }
  const available = useAtomValue(aiAvailableAtom)
  const aiAssist = useAtomValue(aiAssistOnAtom)
  const grammarUnavailable = !aiAssist ? 'Turn on AI assist to check grammar.' : available._tag !== 'Success' || !available.value ? 'Add an OpenRouter key to check grammar.' : undefined
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
  const peekKey = useAtomValue(peekKeyAtom)
  const servedWebPanel = useAtomValue(webPanelOnAtom)
  const [shownWebPanel, setShownWebPanel] = useState<boolean | undefined>(undefined)
  if (shownWebPanel !== undefined && shownWebPanel === servedWebPanel) setShownWebPanel(undefined)
  const changeWebPanel = (value: boolean) => {
    setShownWebPanel(value)
    void setWebPanelOn(registry, value).then((exit) => {
      if (exit._tag === 'Failure') setShownWebPanel(undefined)
    })
  }
  const [sharing, setSharing] = useSharingSetting()
  const homeThoughts = useAtomValue(homeThoughtsOnAtom)
  const homePictures = useAtomValue(homePicturesOnAtom)
  return <SettingsGeneral hideWhileSharing={sharing.hide} sharingDetection={sharing.detection} onHideWhileSharingChange={setSharing} mirrorReads={shown ?? served} onMirrorReadsChange={changeMirror}
    catchUp={catchUp._tag === 'Success' ? catchUp.value : undefined}
    onCatchUp={() => void runCommand(registry, readsCatchUp, undefined)}
    checks={checks} grammarUnavailable={grammarUnavailable} onCheckChange={changeCheck}
    peekKey={peekKey} onPeekKeyChange={(key) => setPeekKey(registry, key)} homeThoughts={homeThoughts} onHomeThoughtsChange={(on) => setHomeThoughtsOn(registry, on)} homePictures={homePictures} onHomePicturesChange={(on) => setHomePicturesOn(registry, on)} onOpenGallery={() => openGallery()} webPanel={shownWebPanel ?? servedWebPanel} onWebPanelChange={changeWebPanel} classifier={classifier} onClassifierChange={changeClassifier} />
}

/**
 * "Hide message text while sharing the screen", which main holds (screenWatch.ts). Shown on until
 * main answers, as it is by default; the switch moves on the click and takes main's answer after.
 */
function useSharingSetting(): readonly [SharingSetting, (hide: boolean) => void] {
  const [setting, setSetting] = useState<SharingSetting>({ hide: true, detection: 'available' })
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

/** Theme, accent and density, saved to main for the next launch's first frame; then the quick reactions. */
function Appearance() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const [density, setDensity] = useAtom(densityAtom)
  const [topicTitleLines, setTopicTitleLines] = useAtom(topicTitleLinesAtom)
  const changeTopicTitleLines = (next: TopicTitleLines) => {
    setTopicTitleLines(next)
    persistTopicTitleLines(next)
  }
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
  return <SettingsAppearance topicTitleLines={topicTitleLines} onTopicTitleLinesChange={changeTopicTitleLines} theme={theme} accent={accent} density={density} onThemeChange={changeTheme} onAccentChange={changeAccent} onDensityChange={changeDensity} quickReactions={<QuickReactions />} />
}

function Ignored() {
  const ignored = useAtomValue(ignoredChannelsAtom, (result) => (result._tag === 'Success' ? result.value : undefined))
  return <SettingsIgnored addRow={<AddIgnored />} ignored={ignored} onStopIgnoring={(channel) => void stopIgnoring(registry, channel)} />
}

/** The ignore list's add row: Ignore does what Ignore channel in the channel's menu does, with the same toast and Undo. */
function AddIgnored() {
  const channels = useAtomValue(ignorableChannelsAtom, (result) => (result._tag === 'Success' ? result.value : undefined))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<IgnorableChannel | undefined>(undefined)
  // A channel ignored elsewhere meanwhile is no longer a choice.
  const shown = chosen === undefined || channels === undefined || channels.some((channel) => channel.id === chosen.id) ? chosen : undefined
  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }
  const ignore = (channel: IgnorableChannel) => {
    setChosen(undefined)
    void ignoreChannel(registry, { id: channel.id, label: `#${channel.name}` })
  }
  return <IgnoreChannelRow channels={channels} chosen={shown} open={open} onOpen={changeOpen} query={query} onQuery={setQuery} onChoose={setChosen} onIgnore={ignore} />
}

/** Tidy up: topic visibility, tab expiry, what Resolve does, and when Juno suggests a topic. */
function TidyUp() {
  const prefs = useAtomValue(tidyUpPrefsAtom)
  const aiAssist = useAtomValue(aiAssistOnAtom)
  const quietDays = useAtomValue(quietDaysAtom)
  const tabExpiry = useAtomValue(tabExpiryAtom)
  return <SettingsTidyUp quietDays={quietDays} onQuietDaysChange={(days) => setQuietDays(registry, days)} tabExpiry={tabExpiry} onTabExpiryChange={(expiry) => setTabExpiry(registry, expiry)} prefs={prefs} aiAssist={aiAssist} onChange={(next) => setTidyUpPrefs(registry, next)} />
}

/**
 * AI activity: the engine's log of model calls, from the engine and the
 * agent, and today's spend and the daily limit from the agent's ledger,
 * the numbers the limit is checked against.
 */
function AiActivity() {
  const activity = useAtomValue(aiActivityAtom, (result) => (result._tag === 'Success' ? result.value : undefined))
  const juno = useAtomValue(junoSettingsAtom, (result) => (result._tag === 'Success' ? result.value : undefined))
  // A row's time reads "10:42" or "Yesterday": a minute is fine enough.
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / 60_000) * 60_000)
  const spend = juno === undefined ? undefined : {
    spentUsd: juno.spentTodayUsd,
    limitUsd: juno.limitTodayUsd,
    capUsd: juno.capUsd,
    backgroundUsd: juno.backgroundTodayUsd,
    backgroundLimitUsd: juno.backgroundLimitUsd,
  }
  return <AiActivityPage activity={activity} spend={spend} onLimit={(usd) => void junoPageActions(registry).settings({ _tag: 'cap', usd })} now={now} onCopyDetails={copyText} />
}
