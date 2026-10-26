/**
 * The huddle specs' shared helpers. Under JUNO_E2E the page runs the fake
 * media session (`@juno/huddle-media/fake`), which a test drives through
 * `window.__junoHuddleMedia`, and main draws the share sheet's sources and
 * takes macOS's Screen Recording answer from the test (`main/screenShare.ts`).
 */
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './fixtures'

/** The fake media session's surface the test drives (`FakeMediaSession`). */
interface FakeMedia {
  getSnapshot(): {
    readonly local: { readonly attendeeId: string | undefined; readonly muted: boolean }
    readonly connection: { readonly state: string }
    readonly shares: ReadonlyArray<{ readonly userId: string | undefined; readonly ready: boolean }>
    readonly localShare: { readonly sourceId: string } | undefined
  }
  addRemote(remote: { readonly userId: string }): string
  /** Someone starts or stops sharing their screen; a shown share plays a drawn test pattern. */
  startShare(userId: string): string
  stopShare(userId: string): void
  end(reason: string): void
  setMicrophoneAccess(access: string): void
  /** The user's own share: its capture ends, as a closed window or macOS's Stop would end it. */
  endOwnSource(): void
  /** The next own share fails to start. */
  failNextShare: boolean
  /** The call sounds the page asked for, in order. */
  readonly played: ReadonlyArray<string>
}
export type MediaWindow = Window & { readonly __junoHuddleMedia: FakeMedia }

export const connection = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().connection.state)
export const localMuted = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().local.muted)
export const attendee = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().local.attendeeId ?? null)
export const addRemote = (win: Page, userId: string) => win.evaluate((id) => (window as unknown as MediaWindow).__junoHuddleMedia.addRemote({ userId: id }), userId)
export const microphoneAccess = (win: Page, access: string) => win.evaluate((given) => (window as unknown as MediaWindow).__junoHuddleMedia.setMicrophoneAccess(given), access)
export const startShare = (win: Page, userId: string) => win.evaluate((id) => (window as unknown as MediaWindow).__junoHuddleMedia.startShare(id), userId)
export const stopShare = (win: Page, userId: string) => win.evaluate((id) => (window as unknown as MediaWindow).__junoHuddleMedia.stopShare(id), userId)
export const sharesReady = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().shares.map((share) => share.ready))
/** The video plays and keeps getting new frames: more are decoded over 300 ms. */
export const playing = (video: Locator) =>
  video.evaluate(async (element: HTMLVideoElement) => {
    const frames = () => element.getVideoPlaybackQuality().totalVideoFrames
    if (element.readyState < 2 || element.paused || element.videoWidth === 0) return false
    const before = frames()
    await new Promise((resolve) => setTimeout(resolve, 300))
    return frames() > before
  })
/** Signs in, unless the test starts synced (`signedIn`), and opens #eng's Main. */
export async function openEngMain(juno: Juno, { signedIn = false }: { readonly signedIn?: boolean } = {}): Promise<void> {
  if (!signedIn) await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await juno.sidebar.leave()
}

/** Start huddle from the open topic's ⋯ menu: a channel's header has no Start huddle (SPEC 20). */
export async function startHuddleFromMenu(juno: Juno): Promise<void> {
  const menu = await juno.topic.chooseInMenu('huddle')
  expect(menu.labels).toContain('Start huddle')
}

/** The page's media stopped: Chime drops the attendee, which on v2 is how Slack learns of the leave. */
export async function chimeDrops(win: Page, fake: FakeSlack, attendeeId: string): Promise<void> {
  await expect.poll(() => connection(win)).toBe('ended')
  fake.control('stopMedia', { attendeeId })
}

/** A Huddle menu item as main built it: its label and whether it is enabled. */
export const huddleMenuItem = (app: ElectronApplication, id: 'huddle-show' | 'huddle-mute' | 'huddle-share' | 'huddle-leave') =>
  app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    return item === undefined || item === null ? null : { label: item.label, enabled: item.enabled }
  }, id)

/** The source id of what the user shares, or null. */
export const ownShare = (win: Page) => win.evaluate(() => (window as unknown as MediaWindow).__junoHuddleMedia.getSnapshot().localShare?.sourceId ?? null)

interface ShareHooks {
  readonly junoTest: { screenRecording: (permission: string) => void; closeShareWindow: (id: string) => void }
}
/** What macOS answers about recording the screen: not asked yet, off for Juno, or allowed. */
export const screenRecording = (app: ElectronApplication, permission: 'unknown' | 'denied' | 'granted') =>
  app.evaluate((_, given) => (globalThis as unknown as ShareHooks).junoTest.screenRecording(given), permission)
/** A shareable window closes, so main no longer lists it. */
export const closeShareWindow = (app: ElectronApplication, id: string) => app.evaluate((_, given) => (globalThis as unknown as ShareHooks).junoTest.closeShareWindow(given), id)
