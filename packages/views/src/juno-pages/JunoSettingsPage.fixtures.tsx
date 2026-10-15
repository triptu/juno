import { chatCopy } from '@juno/agent-contract'
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

/** What the app wires today: the models, spend, OpenRouter and Pause. Codex, Rules, Backup and This Mac wait for their work packages. */
const today = (props: Pick<JunoSettingsPageProps, 'page' | 'keyEntry'>) =>
  fixture<JunoSettingsPageProps>({ ...props, now: NOW, onChatModel: noop, onCompactionModel: noop, onCap: noop, onOpenRouterKey: noop, onPaused: noop })

const entry = (draft: string, error?: string) => ({ draft, ...(error === undefined ? {} : { error }), onDraft: noop, onSave: noop, onCancel: noop })

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
    Today: {
      'built-today': today({ page: settings }),
      'no-key': today({ page: { ...settings, openRouterKey: 'missing' } }),
      'key-entry': today({ page: { ...settings, openRouterKey: 'missing' }, keyEntry: entry('sk-or-v1-0123') }),
      'key-invalid': today({ page: { ...settings, openRouterKey: 'missing' }, keyEntry: entry('not a key', chatCopy.pages.settings.keyInvalid) }),
      'key-rejected': today({ page: { ...settings, openRouterKey: 'rejected' } }),
    },
  },
  { width: 960, height: 880, padded: false },
)
