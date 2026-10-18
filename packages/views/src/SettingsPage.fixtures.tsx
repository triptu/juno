import { DEFAULT_QUICK_REACTIONS, emojiCatalog, sendCheckDefaults, sendCheckPrefKeys, TIDY_UP_DEFAULTS, type AiActivity, type AiCallRow, type ProviderState } from '@juno/contract'
import { SettingsTidyUp } from './TidyUpSettings'
import { useLayoutEffect, type ReactNode } from 'react'
import { defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
import { AppInfoView } from './AppInfoView'
import { EngineStatusView } from './EngineStatusView'
import { ProcessesView } from './ProcessesView'
import { connections, NOW, settings, settingsRecovery, settingsReleased, settingsTrouble } from './juno-pages/fixtures'
import { ConnectionsPage } from './juno-pages/ConnectionsPage'
import { JunoBackupPage, JunoSettingsPage } from './juno-pages/JunoSettingsPage'
import { ProviderSection } from './juno-pages/ProviderSection'
import { RulesSection } from './juno-pages/RulesSection'
import { NotificationsPage } from './NotificationsPage'
import { notificationsBase } from './NotificationsPage.fixtures'
import { SettingsPage, type SettingsPageProps } from './SettingsPage'
import { NO_LIMIT_USD } from '@juno/agent-contract'
import { AiActivityPage } from './AiActivityPage'
import { SettingsAbout, SettingsAppearance, SettingsGeneral, SettingsIgnored } from './SettingsSections'
import { EmojiPicker } from './EmojiPicker'
import { QuickReactionsSetting } from './QuickReactionsSetting'
import { sevenQuickReactions } from './fixtures/quickReactions'
import { UpdateSettings } from './UpdateSettings'

/** Today's spend from the agent's ledger, under the default $5 limit. */
const spendToday = { spentUsd: 0.42, limitUsd: 5, capUsd: 5, backgroundUsd: 0.31, backgroundLimitUsd: 2.5 }

/** As a new install has them: all on except Capital i. */
const checks = sendCheckPrefKeys.map((key) => ({ key, enabled: sendCheckDefaults[key] }))
const noop = () => {}
const at = (section: SettingsPageProps['section'], children: SettingsPageProps['children'], frame?: FixtureFrame) => fixture<SettingsPageProps>({ section, onSection: noop, children }, frame)

/** General scrolled to its last section before the first paint. */
function ScrolledToEnd({ children }: { readonly children: ReactNode }) {
  useLayoutEffect(() => {
    [...document.querySelectorAll('section')].at(-1)?.scrollIntoView({ block: 'end' })
  }, [])
  return <SettingsPage section="general" onSection={noop}>{children}</SettingsPage>
}

const none: ProviderState = { active: null, openRouter: { key: 'missing' }, custom: { baseUrl: '', key: 'missing' } }
const openRouter: ProviderState = { ...none, active: 'openRouter', openRouter: { key: 'set' } }
const drafts = { openRouterKey: '', baseUrl: '', customKey: '' }
const provider = (state: ProviderState, focusFirst = false) => (
  <ProviderSection state={state} shown="openRouter" drafts={drafts} focusFirst={focusFirst} onShow={noop} onDraft={noop} onSave={noop} onRemove={noop} />
)
const juno = { onChatModel: noop, onCompactionModel: noop, onOpenLimit: noop, onPaused: noop }
const backup = { now: NOW, onBackupFolder: noop, onExportPhrase: noop, onMove: noop, onRestore: noop, onStopJob: noop, onAddProvider: noop }

const ignored = [
  { id: 'C1', name: 'deploys', kind: 'public' as const, hidden: 3 },
  { id: 'C2', name: 'alerts-prod', kind: 'public' as const, hidden: 1000 },
  { id: 'C3', name: 'oncall-pages', kind: 'private' as const, hidden: 1 },
]

/** Five calls: titles and art with costs, a Redraw blocked at the cap, and a chat turn. */
const call = (id: number, minutesAgo: number, rest: Partial<AiCallRow>): AiCallRow => ({
  id: String(id), at: NOW - minutesAgo * 60_000, lastAt: NOW - minutesAgo * 60_000, repeats: 1, source: 'engine', feature: 'titleTopic',
  subject: { kind: 'topic', id: `t:C1:${id}`, name: 'Postgres migration plan' }, provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5',
  outcome: 'ok', kind: '', message: '', durationMs: 2300, inputTokens: 812, outputTokens: 9, costUsd: 0.0017, summary: 'title, 3 words', ...rest,
})
const aiActivity: AiActivity = {
  todayUsd: 0.0123,
  todayCalls: 4,
  calls: [
    call(5, 2, { feature: 'chat', source: 'agent', subject: { kind: 'chat', id: '', name: '' }, inputTokens: 5210, outputTokens: 240, costUsd: 0.0064, summary: 'reply, 820 characters' }),
    call(4, 6, { feature: 'topicArt.redraw', outcome: 'blocked', kind: 'cap', repeats: 3, model: 'google/gemini-3.8-flash', durationMs: 4, inputTokens: null, outputTokens: null, costUsd: null, summary: '' }),
    call(3, 9, { feature: 'topicArt', model: 'google/gemini-3.8-flash', durationMs: 5400, inputTokens: 1900, outputTokens: 880, costUsd: 0.0031, summary: 'drawing, 612 characters' }),
    call(2, 12, { outcome: 'timeout', kind: 'timeout', durationMs: 20000, inputTokens: null, outputTokens: null, costUsd: null, summary: '' }),
    call(1, 15, { subject: { kind: 'topic', id: 't:C1:1', name: 'Kafka retention' } }),
  ],
}

/** A title the main model refused, answered by the fallback, and one refused with no fallback, not sent again. */
const refusedActivity: AiActivity = {
  todayUsd: 0.0009,
  todayCalls: 3,
  calls: [
    call(8, 1, { model: 'google/gemini-3.8-flash', kind: 'fallback', durationMs: 1400, inputTokens: 790, outputTokens: 8, costUsd: 0.0006, summary: 'title, 4 words' }),
    call(7, 1, { outcome: 'error', kind: 'policy.fallback', message: 'This request triggered restrictions under the model’s usage policy.', durationMs: 900, inputTokens: null, outputTokens: null, costUsd: 0.0003, summary: '' }),
    call(6, 4, { subject: { kind: 'topic', id: 't:C1:6', name: 'Kafka retention' }, outcome: 'error', kind: 'policy', message: 'This request triggered restrictions under the model’s usage policy.', durationMs: 850, inputTokens: null, outputTokens: null, costUsd: 0, summary: '' }),
  ],
}

const about = (
  <SettingsAbout
    build={<AppInfoView line="Juno 0.1.0 on darwin, Electron 44.7.0" compact />}
    updates={<UpdateSettings available enabled={false} offer={null} whatsNew={null} onChange={noop} onRestart={noop} onDownload={noop} onWhatsNew={noop} />}
    diagnostics={
      <>
        <EngineStatusView line="Engine catching up, 30 of 143" pong="Pong 2" onPing={noop} />
        <ProcessesView
          rows={[
            { name: 'Main', detail: 'Browser, pid 4120', cpu: '0.2 %', memory: '61 MB' },
            { name: 'Window', detail: 'Tab, pid 4125', cpu: '0.4 %', memory: '238 MB' },
            { name: 'Engine', detail: 'Utility, pid 4127', cpu: '6.1 %', memory: '118 MB' },
            { name: 'Graphics', detail: 'GPU, pid 4122', cpu: '0.5 %', memory: '96 MB' },
            { name: 'Network', detail: 'Utility, pid 4123', cpu: '0.3 %', memory: '22 MB' },
          ]}
          onCopy={noop} onShowLogs={noop}
        />
      </>
    }
    onShowTour={noop}
  />
)

export default defineFixtures(
  SettingsPage,
  {
    Sections: {
      general: at('general', <SettingsGeneral hideWhileSharing sharingDetection="available" onHideWhileSharingChange={noop} checks={checks} onCheckChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 3, pending: 0 }} onCatchUp={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} />),
      // The end of General: message checks and AI assist, as after scrolling down.
      'general-end': scene(() => <ScrolledToEnd><SettingsGeneral hideWhileSharing sharingDetection="available" onHideWhileSharingChange={noop} checks={checks} onCheckChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 3, pending: 0 }} onCatchUp={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} /></ScrolledToEnd>),
      appearance: at('appearance', <SettingsAppearance theme="system" accent="coral" density="compact" onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} quickReactions={<QuickReactionsSetting reactions={DEFAULT_QUICK_REACTIONS} onChange={noop} onAdd={noop} />} />),
      notifications: at('notifications', <NotificationsPage {...notificationsBase} />),
      ignored: at('ignored', <SettingsIgnored ignored={ignored} onStopIgnoring={noop} />),
      juno: at('juno', <JunoSettingsPage {...juno} page={settings} providers={provider(openRouter)} />),
      'ai-activity': at('ai-activity', <AiActivityPage activity={aiActivity} spend={spendToday} onLimit={noop} now={NOW} onCopyDetails={noop} />),
      connections: at('connections', <ConnectionsPage page={connections} rules={<RulesSection rules={settings.rules} onRuleChange={noop} onRuleRemove={noop} onRuleAdd={noop} />} onAction={noop} onConfigure={noop} onAdd={noop} />),
      backup: at('backup', <JunoBackupPage {...backup} page={settings} />),
      about: at('about', about),
    },
    States: {
      'grammar-ai-off': at('general', <SettingsGeneral hideWhileSharing sharingDetection="available" onHideWhileSharingChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 3, pending: 0 }} onCatchUp={noop} checks={checks} grammarUnavailable="Turn on AI assist to check grammar." onCheckChange={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} />),
      'grammar-no-key': at('general', <SettingsGeneral hideWhileSharing sharingDetection="available" onHideWhileSharingChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 3, pending: 0 }} onCatchUp={noop} checks={checks} grammarUnavailable="Add an OpenRouter key to check grammar." onCheckChange={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} />),
      'read-catch-up-running': at('general', <SettingsGeneral hideWhileSharing sharingDetection="available" onHideWhileSharingChange={noop} checks={checks} onCheckChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 0, pending: 12 }} onCatchUp={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} />),
      'read-catch-up-done': at('general', <SettingsGeneral hideWhileSharing sharingDetection="available" onHideWhileSharingChange={noop} checks={checks} onCheckChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 0, pending: 0 }} onCatchUp={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} />),
      'sharing-unavailable': at('general', <SettingsGeneral hideWhileSharing sharingDetection="missing" onHideWhileSharingChange={noop} checks={checks} onCheckChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 0, pending: 0 }} onCatchUp={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} />),
      // Another app records the screen all the time, so Juno cannot tell when a share starts.
      'sharing-always-on': at('general', <SettingsGeneral hideWhileSharing sharingDetection="alwaysOn" onHideWhileSharingChange={noop} checks={checks} onCheckChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 0, pending: 0 }} onCatchUp={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} />),
      'read-mirroring-off': at('general', <SettingsGeneral hideWhileSharing sharingDetection="available" onHideWhileSharingChange={noop} checks={checks} onCheckChange={noop} mirrorReads={false} onMirrorReadsChange={noop} catchUp={{ available: 3, pending: 0 }} onCatchUp={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} />),
      'appearance-quick-reactions': at('appearance', <SettingsAppearance theme="system" accent="coral" density="compact" onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} quickReactions={<QuickReactionsSetting reactions={sevenQuickReactions} onChange={noop} onAdd={noop} />} />),
      // Add's picker over the page, not clipped by the card.
      'appearance-quick-reactions-picker': at('appearance', <SettingsAppearance theme="system" accent="coral" density="compact" onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} quickReactions={<QuickReactionsSetting reactions={DEFAULT_QUICK_REACTIONS} onChange={noop} onAdd={noop} picker={<EmojiPicker catalog={emojiCatalog} recent={DEFAULT_QUICK_REACTIONS.map((reaction) => reaction.name)} selected={new Set(DEFAULT_QUICK_REACTIONS.map((reaction) => reaction.name))} onPick={noop} onClose={noop} />} />} />),
      // The minimum window with the sidebar hidden: the hours rows put their days and times under the label.
      'notifications-minimum-window': at('notifications', <NotificationsPage {...notificationsBase} />, { width: 720, height: 436, padded: false }),
      // The minimum window with the sidebar shown: Settings is 336 wide, so the list is a rail of icons.
      'general-minimum-window': at('general', <SettingsGeneral hideWhileSharing sharingDetection="available" onHideWhileSharingChange={noop} checks={checks} onCheckChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 3, pending: 0 }} onCatchUp={noop} peekKey="option" onPeekKeyChange={noop} webPanel onWebPanelChange={noop} classifier onClassifierChange={noop} />, { width: 336, height: 436, padded: false }),
      'appearance-minimum-window': at('appearance', <SettingsAppearance theme="system" accent="coral" density="compact" onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} quickReactions={<QuickReactionsSetting reactions={DEFAULT_QUICK_REACTIONS} onChange={noop} onAdd={noop} />} />, { width: 336, height: 436, padded: false }),
      // Comfortable picked: the page and the controls drawn in Comfortable.
      'appearance-comfortable': at('appearance', <SettingsAppearance theme="system" accent="coral" density="comfortable" onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} quickReactions={<QuickReactionsSetting reactions={DEFAULT_QUICK_REACTIONS} onChange={noop} onAdd={noop} />} />, { density: 'comfortable' }),
      // Tidy up (SPEC 14): what Resolve does, then when Juno suggests a topic.
      'tidy-up': at('tidy-up', <SettingsTidyUp quietDays={7} onQuietDaysChange={noop} tabExpiry="1d" onTabExpiryChange={noop} prefs={TIDY_UP_DEFAULTS} onChange={noop} aiAssist />),
      'tidy-up-ai-off': at('tidy-up', <SettingsTidyUp quietDays={7} onQuietDaysChange={noop} tabExpiry="1d" onTabExpiryChange={noop} prefs={{ quiet: '1d', threads: true, dms: false, followUps: true, drafts: false, unfollow: true, ignore: false }} onChange={noop} aiAssist={false} />),
      'tidy-up-minimum-window': at('tidy-up', <SettingsTidyUp quietDays={7} onQuietDaysChange={noop} tabExpiry="1d" onTabExpiryChange={noop} prefs={TIDY_UP_DEFAULTS} onChange={noop} aiAssist />, { width: 336, height: 436, padded: false }),
      'ignored-empty': at('ignored', <SettingsIgnored ignored={[]} onStopIgnoring={noop} />),
      'ai-activity-background-limit': at('ai-activity', <AiActivityPage activity={aiActivity} spend={{ ...spendToday, spentUsd: 2.51, backgroundUsd: 2.5 }} onLimit={noop} now={NOW} onCopyDetails={noop} />),
      'ai-activity-no-limit': at('ai-activity', <AiActivityPage activity={aiActivity} spend={{ ...spendToday, capUsd: NO_LIMIT_USD, limitUsd: NO_LIMIT_USD, backgroundLimitUsd: NO_LIMIT_USD / 2 }} onLimit={noop} now={NOW} onCopyDetails={noop} />),
      'ai-activity-refused': at('ai-activity', <AiActivityPage activity={refusedActivity} spend={spendToday} onLimit={noop} now={NOW} onCopyDetails={noop} />),
      'ai-activity-empty': at('ai-activity', <AiActivityPage activity={{ calls: [], todayUsd: 0, todayCalls: 0 }} now={NOW} onCopyDetails={noop} />),
      // From "Add a provider" or "Juno needs a model": no agent runs, and the key field has focus.
      'juno-add-provider': at('juno', <JunoSettingsPage {...juno} providers={provider(none, true)} />),
      'juno-trouble': at('juno', <JunoSettingsPage {...juno} page={settingsTrouble} providers={provider(openRouter)} />),
      'backup-no-provider': at('backup', <JunoBackupPage {...backup} />),
      'backup-recovery': at('backup', <JunoBackupPage {...backup} page={settingsRecovery} />),
      'backup-released': at('backup', <JunoBackupPage {...backup} page={settingsReleased} />),
      'backup-removal-pending': at('backup', <JunoBackupPage {...backup} page={settingsTrouble} />),
    },
  },
  { width: 1100, height: 880, padded: false },
)
