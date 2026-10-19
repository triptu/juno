/**
 * The share sheet's sources (SPEC 20, Screen share; research
 * `slack-huddles.md` section 3): the screens and windows `desktopCapturer`
 * lists, with thumbnails, Juno's own windows left out, as Slack's shell does.
 * The page captures the one the user picks with `getUserMedia` and
 * `chromeMediaSource: 'desktop'`; `media.ts` lets only Juno's own page do so.
 *
 * macOS answers only whether Juno may record the screen, not whether it has
 * asked, so main remembers that it asked once in a small file in userData
 * (`screen-recording-asked`). Until then the sheet explains and offers
 * Continue, which shows the macOS prompt by listing the screens.
 *
 * When a shared window's capture ends, the page asks whether the window is
 * still there (`windowOpen`): the window closed, or the user stopped the
 * capture from macOS, which SPEC 20 tells apart.
 *
 * Under JUNO_E2E nothing is captured: a test sets the permission and the
 * sources are drawn here.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, nativeImage, screen, shell, systemPreferences, type DesktopCapturerSource } from 'electron'
import type { ScreenPermission, ShareSource, ShareSources } from '@juno/contract'

/** Slack caps its thumbnails at 480 by 480; the sheet's tiles are 16:10, so this is the most a tile shows. */
const THUMBNAIL = { width: 480, height: 300 }
const JPEG_QUALITY = 75

/** System Settings at Privacy & Security, Screen & System Audio Recording. */
export const SCREEN_RECORDING_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export interface ScreenShareSources {
  readonly list: () => Promise<ShareSources>
  /** Continue: asks macOS once, then lists. */
  readonly allow: () => Promise<ShareSources>
  /** Whether the window with this source id is still there to share. */
  readonly windowOpen: (id: string) => Promise<boolean>
  readonly openSettings: () => Promise<void>
  /** Under JUNO_E2E only. */
  readonly testHooks: {
    readonly screenRecording: (permission: ScreenPermission) => void
    readonly screenRecordingSettingsOpened: () => number
    /** The fake window with this source id closes. */
    readonly closeShareWindow: (id: string) => void
  }
}

/** "window:4242:0" and "window:4242:1" are the same window. */
const windowKey = (id: string) => id.split(':').slice(0, 2).join(':')

const jpeg = (image: Electron.NativeImage) => (image.isEmpty() ? undefined : `data:image/jpeg;base64,${image.toJPEG(JPEG_QUALITY).toString('base64')}`)

function toSource(source: DesktopCapturerSource, displays: ReadonlyMap<string, string>): ShareSource {
  const kind = source.id.startsWith('screen:') ? 'screen' : 'window'
  const name = (kind === 'screen' ? displays.get(source.display_id) : undefined) || source.name
  const thumbnail = jpeg(source.thumbnail)
  const icon = source.appIcon?.isEmpty() === false ? source.appIcon.resize({ width: 32 }).toDataURL() : undefined
  return { id: source.id, name, kind, ...(thumbnail === undefined ? {} : { thumbnail }), ...(icon === undefined ? {} : { appIcon: icon }) }
}

async function capturerSources(): Promise<ReadonlyArray<ShareSource>> {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: THUMBNAIL, fetchWindowIcons: true })
  const own = new Set(BrowserWindow.getAllWindows().map((window) => windowKey(window.getMediaSourceId())))
  const displays = new Map(screen.getAllDisplays().map((display) => [String(display.id), display.label]))
  return sources.filter((source) => !own.has(windowKey(source.id))).map((source) => toSource(source, displays))
}

/** Two screens and two windows for tests, each a flat colour. */
function fakeSources(): ReadonlyArray<ShareSource> {
  const swatch = (rgb: readonly [number, number, number]) => {
    const { width, height } = { width: 48, height: 30 }
    const pixels = Buffer.alloc(width * height * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels.set([rgb[2], rgb[1], rgb[0], 255], i)
    return jpeg(nativeImage.createFromBitmap(pixels, { width, height }))
  }
  const source = (id: string, name: string, kind: 'screen' | 'window', rgb: readonly [number, number, number]): ShareSource => {
    const thumbnail = swatch(rgb)
    return { id, name, kind, ...(thumbnail === undefined ? {} : { thumbnail }) }
  }
  return [
    source('screen:1:0', 'Built-in display', 'screen', [40, 90, 160]),
    source('screen:2:0', 'Studio Display', 'screen', [60, 140, 90]),
    source('window:101:0', 'Q4 roadmap — Docs', 'window', [200, 160, 60]),
    source('window:102:0', 'Terminal', 'window', [50, 50, 50]),
  ]
}

export function createScreenShareSources(e2e: boolean): ScreenShareSources {
  const askedFile = () => join(app.getPath('userData'), 'screen-recording-asked')
  const asked = () => existsSync(askedFile())
  // A test sets the answer itself, the "not asked yet" included; Continue then allows.
  let permissionForTests: ScreenPermission = 'granted'
  let settingsOpenedForTests = 0
  const closedForTests = new Set<string>()

  const allowed = () => process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted'

  const permission = (): ScreenPermission => {
    if (e2e) return permissionForTests
    return allowed() ? 'granted' : asked() ? 'denied' : 'unknown'
  }

  const list = async (): Promise<ShareSources> => {
    const now = permission()
    if (now !== 'granted') return { permission: now, sources: [] }
    return { permission: now, sources: e2e ? fakeSources().filter((source) => !closedForTests.has(source.id)) : await capturerSources() }
  }

  return {
    list,
    allow: async () => {
      if (e2e) {
        if (permissionForTests === 'unknown') permissionForTests = 'granted'
        return list()
      }
      writeFileSync(askedFile(), '')
      // Listing the screens is what makes macOS ask. It returns at once; the answer counts once the user gives it,
      // and macOS may want Juno reopened first, which the sheet says.
      if (!allowed()) await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => [])
      return list()
    },
    windowOpen: async (id) => {
      if (e2e) return !closedForTests.has(id)
      if (!allowed()) return true
      const windows = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } }).catch(() => undefined)
      return windows === undefined || windows.some((source) => windowKey(source.id) === windowKey(id))
    },
    openSettings: async () => {
      if (e2e) settingsOpenedForTests += 1
      else await shell.openExternal(SCREEN_RECORDING_SETTINGS_URL)
    },
    testHooks: {
      screenRecording: (permission) => {
        permissionForTests = permission
      },
      screenRecordingSettingsOpened: () => settingsOpenedForTests,
      closeShareWindow: (id) => void closedForTests.add(id),
    },
  }
}
