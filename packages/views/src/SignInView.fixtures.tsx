import { defineFixtures, fixture } from '@juno/ui'
import { SignInView } from './SignInView'

const noop = () => {}

// Every line in Failure is a line the Session container produces for a
// SignInFailed kind (apps/desktop/src/renderer/containers/Session.tsx).
export default defineFixtures(
  SignInView,
  {
    Session: {
      'first-run': fixture({ mode: 'first-run', onSignIn: noop, onImport: noop }),
      expired: fixture({ mode: 'expired', onSignIn: noop, onImport: noop }),
    },
    Progress: {
      'waiting-for-window': fixture({ mode: 'first-run', busy: 'window', onSignIn: noop, onImport: noop }),
      importing: fixture({ mode: 'first-run', busy: 'import', onSignIn: noop, onImport: noop }),
    },
    Failure: {
      cancelled: fixture({
        mode: 'first-run',
        error: 'The sign-in window was closed before it finished.',
        onSignIn: noop,
        onImport: noop,
      }),
      'no-token': fixture({
        mode: 'first-run',
        error: 'Slack signed in, but Juno could not read the session. Try again.',
        onSignIn: noop,
        onImport: noop,
      }),
      'slack-app-missing': fixture({
        mode: 'first-run',
        error: 'No signed-in Slack app was found on this Mac.',
        onSignIn: noop,
        onImport: noop,
      }),
      keychain: fixture({
        mode: 'first-run',
        error: 'Juno could not read the Slack keychain item. Allow access when macOS asks, or sign in instead.',
        onSignIn: noop,
        onImport: noop,
      }),
      rejected: fixture({
        mode: 'expired',
        error: 'Slack did not accept the session. Sign in again.',
        onSignIn: noop,
        onImport: noop,
      }),
      offline: fixture({
        mode: 'first-run',
        error: 'Slack could not be reached. Check the connection and try again.',
        onSignIn: noop,
        onImport: noop,
      }),
    },
    Interaction: {
      'primary-hover': fixture({ mode: 'first-run', onSignIn: noop, onImport: noop }, { hover: 'button' }),
      'primary-press': fixture({ mode: 'first-run', onSignIn: noop, onImport: noop }, { press: 'button' }),
      'primary-focus': fixture({ mode: 'first-run', onSignIn: noop, onImport: noop }, { focus: 'button' }),
    },
  },
  { width: 760, height: 520, surface: 'background' },
)
