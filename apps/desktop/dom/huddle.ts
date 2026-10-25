// The huddle tests' helpers, as `e2e/huddleFake.ts` has them for the browser lane: the page
// runs the fake media session (`@juno/huddle-media/fake`), which a test drives through
// `window.__junoHuddleMedia`.
import type { FakeSlack } from '@juno/fake-slack'
import type { MediaWindow } from '../e2e/huddleFake'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import type { Dom } from './input'

const media = (dom: Dom) => (dom.window as unknown as MediaWindow).__junoHuddleMedia

export const connection = (dom: Dom) => media(dom).getSnapshot().connection.state
export const localMuted = (dom: Dom) => media(dom).getSnapshot().local.muted
export const attendee = (dom: Dom) => media(dom).getSnapshot().local.attendeeId ?? null
export const addRemote = (dom: Dom, userId: string) => media(dom).addRemote({ userId })
export const played = (dom: Dom) => [...media(dom).played]
export const endMedia = (dom: Dom, reason: string) => media(dom).end(reason)

/** Start huddle from the open topic's ⋯ menu: a channel's header has no Start huddle (SPEC 20). */
export async function startHuddleFromMenu(juno: Juno): Promise<void> {
  const menu = await juno.topic.chooseInMenu('huddle')
  expect(menu.labels).toContain('Start huddle')
}

/** The page's media stopped: Chime drops the attendee, which on v2 is how Slack learns of the leave. */
export async function chimeDrops(dom: Dom, fake: FakeSlack, attendeeId: string): Promise<void> {
  await expect.poll(() => connection(dom)).toBe('ended')
  fake.control('stopMedia', { attendeeId })
}

interface RingWindow {
  readonly __junoHuddleRing?: { readonly ringing: boolean; readonly starts: number }
}
/** The ring is recorded, not played, under JUNO_E2E. */
export const ringing = (dom: Dom) => (dom.window as unknown as RingWindow).__junoHuddleRing?.ringing ?? false
export const rings = (dom: Dom) => (dom.window as unknown as RingWindow).__junoHuddleRing?.starts ?? 0
