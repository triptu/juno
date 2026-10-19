/**
 * The huddle's media session, at the app root and outside React
 * (docs/plans/huddles.md, phase 3; decision `huddles-media-in-renderer`).
 * Switching or closing tabs never touches it.
 *
 * - At start it asks main for this page's generation (`huddle.register`).
 * - On the first join it loads the Chime session with `import()`, or the
 *   fake under JUNO_E2E, and keeps it for the page's life.
 * - It sends the page's whole media state (`huddle.report`) on every change
 *   and every time the engine connection opens.
 * - It runs a session only for the attendee `huddle.call` names, and stops
 *   any other.
 * - It tells main what the Huddle menu follows, and runs that menu's commands.
 *
 * The credentials from `huddle.start` go to the session and nowhere else:
 * never log, store or report them.
 */
import type { HuddleCall, HuddleCredentials, HuddleMediaEnd, HuddleMenu, HuddlePageReport, HuddleRegistration } from '@juno/contract'
import type { Devices, EndReason, MediaSession, MediaSnapshot } from '@juno/huddle-media'
import { connectionStateAtom, huddleCallValueAtom, leaveHuddle, onMenuCommand, registry, reportHuddleMedia, showToast, startHuddle } from '@juno/state'
import { openHuddle } from '../navigation'
import { watchHuddleEnds } from './toasts'

/** Chime's nearest media region, which only the page may look up (research section 1). */
const REGION_URL = 'https://nearest-media-region.l.chime.aws'
const REGION_TIMEOUT_MS = 2_000
/** The fake media session's region, so a test sees the request shape a real join has. */
const FAKE_REGION = 'us-east-1'

/** The device picks, kept on this Mac (SPEC 20). */
const PICKS_KEY = 'juno.huddle.devices'
interface Picks {
  readonly microphone: string | null
  readonly speaker: string | null
  readonly noiseSuppression: boolean
}

const endOf: Record<EndReason, HuddleMediaEnd> = {
  left: 'left',
  'another-device': 'anotherDevice',
  'connection-lost': 'connectionLost',
  'meeting-ended': 'ended',
  removed: 'failed',
  full: 'failed',
  failed: 'failed',
}

let registration: Promise<HuddleRegistration> | undefined
let loading: Promise<MediaSession> | undefined
let session: MediaSession | undefined
/** Credentials handed to this page that wait for `huddle.call` to name their attendee. */
let pending: { readonly attendeeId: string; readonly credentials: HuddleCredentials } | undefined
/** The attendee the session runs for, from `join` until it ends. */
let holding: string | null = null
let received: string | null = null
let ended: HuddlePageReport['ended'] = null
let seq = 0
let lastSent = ''
let lastMenu = ''
const listeners = new Set<() => void>()

function readPicks(): Picks {
  try {
    const saved = JSON.parse(localStorage.getItem(PICKS_KEY) ?? '{}') as Partial<Picks>
    return { microphone: saved.microphone ?? null, speaker: saved.speaker ?? null, noiseSuppression: saved.noiseSuppression ?? true }
  } catch {
    return { microphone: null, speaker: null, noiseSuppression: true }
  }
}

function savePicks(change: Partial<Picks>): void {
  localStorage.setItem(PICKS_KEY, JSON.stringify({ ...readPicks(), ...change }))
}

const register = (): Promise<HuddleRegistration> => (registration ??= window.juno.huddle.register() as Promise<HuddleRegistration>)

function load(fake: boolean): Promise<MediaSession> {
  loading ??= (fake
    ? import('@juno/huddle-media/fake').then((module) => {
        const created = module.createFakeMediaSession()
        // Tests drive the fake from the page: other people, speaking, an end.
        Object.assign(window, { __junoHuddleMedia: created })
        return created as MediaSession
      })
    : import('@juno/huddle-media/chime').then((module) => module.createChimeMediaSession())
  ).then((created) => {
    session = created
    created.subscribe(onSnapshot)
    window.addEventListener('focus', () => void created.listDevices())
    return created
  })
  return loading
}

async function nearestRegion(): Promise<string | null> {
  try {
    const response = await fetch(REGION_URL, { signal: AbortSignal.timeout(REGION_TIMEOUT_MS) })
    const json = (await response.json()) as { region?: unknown }
    return typeof json.region === 'string' ? json.region : null
  } catch {
    return null
  }
}

function onSnapshot(): void {
  const snapshot = session?.getSnapshot()
  if (snapshot === undefined) return
  const connection = snapshot.connection
  if (connection.state === 'ended' && connection.attendeeId === holding) {
    ended = { attendeeId: connection.attendeeId, reason: endOf[connection.reason] }
    holding = null
  }
  for (const listener of listeners) listener()
  void report()
  sendMenu()
}

/** The call the user is in, from Join or Start until they are out, as the bar shows it; else undefined. */
export function currentCall(): HuddleCall | undefined {
  const call = registry.get(huddleCallValueAtom)
  return call !== undefined && (call.phase === 'joining' || call.phase === 'joined') ? call : undefined
}

/** The Huddle menu's state, sent to main when it changed. */
function sendMenu(): void {
  const menu: HuddleMenu = currentCall() === undefined ? null : { muted: session?.getSnapshot().local.muted ?? false }
  const key = JSON.stringify(menu)
  if (key === lastMenu) return
  lastMenu = key
  void window.juno.huddle.setMenu(menu).catch(() => {})
}

/** Huddle › Show Huddle: the huddle tab, focused or opened. */
export function showCurrentHuddle(): void {
  const channelId = currentCall()?.channelId ?? null
  if (channelId !== null) openHuddle(channelId)
}

/** The page's whole media state, when it changed or `force`. */
async function report(force = false): Promise<void> {
  if (registration === undefined) return
  const { generation } = await registration
  const snapshot = session?.getSnapshot()
  const state = snapshot?.connection.state
  const live = state === 'connecting' || state === 'connected' || state === 'reconnecting'
  const body = {
    generation,
    holds: holding,
    received,
    // The engine reads the connection only while the page holds a session.
    connection: live ? state : 'connecting',
    muted: snapshot?.local.muted ?? false,
    ended,
  } as const
  const key = JSON.stringify(body)
  if (!force && key === lastSent) return
  lastSent = key
  await reportHuddleMedia(registry, { ...body, seq: ++seq })
}

/** Starts or stops the session to match the engine's call. */
function reconcile(call: HuddleCall | undefined): void {
  if (call === undefined) return
  if (holding !== null && call.attendeeId !== holding) {
    // The engine's call no longer names this session: stop it. Its end reports `left`.
    void session?.leave()
  }
  if (pending !== undefined && call.attendeeId === pending.attendeeId && holding === null && session !== undefined) {
    const { attendeeId, credentials } = pending
    pending = undefined
    holding = attendeeId
    received = attendeeId
    const picks = readPicks()
    void session
      .join({ meeting: credentials.meeting, attendee: credentials.attendee, microphone: picks.microphone, speaker: picks.speaker, noiseSuppression: picks.noiseSuppression })
      .catch(() => {
        if (holding === attendeeId) {
          holding = null
          ended = { attendeeId, reason: 'failed' }
          void report()
        }
      })
    void report()
  } else if (pending !== undefined && (call.phase === 'idle' || (call.attendeeId !== null && call.attendeeId !== pending.attendeeId))) {
    // Replaced before it started: the page received it and holds nothing for it.
    received = pending.attendeeId
    pending = undefined
    void report()
  }
}

/** Starts the service: called once at the app root, after the first paint. */
export function startHuddleMedia(): void {
  void register()
  registry.subscribe(
    huddleCallValueAtom,
    (call) => {
      reconcile(call)
      sendMenu()
    },
    { immediate: true },
  )
  onMenuCommand((command) => {
    if (command === 'huddle.show') showCurrentHuddle()
    else if (command === 'huddle.mute') toggleHuddleMuted()
    else if (command === 'huddle.leave' && currentCall() !== undefined) leaveCurrentHuddle()
  })
  watchHuddleEnds((channelId) => void joinHuddle(channelId))
  // ⌘⇧Space mutes and unmutes while Juno is the active app (SPEC 20).
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || !event.metaKey || !event.shiftKey || event.altKey || event.ctrlKey || holding === null) return
    event.preventDefault()
    toggleHuddleMuted()
  })
  // The whole state again every time the engine connection opens, an engine restart included.
  registry.subscribe(
    connectionStateAtom,
    (state) => {
      if (state === 'connected') void report(true)
    },
    { immediate: true },
  )
}

export type JoinOutcome = 'joined' | 'cancelled' | 'failed'

/** Start or Join: the huddle in a channel, leaving the current one first. */
export async function joinHuddle(channelId: string): Promise<JoinOutcome> {
  const { generation, fakeMedia } = await register()
  // The session's chunk loads while Chime's region is looked up.
  const [, region] = await Promise.all([load(fakeMedia), fakeMedia ? Promise.resolve(FAKE_REGION) : nearestRegion()])
  const exit = await startHuddle(registry, channelId, region, generation)
  if (exit._tag === 'Failure') {
    // Slack's refusals also end the call as `joinFailed`, which shows the same toast; this covers no answer at all.
    showToast(registry, { text: "Couldn't join the huddle", action: { label: 'Try again', onAction: () => void joinHuddle(channelId) } })
    return 'failed'
  }
  const result = exit.value
  if (result._tag !== 'joined') return 'cancelled'
  pending = { attendeeId: result.attendeeId, credentials: result.credentials }
  reconcile(registry.get(huddleCallValueAtom))
  return 'joined'
}

/** Leave: the engine sends the leave, and its call then stops the session here. */
export function leaveCurrentHuddle(): void {
  void leaveHuddle(registry)
}

export function toggleHuddleMuted(): void {
  const snapshot = session?.getSnapshot()
  if (snapshot !== undefined && holding !== null) session?.setMuted(!snapshot.local.muted)
}

export function chooseMicrophone(id: string | null): void {
  savePicks({ microphone: id })
  void session?.chooseMicrophone(id)
}

export function chooseSpeaker(id: string | null): void {
  savePicks({ speaker: id })
  void session?.chooseSpeaker(id)
}

export function setNoiseSuppression(on: boolean): void {
  savePicks({ noiseSuppression: on })
  void session?.setNoiseSuppression(on)
}

/** Lists the devices again, for the device menu. */
export function refreshDevices(): Promise<Devices | undefined> {
  return session?.listDevices() ?? Promise.resolve(undefined)
}

/** For `useSyncExternalStore`: the session's snapshot, undefined until the first join loads it. */
export function subscribeMedia(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function mediaSnapshot(): MediaSnapshot | undefined {
  return session?.getSnapshot()
}
