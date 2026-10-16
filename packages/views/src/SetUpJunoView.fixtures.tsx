import { defineFixtures, fixture } from '@juno/ui'
import { settings } from './juno-pages/fixtures'
import { SetUpJunoView, type SetUpJunoViewProps } from './SetUpJunoView'

const noop = () => {}

const base: SetUpJunoViewProps = {
  shown: 'openRouter',
  codex: 'signedOut',
  drafts: { openRouterKey: '', baseUrl: '', customKey: '' },
  saved: false,
  onShow: noop,
  onDraft: noop,
  onModel: noop,
  onSignInCodex: noop,
  onContinue: noop,
  onSkip: noop,
}

const state = (overrides: Partial<SetUpJunoViewProps> = {}) => fixture<SetUpJunoViewProps>({ ...base, ...overrides })
const typed = { openRouterKey: 'sk-or-v1-0123456789abcdef', baseUrl: '', customKey: '' }

// The step after Slack sign-in (SPEC 13.10, "Set up Juno"). The lines in
// Failure are the ones the SetUpJuno container produces.
export default defineFixtures(
  SetUpJunoView,
  {
    OpenRouter: {
      empty: state(),
      typed: state({ drafts: typed }),
      saving: state({ drafts: typed, busy: 'save' }),
      'getting-models': state({ saved: true }),
      'model-chosen': state({ saved: true, models: settings.chatModels, model: 'Claude Sonnet' }),
    },
    Custom: {
      empty: state({ shown: 'custom' }),
      'model-typed': state({ shown: 'custom', drafts: { openRouterKey: '', baseUrl: 'http://localhost:11434/v1', customKey: '' }, saved: true, modelTyped: true, model: 'llama3.3' }),
    },
    Failure: {
      'not-a-key': state({ drafts: { ...typed, openRouterKey: 'two words' }, error: 'That is not a key. Keys have no spaces.' }),
      'bad-url': state({ shown: 'custom', drafts: { openRouterKey: '', baseUrl: 'localhost', customKey: '' }, error: 'Enter an http or https address.' }),
    },
  },
  { width: 760, height: 640, surface: 'background' },
)
