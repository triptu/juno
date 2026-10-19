/**
 * Huddle media permissions (SPEC 20, docs/plans/huddles.md phases 3 and 4):
 * the microphone and screen capture, for Juno's own page only. Other
 * permissions keep Electron's default (granted), as before these handlers
 * existed. The first microphone request shows the macOS prompt; when access
 * is off the page's media session joins muted, so the user can listen.
 *
 * Screen capture is `getUserMedia` with `chromeMediaSource: 'desktop'` and
 * the id the share sheet picked (`screenShare.ts`). Electron asks for it as
 * `media` with no device type in `mediaTypes`, since it names only the
 * microphone (`audio`) and the camera (`video`) (Electron 44's
 * `web_contents_permission_helper.cc`); `display-capture` is
 * `getDisplayMedia`'s, which Juno does not call but would get the same
 * answer. The camera is refused (video is out of scope). Whether macOS lets
 * Juno record the screen is its own setting (Screen Recording), which the
 * share sheet reads. No business logic.
 */
import { session, shell, systemPreferences, type Session, type WebContents } from 'electron'
import { APP_SCHEME } from './scheme'

// Not by `URL.origin`: Node gives a custom scheme's URL the origin "null", which would refuse Juno itself.
const fromApp = (url: string | undefined) => {
  if (url === undefined) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === 'app'
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
    if (permission === 'display-capture') return callback(ownPage(contents, details.requestingUrl))
    if (permission !== 'media') return callback(true)
    if (!ownPage(contents, details.requestingUrl)) return callback(false)
    const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    // No device: a screen capture. The microphone alone: ask macOS. Anything with the camera: no.
    if (types.length === 0) return callback(true)
    if (!types.every((type) => type === 'audio')) return callback(false)
    void microphoneAllowed().then(callback, () => callback(false))
  })
  target.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (permission === 'display-capture') return ownPage(contents, origin)
    return permission !== 'media' || ((details.mediaType === undefined || details.mediaType === 'audio') && ownPage(contents, origin))
  })
}
