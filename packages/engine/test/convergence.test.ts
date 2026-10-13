// The randomised convergence test of architecture 5.4 and ADR 0011: after a
// seeded mix of posts, replies, edits, deletes, reactions, read marks,
// follows and unfollows (from another client and from Juno's commands) and
// socket drops, the store equals the fake, follow state equals the fake's
// (specs/follow.qnt `quietAgreement`), and the incremental topic index
// equals a full rebuild. The workspace follows more threads than one
// getView page holds.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { Store, workspacePathsFromDir } from '@juno/store'
import { reindexAll } from '@juno/sync'
import { UserId } from '@juno/domain'
import { sleep, startTestEngine, waitFor, type RunningEngine } from './harness'
import { DAY, quiet, seedThread, subscribe, unsubscribe } from './scenario'

let engine: RunningEngine | undefined
afterEach(async () => {
  await engine?.stop()
  engine = undefined
})

/** mulberry32, so a failure is reproducible from the seed. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PEOPLE = ['U0MAYA', 'U0LEO', 'U0SAM', 'U0PRIYA', 'U0JONAS', 'U0DEV']
/** After a refusal the socket waits out its backoff (capped at 2 s against the fake) before the next attempt. */
const RECONNECT_MS = 20_000
const SEED = Number(process.env['JUNO_CONVERGENCE_SEED'] ?? 7)
const ROUNDS = Number(process.env['JUNO_CONVERGENCE_ROUNDS'] ?? 80)

interface StoredMessage {
  readonly channel: string
  readonly ts: string
  readonly thread_ts: string | null
  readonly text: string
  readonly edited_ts: string | null
  readonly deleted: 0 | 1
  readonly reply_count: number
  readonly latest_reply: string | null
}

describe('convergence', () => {
  it(`after ${ROUNDS} random events with drops (seed ${SEED}) the store matches the fake and the index matches a rebuild`, async () => {
    engine = await startTestEngine({
      initial: (fake) => {
        // Enough followed threads that getView takes three pages.
        for (let i = 0; i < 15; i++) seedThread(fake, { channel: 'C0PLATFORM', text: `Rollout ${i + 1}`, ago: 3 * DAY, replies: [2 * DAY + i * 60_000], follow: true })
        return fake.signIn()
      },
    })
    await engine.status('ready')
    await engine.phase('live', 30_000)
    await engine.rowsUntil((rows) => rows.length >= 20, 'rows')
    const { fake } = engine
    const rand = random(SEED)
    const pick = <T>(list: ReadonlyArray<T>): T => list[Math.floor(rand() * list.length)]!
    const conversations = [...fake.workspace.conversations.values()].filter((c) => c.members.has(fake.selfId)).map((c) => c.id)
    const created: Array<{ channel: string; ts: string }> = []
    let connected = true

    const live = (channel: string) => fake.messages(channel).filter((m) => m.subtype !== 'tombstone')
    const roots = () => conversations.flatMap((channel) => live(channel).filter((m) => (m.reply_count ?? 0) > 0 || m.thread_ts === undefined).map((m) => ({ channel, message: m })))
    const anyMessage = () => conversations.flatMap((channel) => live(channel).map((m) => ({ channel, message: m })))

    /**
     * A follow change: from another client, or Juno's own command while connected. Offline it is mostly an
     * unfollow of a followed thread, the change no event will tell Juno about.
     */
    const changeFollow = async () => {
      const threads = roots().filter((r) => (r.message.reply_count ?? 0) > 0)
      const followedThreads = threads.filter((r) => fake.workspace.subscription(r.channel, r.message.ts)?.subscribed === true)
      const root = pick(!connected && followedThreads.length > 0 && rand() < 0.8 ? followedThreads : threads)
      if (root === undefined) return
      const followed = fake.workspace.subscription(root.channel, root.message.ts)?.subscribed === true
      const id = `t:${root.channel}:${root.message.ts}`
      if (connected && rand() < 0.5) await (followed ? unsubscribe(engine!, id) : subscribe(engine!, id))
      else if (followed) fake.unfollowThread({ channel: root.channel, threadTs: root.message.ts })
      else fake.followThread({ channel: root.channel, threadTs: root.message.ts })
    }

    for (let round = 0; round < ROUNDS; round++) {
      const roll = rand()
      if (roll < 0.3) {
        const channel = pick(conversations)
        created.push({ channel, ts: fake.injectMessage({ channel, user: pick(PEOPLE), text: `main ${round} ${pick(['ok', 'hmm', 'ship it', 'checking'])}` }).ts })
      } else if (roll < 0.55) {
        const root = pick(roots())
        created.push({ channel: root.channel, ts: fake.injectMessage({ channel: root.channel, user: pick(PEOPLE), text: `reply ${round}`, threadTs: root.message.ts }).ts })
      } else if (!connected) {
        // While the socket is down: new messages and follow changes. Edits and deletes during a drop are a known
        // gap (sync README).
        if (roll < 0.75) {
          const channel = pick(conversations)
          created.push({ channel, ts: fake.injectMessage({ channel, user: pick(PEOPLE), text: `offline ${round}` }).ts })
        } else if (roll < 0.9) {
          await changeFollow()
        } else {
          fake.goOnline()
          await engine.phase('live', RECONNECT_MS)
          await waitFor(() => (fake.socketCount() === 1 ? true : undefined), RECONNECT_MS, 'socket back')
          connected = true
        }
      } else if (roll < 0.65) {
        const target = pick(anyMessage())
        fake.editMessage({ channel: target.channel, ts: target.message.ts, text: `edited ${round}` })
      } else if (roll < 0.72) {
        const target = pick(anyMessage().filter((m) => created.some((c) => c.ts === m.message.ts)))
        if (target !== undefined) fake.deleteMessage({ channel: target.channel, ts: target.message.ts })
      } else if (roll < 0.82) {
        const target = pick(anyMessage())
        const name = pick(['eyes', '+1', 'tada'])
        const user = pick(PEOPLE)
        const has = target.message.reactions?.find((r) => r.name === name)?.users?.includes(user) === true
        if (has) fake.removeReaction({ channel: target.channel, ts: target.message.ts, name, user })
        else fake.addReaction({ channel: target.channel, ts: target.message.ts, name, user })
      } else if (roll < 0.86) {
        const channel = pick(conversations)
        const latest = fake.workspace.main(channel).at(-1)
        if (latest !== undefined) fake.markRead({ channel, ts: latest.ts })
      } else if (roll < 0.92) {
        await changeFollow()
      } else if (roll < 0.95) {
        if (connected) {
          // The socket stays down until the reconnect step: every event in between is lost to Juno.
          fake.goOffline()
          await engine.phase('offline', 20_000)
          connected = false
        }
      } else {
        // Let the socket come back before the next connected-only event.
        fake.goOnline()
        await engine.phase('live', RECONNECT_MS)
        await waitFor(() => (fake.socketCount() === 1 ? true : undefined), RECONNECT_MS, 'socket back')
        connected = true
      }
      if (rand() < 0.3) await sleep(5)
    }
    fake.goOnline()
    await engine.phase('live', RECONNECT_MS)
    await waitFor(() => (fake.socketCount() === 1 ? true : undefined), RECONNECT_MS, 'socket back')
    // One more complete getView pass once quiet, as the sweep would make: a thread that moved ahead of the
    // cursor during a pass is listed by the next one (specs/follow.qnt, "A moving real cursor").
    await quiet(engine)
    fake.dropSocket()
    await engine.phase('offline', 20_000)
    await engine.phase('live', 20_000)
    await waitFor(() => (fake.socketCount() === 1 ? true : undefined), 20_000, 'socket back')

    // Quiescence: the engine stops calling the fake and every created message is stored.
    const paths = workspacePathsFromDir(join(engine.userData, 'workspaces', fake.teamId))
    const db = new DatabaseSync(paths.userDb, { readOnly: true })
    db.exec(`ATTACH DATABASE '${paths.cacheDb}' AS cache`)
    const stored = () => db.prepare('SELECT channel, ts, thread_ts, text, edited_ts, deleted, reply_count, latest_reply FROM messages').all() as unknown as Array<StoredMessage>
    await waitFor(
      () => {
        const rows = stored()
        return created.every((c) => rows.some((r) => r.channel === c.channel && r.ts === c.ts)) ? true : undefined
      },
      30_000,
      'every created message stored',
    )
    let calls = fake.callCount()
    await waitFor(
      async () => {
        await sleep(300)
        const now = fake.callCount()
        const settled = now === calls
        calls = now
        return settled ? true : undefined
      },
      30_000,
      'the fake to go quiet',
    )
    await sleep(200)

    // 1. Every stored message says what the fake says; every created message is there; deleted ones are tombstones.
    const mismatches: Array<string> = []
    for (const row of stored()) {
      const actual = fake.messages(row.channel).find((m) => m.ts === row.ts)
      const describe = (what: string) => mismatches.push(`${row.channel}/${row.ts}: ${what}`)
      if (actual === undefined || actual.subtype === 'tombstone') {
        if (row.deleted !== 1) describe('deleted in the fake but live in the store')
        continue
      }
      if (row.deleted === 1) {
        describe('live in the fake but a tombstone in the store')
        continue
      }
      if (row.text !== (actual.text ?? '')) describe(`text ${JSON.stringify(row.text)} vs ${JSON.stringify(actual.text)}`)
      if ((row.edited_ts ?? null) !== (actual.edited?.ts ?? null)) describe('edited_ts differs')
      const withFields = fake.workspace.withThreadFields({ ...actual, channel: row.channel })
      if (row.reply_count !== (withFields.reply_count ?? 0)) describe(`reply_count ${row.reply_count} vs ${withFields.reply_count ?? 0}`)
      if ((row.latest_reply ?? null) !== (withFields.latest_reply ?? null)) describe(`latest_reply ${row.latest_reply} vs ${withFields.latest_reply}`)
      // Reactions: compared for messages posted during the test. A fixture message first stored from a search
      // match carries no reaction state until a page or an event brings it (sync README).
      if (!created.some((c) => c.channel === row.channel && c.ts === row.ts)) continue
      const reactions = db.prepare('SELECT name, user_ids_json FROM reactions WHERE channel = ? AND ts = ? ORDER BY name').all(row.channel, row.ts) as Array<{ name: string; user_ids_json: string }>
      const expectedReactions = [...(actual.reactions ?? [])].toSorted((a, b) => a.name.localeCompare(b.name)).map((r) => `${r.name}:${[...(r.users ?? [])].toSorted().join(',')}`)
      const storedReactions = reactions.map((r) => `${r.name}:${(JSON.parse(r.user_ids_json) as Array<string>).toSorted().join(',')}`)
      if (storedReactions.join('|') !== expectedReactions.join('|')) describe(`reactions ${storedReactions.join('|')} vs ${expectedReactions.join('|')}`)
    }
    expect(mismatches).toEqual([])

    // 2. Follow state equals Slack's: a followed thread is stored as followed, any other is not.
    const follows = new Map(
      (db.prepare('SELECT channel, thread_ts, subscribed FROM thread_subs').all() as Array<{ channel: string; thread_ts: string; subscribed: number }>).map((r) => [
        `${r.channel}:${r.thread_ts}`,
        r.subscribed,
      ]),
    )
    const followMismatches: Array<string> = []
    for (const sub of fake.workspace.subscriptions.values()) {
      if (!conversations.includes(sub.channel)) continue
      const here = follows.get(`${sub.channel}:${sub.threadTs}`)
      if (sub.subscribed && here !== 1) followMismatches.push(`${sub.channel}/${sub.threadTs}: followed in Slack, ${here ?? 'unknown'} here`)
      if (!sub.subscribed && here === 1) followMismatches.push(`${sub.channel}/${sub.threadTs}: unfollowed in Slack, followed here`)
    }
    for (const [key, here] of follows) {
      const [channel, threadTs] = key.split(':') as [string, string]
      if (here === 1 && fake.workspace.subscription(channel, threadTs)?.subscribed !== true) followMismatches.push(`${key}: followed here only`)
    }
    expect([...new Set(followMismatches)]).toEqual([])

    // 3. Read pointers follow the server marks.
    for (const channel of conversations) {
      const read = db.prepare('SELECT last_read_ts FROM topic_reads WHERE topic_id = ?').get(`m:${channel}`) as { last_read_ts: string } | undefined
      expect(read?.last_read_ts, channel).toBe(fake.workspace.reads.get(channel))
    }
    db.close()

    // 4. The incremental index equals a full rebuild: re-indexing every topic changes nothing.
    const changed = await Effect.runPromise(
      reindexAll({ me: { userId: UserId.make(fake.selfId) } }).pipe(Effect.provide(Store.layer(paths)), Effect.scoped),
    )
    expect(changed).toEqual([])
  }, 180_000)
})
