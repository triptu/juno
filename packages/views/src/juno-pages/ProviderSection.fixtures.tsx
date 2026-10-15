import { defineFixtures, fixture } from '@juno/ui'
import { ProviderSection, type ProviderSectionProps } from './ProviderSection'

const noop = () => {}
const empty = { openRouterKey: '', baseUrl: '', customKey: '' }
const none: ProviderSectionProps['state'] = { active: null, openRouter: { key: 'missing' }, custom: { baseUrl: '', key: 'missing' } }
const base: ProviderSectionProps = { state: none, shown: 'openRouter', drafts: empty, onShow: noop, onDraft: noop, onSave: noop, onRemove: noop }

export default defineFixtures(
  ProviderSection,
  {
    OpenRouter: {
      'no-provider': fixture<ProviderSectionProps>(base),
      'key-typed': fixture<ProviderSectionProps>({ ...base, drafts: { ...empty, openRouterKey: 'sk-or-v1-0123456789' } }),
      'in-use': fixture<ProviderSectionProps>({ ...base, state: { ...none, active: 'openRouter', openRouter: { key: 'set' } } }),
      rejected: fixture<ProviderSectionProps>({ ...base, state: { ...none, active: 'openRouter', openRouter: { key: 'set' } }, rejected: true }),
      'not-a-key': fixture<ProviderSectionProps>({ ...base, drafts: { ...empty, openRouterKey: 'two words' }, error: 'That is not a key. Keys have no spaces.' }),
    },
    Custom: {
      'set-up': fixture<ProviderSectionProps>({ ...base, shown: 'custom', drafts: { ...empty, baseUrl: 'http://localhost:11434/v1' } }),
      'in-use': fixture<ProviderSectionProps>({
        ...base,
        shown: 'custom',
        state: { ...none, active: 'custom', custom: { baseUrl: 'http://localhost:11434/v1', key: 'set' } },
        drafts: { ...empty, baseUrl: 'http://localhost:11434/v1' },
      }),
      'bad-address': fixture<ProviderSectionProps>({ ...base, shown: 'custom', drafts: { ...empty, baseUrl: 'localhost' }, error: 'Enter an http or https address.' }),
    },
  },
  { width: 720, padded: true },
)
