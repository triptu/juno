import { defineFixtures, fixture } from '@juno/ui'
import { SignInView } from './SignInView'

const noop = () => {}

// Every line in Failure is a line the Session container produces for a
// SignInFailed kind (apps/desktop/src/renderer/containers/Session.tsx).
export default defineFixtures(
  SignInView,
  {
    Session: {
      'first-run': fixture({ mode: 'first-run', onImport: noop }),
      expired: fixture({ mode: 'expired', onImport: noop }),
    },
    Progress: {
      importing: fixture({ mode: 'first-run', busy: 'import', onImport: noop }),
    },
    Failure: {
      'no-token': fixture({
        mode: 'first-run',
        error: 'Juno could not read the Slack app’s session. Open Slack, sign in there, then try again.',
        onImport: noop,
      }),
      'slack-app-missing': fixture({
        mode: 'first-run',
        error: 'Slack isn’t installed on this Mac. Install Slack, sign in to it, then try again.',
        onImport: noop,
      }),
      'slack-app-signed-out': fixture({
        mode: 'first-run',
        error: 'Slack is installed but not signed in. Open Slack, sign in there, then try again.',
        onCopyDetails: noop,
        onImport: noop,
      }),
      keychain: fixture({
        mode: 'first-run',
        error: 'Juno could not read the Slack keychain item. Try again and allow access when macOS asks.',
        onImport: noop,
      }),
      rejected: fixture({
        mode: 'expired',
        error: 'Slack did not accept the session. Open Slack, sign in there, then try again.',
        onImport: noop,
      }),
      offline: fixture({
        mode: 'first-run',
        error: 'Slack could not be reached. Check the connection and try again.',
        onImport: noop,
      }),
    },
    Interaction: {
      'primary-hover': fixture({ mode: 'first-run', onImport: noop }, { hover: 'button' }),
      'primary-press': fixture({ mode: 'first-run', onImport: noop }, { press: 'button' }),
      'primary-focus': fixture({ mode: 'first-run', onImport: noop }, { focus: 'button' }),
    },
  },
  { width: 760, height: 520, surface: 'background' },
)
