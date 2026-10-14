import { defineFixtures, fixture } from '@juno/ui'
import { NOW, settings, settingsRecovery, settingsReleased, settingsTrouble } from './fixtures'
import { JunoSettingsPage, type JunoSettingsPageProps } from './JunoSettingsPage'

const noop = () => {}
const page = (props: Pick<JunoSettingsPageProps, 'page'>) =>
  fixture<JunoSettingsPageProps>({
    ...props,
    now: NOW,
    onChatModel: noop,
    onCompactionModel: noop,
    onCap: noop,
    onOpenRouterKey: noop,
    onSignInCodex: noop,
    onRuleChange: noop,
    onRuleRemove: noop,
    onRuleAdd: noop,
    onPaused: noop,
    onBackupFolder: noop,
    onExportPhrase: noop,
    onMove: noop,
    onRestore: noop,
    onStopJob: noop,
  })

export default defineFixtures(
  JunoSettingsPage,
  {
    Settings: {
      ready: page({ page: settings }),
      // The key was rejected, Codex is signed out, Juno is paused, no backup yet, and a removal waits on a job.
      trouble: page({ page: settingsTrouble }),
      recovery: page({ page: settingsRecovery }),
      released: page({ page: settingsReleased }),
    },
  },
  { width: 960, height: 880, padded: false },
)
