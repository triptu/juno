import type { ModelChoice } from '@juno/agent-contract'
import { defineFixtures, fixture } from '@juno/ui'
import { settings, settingsTrouble } from './fixtures'
import { JunoSettingsPage, type JunoSettingsPageProps } from './JunoSettingsPage'
import { ProviderSection, type ProviderSectionProps } from './ProviderSection'

const noop = () => {}
const emptyDrafts = { openRouterKey: '', baseUrl: '', customKey: '' }
const none: ProviderSectionProps['state'] = { active: null, openRouter: { key: 'missing' }, custom: { baseUrl: '', key: 'missing' } }
const LOCAL = 'http://localhost:11434/v1'

const provider = (props: Partial<ProviderSectionProps> = {}) => (
  <ProviderSection state={{ ...none, active: 'openRouter', openRouter: { key: 'set' } }} shown="openRouter" drafts={emptyDrafts} onShow={noop} onDraft={noop} onSave={noop} onRemove={noop} {...props} />
)
const onCustom = (key: 'set' | 'missing' = 'missing') =>
  provider({ state: { ...none, active: 'custom', custom: { baseUrl: LOCAL, key } }, shown: 'custom', drafts: { ...emptyDrafts, baseUrl: LOCAL } })

const callbacks = { onChatModel: noop, onCompactionModel: noop, onOpenLimit: noop, onPaused: noop }

const page = (props: Pick<JunoSettingsPageProps, 'page'>) =>
  fixture<JunoSettingsPageProps>({
    ...props,
    ...callbacks,
    providers: provider(),
    onSignInCodex: noop,
  })

/** The provider, the models, spend and Pause, with Codex's sign-in not wired. */
const today = (props: Partial<Pick<JunoSettingsPageProps, 'page' | 'providers'>> = {}) =>
  fixture<JunoSettingsPageProps>({
    page: settings,
    providers: provider(),
    ...props,
    ...callbacks,
  })

const local = (id: string, selected = false): ModelChoice => ({ family: id, resolved: id, provider: 'custom', selected })

export default defineFixtures(
  JunoSettingsPage,
  {
    Settings: {
      ready: page({ page: settings }),
      // The key was rejected, Codex is signed out and Juno is paused.
      trouble: page({ page: settingsTrouble }),
      // From "Add a provider": the key field has focus.
      'add-provider': fixture<JunoSettingsPageProps>({ ...callbacks, providers: provider({ state: none, focusFirst: true }) }),
    },
    Today: {
      'open-router': today(),
      // No provider: no agent runs, so the page is the provider alone.
      'no-provider': fixture<JunoSettingsPageProps>({ ...callbacks, providers: provider({ state: none }) }),
      'key-rejected': today({ page: { ...settings, openRouterKey: 'rejected' }, providers: provider({ rejected: true }) }),
      // An OpenAI-compatible endpoint that lists its models: one chat model, used for compaction too.
      'custom-listed': today({
        page: { ...settings, provider: 'custom', chatModels: [local('llama3.2', true), local('qwen2.5-coder')], compactionModels: [], spendUntracked: true },
        providers: onCustom(),
      }),
      // One that lists none: the model id is typed.
      'custom-typed': today({ page: { ...settings, provider: 'custom', chatModels: [local('mistral-small', true)], compactionModels: [], modelTyped: true, spendUntracked: true }, providers: onCustom('set') }),
    },
  },
  { width: 960, height: 880, padded: false },
)
