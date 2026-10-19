/**
 * Helpers the huddle tests share. The renderer page's media session is
 * played by the test: it sends its whole state with `huddle.report`, and
 * `stopMedia` also tells the fake Slack that Chime dropped the attendee,
 * which is what removes it on arch v2. Main's page reports are delivered
 * with `pagesLive`; `booted` lists the test's page.
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { huddleCall, huddleReport, huddleRunning, huddleStart, type HuddleCall, type HuddleMediaEnd, type HuddlePageReport, type HuddleStartResult, type RunningHuddles } from '@juno/contract'
import { liveQuery, runCommand, type Registry } from '@juno/state'
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
export const PAGE = 1001
/** The page that loads after `PAGE`. */
export const PAGE2 = 1002
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
  const engine = watchHuddles(await bootedEngine(track, options))
  pagesLive(engine, PAGE)
  return engine
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

let seq = 0


/** The page's whole media state, numbered as the page numbers its reports. */
/** `via`: the registry it goes through, another engine connection of the page; else the engine's own. */
export const report = async (engine: RunningEngine, state: Partial<HuddlePageReport> & { readonly generation?: number } = {}, via: Registry = engine.registry) =>
  valueOf(await runCommand(via, huddleReport, { report: { generation: PAGE, seq: ++seq, holds: null, received: null, connection: 'connected', muted: false, ended: null, ...state } }))

/** The page started the session it was handed. */
export const started = (engine: RunningEngine, attendeeId: string, generation: number = PAGE) => report(engine, { generation, holds: attendeeId, received: attendeeId })

/** The page's media session ended: it reports so, and Chime drops the attendee. */
export const stopMedia = async (engine: RunningEngine, attendeeId: string, reason: HuddleMediaEnd = 'left', generation: number = PAGE) => {
  await report(engine, { generation, received: attendeeId, ended: { attendeeId, reason } })
  engine.fake.control('stopMedia', { attendeeId })
}

/** Main's report of the live page generations. */
export const pagesLive = (engine: RunningEngine, ...live: Array<number>) => pagesReport(engine, live, Math.max(0, ...live))

/** Main's report with the highest generation it gave out, which may be a page that never got listed. */
export const pagesReport = (engine: RunningEngine, live: ReadonlyArray<number>, maxIssued: number) => engine.main.host.deliver({ _tag: 'huddlePages', live, maxIssued })

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

export const recordOf = (result: Joined, generation: number | null = PAGE) => ({ channelId: result.channelId, callId: result.callId, attendeeId: result.attendeeId, generation })

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
