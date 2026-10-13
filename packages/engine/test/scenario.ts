/**
 * Helpers the sync, reconnect and convergence tests share: a booted engine,
 * a warm restart on the same store and fake, call counting, read-only looks
 * into the store, and threads set up in the fake (old ones included).
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { Cause, Exit, Option } from 'effect'
import { topicsSubscribe, topicsUnsubscribe } from '@juno/contract'
import type { FakeSlack } from '@juno/fake-slack'
import { runCommand } from '@juno/state'
import { sleep, startTestEngine, waitFor, type EngineOptions, type RunningEngine } from './harness'

const MINUTE = 60_000
export const DAY = 24 * 60 * MINUTE

/** Starts an engine on a fresh fake and waits for `live`. `track` collects engines for `afterEach` to stop. */
export async function bootedEngine(track: Array<RunningEngine>, options: EngineOptions = {}): Promise<RunningEngine> {
  const engine = await startTestEngine({ initial: (fake) => fake.signIn(), ...options })
  track.push(engine)
  await engine.status('ready')
  await engine.phase('live', 30_000)
  return engine
}

/**
 * Stops `engine` and starts a new one on the same user-data directory and
 * fake: a warm boot. `whileStopped` runs in between, with no socket open.
 * The new engine owns the fake and the directory from then on.
 */
export async function restart(track: Array<RunningEngine>, engine: RunningEngine, whileStopped: (fake: FakeSlack) => void = () => {}): Promise<RunningEngine> {
  const { fake, userData } = engine
  const credentials = fake.credentials()
  await engine.handle.stop()
  track.splice(track.indexOf(engine), 1)
  whileStopped(fake)
  fake.resetCalls()
  const next = await startTestEngine({ reuse: { userData, fake, credentials }, initial: () => credentials })
  // `reuse` leaves the fake and the directory alone on stop; this wrapper cleans them up.
  const owned: RunningEngine = {
    ...next,
    stop: async () => {
      await next.stop()
      await fake.close()
      await rm(userData, { recursive: true, force: true })
    },
  }
  track.push(owned)
  await owned.status('ready')
  await owned.phase('live', 30_000)
  return owned
}

export const apiCalls = (engine: RunningEngine, method?: string) =>
  engine.fake.calls.filter((c) => c.kind === 'api' && (method === undefined || c.method === method))

/** Calls by `kind:method`, for exact budgets. */
export const callMap = (engine: RunningEngine): Record<string, number> => {
  const map: Record<string, number> = {}
  for (const call of engine.fake.calls) map[`${call.kind}:${call.method}`] = (map[`${call.kind}:${call.method}`] ?? 0) + 1
  return map
}

/** Waits until the engine has made no call to the fake for a while. */
export async function quiet(engine: RunningEngine, label = 'the engine to go quiet'): Promise<void> {
  let calls = engine.fake.calls.length
  await waitFor(
    async () => {
      await sleep(300)
      const now = engine.fake.calls.length
      const settled = now === calls
      calls = now
      return settled ? true : undefined
    },
    30_000,
    label,
  )
}

/** Opens a workspace file read-only, runs `f`, closes it. */
export function readDb<A>(engine: RunningEngine, file: 'cache.db' | 'user.db', f: (db: DatabaseSync) => A, workspaceId = engine.fake.teamId): A {
  const db = new DatabaseSync(join(engine.userData, 'workspaces', workspaceId, file), { readOnly: true })
  try {
    return f(db)
  } finally {
    db.close()
  }
}

/** `thread_subs.subscribed` for a thread: 1, 0, or undefined when Slack said nothing. */
export const storedFollow = (engine: RunningEngine, channel: string, threadTs: string): number | undefined =>
  readDb(engine, 'cache.db', (db) => {
    const row = db.prepare('SELECT subscribed FROM thread_subs WHERE channel = ? AND thread_ts = ?').get(channel, threadTs) as { subscribed: number } | undefined
    return row?.subscribed
  })

/** The topic id of a thread in the fake, by the start of its root's text. */
export const threadId = (fake: FakeSlack, channel: string, prefix: string) => `t:${channel}:${fake.messages(channel).find((m) => m.text?.startsWith(prefix))!.ts}`
export const tsOf = (topicId: string) => topicId.split(':')[2]!

export const subscribe = (engine: RunningEngine, id: string) => runCommand(engine.registry, topicsSubscribe, { id })
export const unsubscribe = (engine: RunningEngine, id: string) => runCommand(engine.registry, topicsUnsubscribe, { id })

export const valueOf = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`command failed: ${Cause.pretty(exit.cause)}`)
}
export const errorOf = <A, E>(exit: Exit.Exit<A, E>): E | undefined => (Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined)

export interface SeededThread {
  readonly channel: string
  readonly ts: string
  readonly id: string
}

/**
 * A thread in the fake with no events: a root `ago` ms before now and one
 * reply per entry of `replies` (ms before now), followed or not, read up to
 * `unread` replies from the end. For setting up a workspace before a boot
 * or while the engine is stopped.
 */
export function seedThread(
  fake: FakeSlack,
  input: { channel: string; text: string; ago: number; replies: ReadonlyArray<number>; follow: boolean; unread?: number; from?: string },
): SeededThread {
  const now = fake.now()
  const root = fake.workspace.post({ channel: input.channel, user: input.from ?? 'U0LEO', text: input.text, at: now - input.ago, silent: true })
  const replies = input.replies.map((ago, i) =>
    fake.workspace.post({ channel: input.channel, user: i % 2 === 0 ? 'U0MAYA' : 'U0SAM', text: `${input.text} reply ${i + 1}`, threadTs: root.ts, at: now - ago, silent: true }),
  )
  const unread = input.unread ?? 0
  const lastRead = replies.at(-1 - unread)?.ts ?? root.ts
  fake.workspace.subscriptions.set(`${input.channel}:${root.ts}`, {
    channel: input.channel,
    threadTs: root.ts,
    lastRead,
    subscribed: input.follow,
    dateCreate: now - input.ago,
  })
  return { channel: input.channel, ts: root.ts, id: `t:${input.channel}:${root.ts}` }
}
