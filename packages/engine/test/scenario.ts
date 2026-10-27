import { timed } from './profile'
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
import { startTestEngine, type EngineOptions, type RunningEngine } from './harness'

const MINUTE = 60_000
export const DAY = 24 * 60 * MINUTE

/**
 * Starts an engine on a fresh fake and waits for `live` and the follow pass. `track` collects engines for `afterEach` to stop.
 * The default seed is live in 0.5 to 2.6 s even on a loaded machine; a larger seed passes a longer `liveMillis`.
 */
export async function bootedEngine(track: Array<RunningEngine>, options: EngineOptions = {}, liveMillis = 30_000): Promise<RunningEngine> {
  const engine = await startTestEngine({ initial: (fake) => fake.signIn(), ...options })
  track.push(engine)
  await timed('ready', () => engine.status('ready'))
  await timed('live', () => engine.phase('live', liveMillis))
  await timed('sync idle', () => engine.syncIdle())
  return engine
}

/**
 * Stops `engine` and starts a new one on the same user-data directory and
 * fake: a warm boot. `whileStopped` runs in between, with no socket open.
 * The new engine owns the fake and the directory from then on. `options`
 * start it as `bootedEngine`'s do.
 */
export async function restart(track: Array<RunningEngine>, engine: RunningEngine, whileStopped: (fake: FakeSlack) => void = () => {}, options: EngineOptions = {}, liveMillis = 30_000): Promise<RunningEngine> {
  const { fake, userData } = engine
  const credentials = fake.credentials()
  // Background work (the follow pass) must not answer after the stop and count against the next engine.
  await timed('sync idle', () => engine.syncIdle())
  engine.registry.dispose()
  await engine.handle.stop()
  track.splice(track.indexOf(engine), 1)
  whileStopped(fake)
  fake.resetCalls()
  const next = await startTestEngine({ ...options, reuse: { userData, fake, credentials }, initial: () => credentials })
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
  await owned.phase('live', liveMillis)
  await owned.syncIdle()
  return owned
}

/** Web API methods that change something in Slack. Every other method Juno calls only reads. */
const WRITE_METHODS = new Set([
  'users.prefs.set', 'users.profile.set', 'presence.set', 'conversations.mark', 'conversations.open', 'conversations.create', 'conversations.rename', 'conversations.invite', 'conversations.kick',
  'subscriptions.thread.mark', 'subscriptions.thread.add', 'subscriptions.thread.remove', 'chat.postMessage', 'chat.shareMessage',
  'chat.update', 'chat.delete', 'reactions.add', 'reactions.remove', 'files.getUploadURL', 'files.completeUpload', 'files.share',
  'rooms.join', 'rooms.leave',
])

/** The calls since the `since`-th that wrote to Slack. Background reads may land at any time, so "nothing was written" is the check that holds. */
export const slackWrites = (engine: RunningEngine, since = 0) =>
  engine.fake.calls.slice(since).filter((call) => call.kind === 'upload' || WRITE_METHODS.has(call.method))

export const apiCalls = (engine: RunningEngine, method?: string) =>
  engine.fake.calls.filter((c) => c.kind === 'api' && (method === undefined || c.method === method))

/** A page of the recheck after a drop or a restart (`@juno/sync` `recheck.ts`). */
export const notRecheck = (call: { readonly args: Readonly<Record<string, string>> }) => !['recheck', 'mutation-repair'].includes(call.args['_x_reason'] ?? '')

/** Waits for the work already triggered, without inferring idleness from elapsed time. */
export async function quiet(engine: RunningEngine): Promise<void> {
  await timed('sync idle', () => engine.syncIdle())
  await engine.socketIdle()
  await engine.handle.commandIdle()
  if (engine.fake.heldCount() === 0 && engine.fake.gated().length === 0) {
    await Promise.all([engine.workPass('post'), engine.workPass('action'), engine.workPass('mark')])
  }
}

/** The caller owns this connection and must close it before replacing the workspace files. */
export const openDb = (engine: RunningEngine, file: 'cache.db' | 'user.db', workspaceId = engine.fake.teamId): DatabaseSync =>
  new DatabaseSync(join(engine.userData, 'workspaces', workspaceId, file), { readOnly: true })

/** Opens a workspace file read-only, runs `f`, closes it. */
export function readDb<A>(engine: RunningEngine, file: 'cache.db' | 'user.db', f: (db: DatabaseSync) => A, workspaceId = engine.fake.teamId): A {
  const db = openDb(engine, file, workspaceId)
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

/**
 * Every value `storedFollow` takes for a thread while it runs, read every
 * few milliseconds, so a test can tell that a value never came back even
 * for a moment. `stop` returns them.
 */
export function watchFollow(engine: RunningEngine, channel: string, threadTs: string): { readonly stop: () => ReadonlySet<number | undefined> } {
  const seen = new Set<number | undefined>([storedFollow(engine, channel, threadTs)])
  const timer = setInterval(() => seen.add(storedFollow(engine, channel, threadTs)), 5)
  return {
    stop: () => {
      clearInterval(timer)
      seen.add(storedFollow(engine, channel, threadTs))
      return seen
    },
  }
}

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
