import { defineFixtures, fixture } from '@juno/ui'
import { GalleryAppearanceSettings } from './fixtures/appearance'
import { SignInView } from './SignInView'

const noop = () => {}
// The appearance controls the SignedOut container puts at the foot of the page.
// It shows the gallery's theme and accent as selected, as the container shows the owner's.
const footer = <GalleryAppearanceSettings layout="bar" onThemeChange={noop} onAccentChange={noop} />

// Every line in Failure is a line the Session container produces for a
// SignInFailed kind (apps/desktop/src/renderer/containers/Session.tsx).
export default defineFixtures(
  SignInView,
  {
    Session: {
      'first-run': fixture({ mode: 'first-run', onImport: noop, footer }),
      expired: fixture({ mode: 'expired', onImport: noop, footer }),
    },
    Progress: {
      importing: fixture({ mode: 'first-run', busy: 'import', onImport: noop, footer }),
    },
    Failure: {
      'no-token': fixture({
        mode: 'first-run',
        error: 'Juno could not read the Slack app’s session. Open Slack, sign in there, then try again.',
        onImport: noop,
        footer,
      }),
      'slack-app-missing': fixture({
        mode: 'first-run',
        error: 'Slack isn’t installed on this Mac. Install Slack, sign in to it, then try again.',
        onImport: noop,
        footer,
      }),
      'slack-app-signed-out': fixture({
        mode: 'first-run',
        error: 'Slack is installed but not signed in. Open Slack, sign in there, then try again.',
        onCopyDetails: noop,
        onImport: noop,
        footer,
      }),
      keychain: fixture({
        mode: 'first-run',
        error: 'Juno could not read the Slack keychain item. Try again and allow access when macOS asks.',
        onImport: noop,
        footer,
      }),
      rejected: fixture({
        mode: 'expired',
        error: 'Slack did not accept the session. Open Slack, sign in there, then try again.',
        onImport: noop,
        footer,
      }),
      offline: fixture({
        mode: 'first-run',
        error: 'Slack could not be reached. Check the connection and try again.',
        onImport: noop,
        footer,
      }),
    },
    // The art shrinks under a 1100px window and hides under 960px; the column stays centred.
    Size: {
      shrunk: fixture({ mode: 'first-run', onImport: noop, footer }, { width: 1024, height: 720 }),
      narrow: fixture({ mode: 'first-run', onImport: noop, footer }, { width: 800, height: 700 }),
      'minimum-window': fixture({ mode: 'first-run', onImport: noop, footer }, { width: 720, height: 436 }),
      'narrow-error': fixture(
        { mode: 'first-run', error: 'Slack is installed but not signed in. Open Slack, sign in there, then try again.', onCopyDetails: noop, onImport: noop, footer },
        { width: 800, height: 700 },
      ),
    },
    Interaction: {
      'primary-hover': fixture({ mode: 'first-run', onImport: noop, footer }, { hover: 'button' }),
      'primary-press': fixture({ mode: 'first-run', onImport: noop, footer }, { press: 'button' }),
      'primary-focus': fixture({ mode: 'first-run', onImport: noop, footer }, { focus: 'button' }),
    },
  },
  // The window under the drag strip, at the size of the approved mockup.
  { width: 1200, height: 736, surface: 'background', padded: false },
)
