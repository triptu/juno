import { defineFixtures, fixture } from '@juno/ui'
import { SignInView } from './SignInView'

const noop = () => {}

export default defineFixtures(
  SignInView,
  {
    'first-run': fixture({ mode: 'first-run', onSignIn: noop, onImport: noop }),
    expired: fixture({ mode: 'expired', onSignIn: noop, onImport: noop }),
    'waiting-for-window': fixture({ mode: 'first-run', busy: 'window', onSignIn: noop, onImport: noop }),
    importing: fixture({ mode: 'first-run', busy: 'import', onSignIn: noop, onImport: noop }),
    'error-window-closed': fixture({
      mode: 'first-run',
      error: 'The sign-in window was closed before it finished.',
      onSignIn: noop,
      onImport: noop,
    }),
    'error-keychain': fixture({
      mode: 'first-run',
      error: 'Juno could not read the Slack keychain item. Allow access when macOS asks, or sign in instead.',
      onSignIn: noop,
      onImport: noop,
    }),
    'error-rejected': fixture({
      mode: 'expired',
      error: 'Slack rejected the session (invalid_auth).',
      onSignIn: noop,
      onImport: noop,
    }),
    'primary-hover': fixture({ mode: 'first-run', onSignIn: noop, onImport: noop }, { hover: 'button' }),
    'primary-press': fixture({ mode: 'first-run', onSignIn: noop, onImport: noop }, { press: 'button' }),
    'primary-focus': fixture({ mode: 'first-run', onSignIn: noop, onImport: noop }, { focus: 'button' }),
  },
  { width: 760, height: 520, surface: 'background' },
)
