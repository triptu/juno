/**
 * Helpers the huddle flows share. The renderer page's media session is
 * played by the test: it sends its whole state with `huddle.report`, and
 * `stopMedia` also tells the fake Slack that Chime dropped the attendee,
 * which is what removes it on arch v2. Main's page reports are delivered
 * with `pagesLive`.
 *
 * `huddleScenario()` is called once per file: it stops that file's engines
 * after each test and numbers that file's page reports.
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach } from 'bun:test'
import { huddleCall, huddleLeave, huddleReport, huddleRunning, huddleStart, type HuddleCall, type HuddleMediaEnd, type HuddlePageReport, type HuddleStartResult, type RunningHuddles } from '@juno/contract'
import { liveQuery, runCommand, type Registry } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, readDb, restart, valueOf } from './scenario'
import { syncedEngine, type SyncedOptions } from './synced'

export const SELF = 'U0TUSHAR'
/** The test's renderer page, as its media service registers it. */
export const PAGE = 1001
/** The page that loads after `PAGE`. */
export const PAGE2 = 1002
const callAtom = liveQuery(huddleCall)(undefined)
const runningAtom = liveQuery(huddleRunning)(undefined)

export type Joined = Extract<HuddleStartResult, { _tag: 'joined' }>

/** Mounts the huddle values, and makes the fake's arch v2 delays short. */
export function watchHuddles(engine: RunningEngine): RunningEngine {
  engine.registry.mount(callAtom)
  engine.registry.mount(runningAtom)
  engine.fake.control('setHuddleArch', { arch: 'v2', leaveDelayMs: 100, emptyDelayMs: 300 })
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

/** `via`: the page's engine connection; else the engine's own registry. */
export const start = (engine: RunningEngine, channelId: string, generation = PAGE, via: Registry = engine.registry) =>
  runCommand(via, huddleStart, { channelId, region: 'us-east-1', generation })

export const joined = async (engine: RunningEngine, channelId: string, generation = PAGE): Promise<Joined> => {
  const result = valueOf(await start(engine, channelId, generation))
  if (result._tag !== 'joined') throw new Error(`start in ${channelId} was ${result._tag}`)
  return result
}

export const leave = async (engine: RunningEngine) => valueOf(await runCommand(engine.registry, huddleLeave, undefined))

/** The value of a promise, or its rejection thrown; fails with `label` if it has not settled within the harness wait. */
export async function settled<A>(promise: Promise<A>, label: string): Promise<A> {
  let outcome: { readonly value: A } | { readonly rejected: unknown } | undefined
  promise.then((value) => { outcome = { value } }, (rejected: unknown) => { outcome = { rejected } })
  const done = await waitFor(() => outcome, WAIT_MS, label)
  if ('rejected' in done) throw done.rejected
  return done.value
}

export const leaves = (engine: RunningEngine) => apiCalls(engine, 'rooms.leave')
export const joins = (engine: RunningEngine) => apiCalls(engine, 'rooms.join')
export const leftAttendees = (engine: RunningEngine) => leaves(engine).map((call) => call.args['attendee_id'])
export const callOrder = (engine: RunningEngine) => engine.fake.calls.filter((call) => call.method === 'rooms.join' || call.method === 'rooms.leave').map((call) => call.method)

/** The leaves stored in user.db: the durable record the protocol keeps until the media is known stopped. */
export const storedLeaves = (engine: RunningEngine): unknown =>
  readDb(engine, 'user.db', (db) => {
    const row = db.prepare('SELECT value_json FROM prefs WHERE key = ?').get('huddle.pendingLeaves') as { value_json: string } | undefined
    return row === undefined ? undefined : JSON.parse(row.value_json)
  })

export const cleared = (engine: RunningEngine, label: string) =>
  waitFor(() => ((storedLeaves(engine) as Array<unknown> | undefined)?.length === 0 ? true : undefined), WAIT_MS, label)

export const recordOf = (result: Joined, generation: number | null = PAGE) => ({ channelId: result.channelId, callId: result.callId, attendeeId: result.attendeeId, generation })

/** Writes the stored leaves directly, as a damaged or older store would hold them. The engine must be stopped, or the value is read on its next try. */
export function writeStoredLeaves(userData: string, workspaceId: string, value: string): void {
  const db = new DatabaseSync(join(userData, 'workspaces', workspaceId, 'user.db'))
  try {
    db.prepare('INSERT OR REPLACE INTO prefs (key, value_json) VALUES (?, ?)').run('huddle.pendingLeaves', value)
  } finally {
    db.close()
  }
}

/** Main's report of the live page generations. */
export const pagesLive = (engine: RunningEngine, ...live: Array<number>) => pagesReport(engine, live, Math.max(0, ...live))

/** Main's report with the highest generation it gave out, which may be a page that never got listed. */
export const pagesReport = (engine: RunningEngine, live: ReadonlyArray<number>, maxIssued: number) => engine.main.host.deliver({ _tag: 'huddlePages', live, maxIssued })

type FrameWhere = NonNullable<Parameters<RunningEngine['fake']['holdFramesWhere']>[0]>

export const isRoomFrame = (type: string, channel: string): FrameWhere => (frame) =>
  frame.type === 'unknown' && frame.raw['type'] === type && (frame.raw['huddle'] as { channel_id?: string } | undefined)?.channel_id === channel

/** The engines and page reports of one test file. */
export function huddleScenario() {
  const engines: Array<RunningEngine> = []
  let seq = 0
  afterEach(async () => {
    for (const engine of engines.splice(0).toReversed()) await engine.stop()
  })

  /** The page's whole media state, numbered as the page numbers its reports unless `state.seq` says. `via`: the page's engine connection. */
  const report = async (engine: RunningEngine, state: Partial<HuddlePageReport> = {}, via: Registry = engine.registry) => {
    seq = Math.max(seq + 1, state.seq ?? 0)
    return valueOf(await runCommand(via, huddleReport, { report: { generation: PAGE, holds: null, received: null, connection: 'connected', muted: false, hasRemote: false, ended: null, seq, ...state } }))
  }

  /** The page started the session it was handed. */
  const started = (engine: RunningEngine, attendeeId: string, generation: number = PAGE) => report(engine, { generation, holds: attendeeId, received: attendeeId })

  /** The page's media session ended: it reports so, and Chime drops the attendee. */
  const stopMedia = async (engine: RunningEngine, attendeeId: string, reason: HuddleMediaEnd = 'left', generation: number = PAGE) => {
    await report(engine, { generation, received: attendeeId, ended: { attendeeId, reason } })
    engine.fake.control('stopMedia', { attendeeId })
  }

  return {
    report,
    started,
    stopMedia,

    /** A warm engine on the synced workspace, its huddle values watched and `PAGE` live. */
    booted: async (options: SyncedOptions = {}) => {
      const engine = watchHuddles(await syncedEngine(engines, options))
      pagesLive(engine, PAGE)
      return engine
    },

    /** A warm restart on the same store and fake; main has not reported any page to the new engine yet. */
    restarted: async (engine: RunningEngine, whileStopped: () => void = () => {}) => watchHuddles(await restart(engines, engine, whileStopped)),

    /** Joined with media running, as the page would after the hand-off. */
    inCall: async (engine: RunningEngine, channelId: string, generation = PAGE) => {
      const result = await joined(engine, channelId, generation)
      await started(engine, result.attendeeId, generation)
      await callUntil(engine, (call) => call.phase === 'joined' && call.attendeeId === result.attendeeId, 'joined')
      return result
    },

    /** Leaves, the page stops its media, and the stored leave clears. */
    endCall: async (engine: RunningEngine, attendeeId: string, generation = PAGE) => {
      await leave(engine)
      await stopMedia(engine, attendeeId, 'left', generation)
      await callUntil(engine, (call) => call.phase === 'idle', 'idle')
      await cleared(engine, 'the leave cleared')
    },
  }
}
