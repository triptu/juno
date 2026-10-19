/**
 * Helpers the huddle tests share. The renderer page's media session is
 * played by the test: it reports `huddle.media` with its page generation,
 * and `stopMedia` also tells the fake Slack that Chime dropped the attendee,
 * which is what removes it on arch v2. Main's page reports are delivered
 * with `pagesLive`.
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { huddleCall, huddleMedia, huddleRunning, huddleStart, type HuddleCall, type HuddleMediaEnd, type HuddleStartResult, type RunningHuddles } from '@juno/contract'
import { liveQuery, runCommand } from '@juno/state'
import { waitFor, WAIT_MS, type EngineOptions, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, readDb, valueOf } from './scenario'

export const track: Array<RunningEngine> = []

export function stopHuddleEnginesAfterEach(): void {
  afterEach(async () => {
    for (const engine of track.splice(0)) await engine.stop()
  })
}

export const SELF = 'U0TUSHAR'
/** The test's renderer page, as its media service registers it. */
export const PAGE = 'page-1'
export const callAtom = liveQuery(huddleCall)(undefined)
export const runningAtom = liveQuery(huddleRunning)(undefined)

/** Mounts the huddle values, and makes the fake's arch v2 delays short. */
export function watchHuddles(engine: RunningEngine): RunningEngine {
  engine.registry.mount(callAtom)
  engine.registry.mount(runningAtom)
  engine.fake.control('setHuddleArch', { arch: 'v2', leaveDelayMs: 100, emptyDelayMs: 300 })
  return engine
}

export async function booted(options: EngineOptions = {}): Promise<RunningEngine> {
  return watchHuddles(await bootedEngine(track, options))
}

export const callUntil = (engine: RunningEngine, done: (call: HuddleCall) => boolean, label: string) =>
  waitFor(() => {
    const result = engine.registry.get(callAtom)
    return result._tag === 'Success' && done(result.value) ? result.value : undefined
  }, WAIT_MS, label)

export const runningUntil = (engine: RunningEngine, done: (running: RunningHuddles) => boolean, label: string) =>
  waitFor(() => {
    const result = engine.registry.get(runningAtom)
    return result._tag === 'Success' && done(result.value) ? result.value : undefined
  }, WAIT_MS, label)

export const start = (engine: RunningEngine, channelId: string, generation = PAGE) =>
  runCommand(engine.registry, huddleStart, { channelId, region: 'us-east-1', generation })

export type Joined = Extract<HuddleStartResult, { _tag: 'joined' }>

export const joined = async (engine: RunningEngine, channelId: string, generation = PAGE): Promise<Joined> => {
  const result = valueOf(await start(engine, channelId, generation))
  if (result._tag !== 'joined') throw new Error(`start in ${channelId} was ${result._tag}`)
  return result
}

export const started = async (engine: RunningEngine, attendeeId: string, generation = PAGE) =>
  valueOf(await runCommand(engine.registry, huddleMedia, { event: { _tag: 'started', generation, attendeeId } }))

/** The page's media session ended: it reports so, and Chime drops the attendee. */
export const stopMedia = async (engine: RunningEngine, attendeeId: string, reason: HuddleMediaEnd = 'left', generation = PAGE) => {
  valueOf(await runCommand(engine.registry, huddleMedia, { event: { _tag: 'ended', generation, attendeeId, reason } }))
  engine.fake.control('stopMedia', { attendeeId })
}

/** Main's report of the live page generations. */
export const pagesLive = (engine: RunningEngine, ...live: Array<string>) => engine.main.host.deliver({ _tag: 'huddlePages', live })

/** Joined with media running, as the page would after the hand-off. */
export const inCall = async (engine: RunningEngine, channelId: string, generation = PAGE) => {
  const result = await joined(engine, channelId, generation)
  await started(engine, result.attendeeId, generation)
  await callUntil(engine, (call) => call.phase === 'joined' && call.attendeeId === result.attendeeId, 'joined')
  return result
}

export const leaves = (engine: RunningEngine) => apiCalls(engine, 'rooms.leave')
export const joins = (engine: RunningEngine) => apiCalls(engine, 'rooms.join')
export const leftAttendees = (engine: RunningEngine) => leaves(engine).map((call) => call.args['attendee_id'])
export const callOrder = (engine: RunningEngine) => engine.fake.calls.filter((call) => call.method === 'rooms.join' || call.method === 'rooms.leave').map((call) => call.method)

export const storedLeaves = (engine: RunningEngine): unknown =>
  readDb(engine, 'user.db', (db) => {
    const row = db.prepare('SELECT value_json FROM prefs WHERE key = ?').get('huddle.pendingLeaves') as { value_json: string } | undefined
    return row === undefined ? undefined : JSON.parse(row.value_json)
  })

export const recordOf = (result: Joined, generation: string | null = PAGE) => ({ channelId: result.channelId, callId: result.callId, attendeeId: result.attendeeId, generation })

/** Writes the stored leaves directly, as a damaged or older store would hold them. The engine must be stopped. */
export function writeStoredLeaves(userData: string, workspaceId: string, value: string): void {
  const db = new DatabaseSync(join(userData, 'workspaces', workspaceId, 'user.db'))
  try {
    db.prepare('INSERT OR REPLACE INTO prefs (key, value_json) VALUES (?, ?)').run('huddle.pendingLeaves', value)
  } finally {
    db.close()
  }
}

type FrameWhere = NonNullable<Parameters<RunningEngine['fake']['holdFramesWhere']>[0]>

export const isRoomFrame = (type: string, channel: string): FrameWhere => (frame) =>
  frame.type === 'unknown' && frame.raw['type'] === type && (frame.raw['huddle'] as { channel_id?: string } | undefined)?.channel_id === channel
