import type { ProviderState } from '@juno/contract'
import { defineFixtures, fixture } from '@juno/ui'
import { AppInfoView } from './AppInfoView'
import { EngineStatusView } from './EngineStatusView'
import { connections, NOW, settings, settingsRecovery, settingsReleased, settingsTrouble } from './juno-pages/fixtures'
import { ConnectionsPage } from './juno-pages/ConnectionsPage'
import { JunoBackupPage, JunoSettingsPage } from './juno-pages/JunoSettingsPage'
import { ProviderSection } from './juno-pages/ProviderSection'
import { NotificationsPage } from './NotificationsPage'
import { notificationsBase } from './NotificationsPage.fixtures'
import { SettingsPage, type SettingsPageProps } from './SettingsPage'
import { SettingsAbout, SettingsAppearance, SettingsGeneral, SettingsIgnored } from './SettingsSections'
import { UpdateSettings } from './UpdateSettings'

const noop = () => {}
const at = (section: SettingsPageProps['section'], children: SettingsPageProps['children']) => fixture<SettingsPageProps>({ section, onSection: noop, children })

const none: ProviderState = { active: null, openRouter: { key: 'missing' }, custom: { baseUrl: '', key: 'missing' } }
const openRouter: ProviderState = { ...none, active: 'openRouter', openRouter: { key: 'set' } }
const drafts = { openRouterKey: '', baseUrl: '', customKey: '' }
const provider = (state: ProviderState, focusFirst = false) => (
  <ProviderSection state={state} shown="openRouter" drafts={drafts} focusFirst={focusFirst} onShow={noop} onDraft={noop} onSave={noop} onRemove={noop} />
)
const juno = { onChatModel: noop, onCompactionModel: noop, onCap: noop, onPaused: noop }
const backup = { now: NOW, onBackupFolder: noop, onExportPhrase: noop, onMove: noop, onRestore: noop, onStopJob: noop, onAddProvider: noop }

const ignored = [
  { id: 'C1', name: 'deploys', kind: 'public' as const, hidden: 3 },
  { id: 'C2', name: 'alerts-prod', kind: 'public' as const, hidden: 1000 },
  { id: 'C3', name: 'oncall-pages', kind: 'private' as const, hidden: 1 },
]

const about = (
  <SettingsAbout
    build={<AppInfoView line="Juno 0.1.0 on darwin, Electron 44.7.0" compact />}
    updates={<UpdateSettings available enabled={false} version={null} onChange={noop} onRestart={noop} />}
    diagnostics={<EngineStatusView line="Engine catching up, 30 of 143" pong="Pong 2" onPing={noop} />}
  />
)

export default defineFixtures(
  SettingsPage,
  {
    Sections: {
      general: at('general', <SettingsGeneral quietDays={7} onQuietDaysChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 3, pending: 0 }} onCatchUp={noop} newTabPage="newChat" onNewTabPageChange={noop} peekKey="option" onPeekKeyChange={noop} classifier onClassifierChange={noop} />),
      appearance: at('appearance', <SettingsAppearance theme="system" accent="coral" density="comfortable" onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} />),
      notifications: at('notifications', <NotificationsPage {...notificationsBase} />),
      ignored: at('ignored', <SettingsIgnored ignored={ignored} onStopIgnoring={noop} />),
      juno: at('juno', <JunoSettingsPage {...juno} page={settings} providers={provider(openRouter)} onRuleChange={noop} onRuleRemove={noop} onRuleAdd={noop} />),
      connections: at('connections', <ConnectionsPage page={connections} onAction={noop} onConfigure={noop} onAdd={noop} />),
      backup: at('backup', <JunoBackupPage {...backup} page={settings} />),
      about: at('about', about),
    },
    States: {
      'read-catch-up-running': at('general', <SettingsGeneral quietDays={7} onQuietDaysChange={noop} mirrorReads onMirrorReadsChange={noop} catchUp={{ available: 0, pending: 12 }} onCatchUp={noop} newTabPage="newChat" onNewTabPageChange={noop} peekKey="option" onPeekKeyChange={noop} classifier onClassifierChange={noop} />),
      'read-mirroring-off': at('general', <SettingsGeneral quietDays={7} onQuietDaysChange={noop} mirrorReads={false} onMirrorReadsChange={noop} catchUp={{ available: 3, pending: 0 }} onCatchUp={noop} newTabPage="newChat" onNewTabPageChange={noop} peekKey="option" onPeekKeyChange={noop} classifier onClassifierChange={noop} />),
      'ignored-empty': at('ignored', <SettingsIgnored ignored={[]} onStopIgnoring={noop} />),
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
