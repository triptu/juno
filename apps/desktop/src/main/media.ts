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
 * microphone (`audio`) and the camera (`video`); `display-capture` is
 * `getDisplayMedia`'s, which Juno does not call but would get the same
 * answer. The camera is never asked for (video is out of scope) and has no
 * entitlement, so macOS refuses it even where this lets a `video` request
 * through. Whether macOS lets Juno record the screen is its own setting
 * (Screen Recording), which the share sheet reads. No business logic.
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
    if (permission === 'display-capture') return callback(ownPage(contents, details.requestingUrl))
    if (permission !== 'media') return callback(true)
    if (!ownPage(contents, details.requestingUrl)) return callback(false)
    const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    // The microphone alone: ask macOS. No microphone in it: a screen capture.
    if (types.includes('audio')) return types.every((type) => type === 'audio') ? void microphoneAllowed().then(callback, () => callback(false)) : callback(false)
    callback(true)
  })
  target.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (permission === 'display-capture') return ownPage(contents, origin)
    return permission !== 'media' || ((details.mediaType === undefined || details.mediaType === 'audio') && ownPage(contents, origin))
  })
}
