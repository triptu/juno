/**
 * Huddle media permissions (SPEC 20, docs/plans/huddles.md phase 3): the
 * microphone, for Juno's own page only; camera and screen capture are
 * refused. Other permissions keep Electron's default (granted), as before
 * these handlers existed. The first request shows the macOS prompt; when
 * access is off the page's media session joins muted, so the user can
 * listen. Screen share (display capture) comes with phase 4. No business
 * logic.
 */
import { session, shell, systemPreferences, type Session, type WebContents } from 'electron'
import { APP_ORIGIN } from './scheme'

const fromApp = (url: string | undefined) => {
  if (url === undefined) return false
  try {
    return new URL(url).origin === APP_ORIGIN
  } catch {
    return false
  }
}

/** The main frame of a page Juno serves itself. */
const ownPage = (contents: WebContents | null, origin?: string) => contents !== null && fromApp(contents.getURL()) && (origin === undefined || fromApp(origin))

/** Asks macOS once, so the prompt names Juno; afterwards the answer stands until the user changes it in System Settings. */
async function microphoneAllowed(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return true
  if (status === 'denied' || status === 'restricted') return false
  return systemPreferences.askForMediaAccess('microphone')
}

/** System Settings at Privacy & Security, Microphone, where the user lets Juno use it again (SPEC 20, "Microphone blocked"). */
export const MICROPHONE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'

export async function openMicrophoneSettings(): Promise<void> {
  await shell.openExternal(MICROPHONE_SETTINGS_URL)
}

/** Call once, when the app is ready, on the session the main window uses. */
export function registerMediaPermissions(target: Session = session.defaultSession): void {
  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== 'media') return callback(true)
    const audioOnly = 'mediaTypes' in details && (details.mediaTypes ?? []).every((type) => type === 'audio')
    if (!audioOnly || !ownPage(contents, details.requestingUrl)) return callback(false)
    void microphoneAllowed().then(callback, () => callback(false))
  })
  target.setPermissionCheckHandler((contents, permission, origin, details) =>
    permission !== 'media' || ((details.mediaType === undefined || details.mediaType === 'audio') && ownPage(contents, origin)),
  )
}
