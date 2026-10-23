#!/usr/bin/env bun
/**
 * The live check for other people's presence (research section 3,
 * Presence): whether Slack answers a `presence_sub` with the current
 * presence of the subscribed users, on Juno's socket parameters (which
 * include `no_query_on_subscribe=1`). Run with
 * `JUNO_LIVE=1 bun run presence:sub-live`. It refuses to run without
 * `JUNO_LIVE=1`, and reuses the session `smoke-live.ts --cache-session` kept.
 *
 * 1. Lists up to `--people` (default 30) DM partners with
 *    `conversations.list types=im`.
 * 2. Opens Juno's socket, sends `presence_sub` with those ids and counts
 *    the `presence_change` frames for `--seconds` (default 10).
 * 3. Reads each partner's presence with the public `users.getPresence` and
 *    counts how many agree with what the socket said.
 * 4. Sends an empty `presence_sub` and counts frames for `--seconds` more.
 *
 * With `--self`, step 1 is skipped and the subscription holds only the
 * signed-in user's own id, as Juno's does among the others: the output says
 * whether Slack named that id, and what it and `users.getPresence` said.
 *
 * Writes nothing to Slack: the HTTP calls are `conversations.list`,
 * `client.getWebSocketURL` and `users.getPresence`; the socket sends only
 * `ping` and `presence_sub`. Output is counts and times. No token, cookie,
 * id or name is printed.
 */
import { Effect, Layer, Stream } from 'effect'
import { HttpTransport, SlackClient, SlackSession, SlackSocket, slackConfigLayer, SocketHandshake } from '@juno/slack'
import { readCachedSession } from './live-common.ts'

if (process.env['JUNO_LIVE'] !== '1') {
  console.error('presence-sub-live: set JUNO_LIVE=1 to run against your real workspace.')
  process.exit(2)
}

const flag = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? Number(process.argv[index + 1]) : fallback
}
const people = flag('--people', 30)
const seconds = flag('--seconds', 10)
const selfOnly = process.argv.includes('--self')

const READS = new Set(['client.getWebSocketURL'])

const cached = await readCachedSession()
if (cached === undefined) {
  console.error('presence-sub-live: no cached session. Run `JUNO_LIVE=1 bun run smoke:live --cache-session` first.')
  process.exit(2)
}
const { session, cookie } = cached

/** A public read straight over fetch: the client schema has no entry for these. */
async function read<A>(method: 'conversations.list' | 'users.getPresence', args: Record<string, string>): Promise<({ ok: true } & A) | { ok: false; error?: string }> {
  const body = new URLSearchParams({ token: session.token, ...args })
  const response = await fetch(new URL(`/api/${method}`, session.workspaceUrl), { method: 'POST', body, headers: { cookie } })
  return (await response.json()) as ({ ok: true } & A) | { ok: false; error?: string }
}

const listed = selfOnly ? { ok: true as const, channels: [] } : await read<{ channels: ReadonlyArray<{ user?: string; is_user_deleted?: boolean }> }>('conversations.list', { types: 'im', limit: '200', exclude_archived: 'true' })
if (!listed.ok) {
  console.error(`presence-sub-live: conversations.list failed: ${listed.error ?? 'unknown'}`)
  process.exit(1)
}
const ids = selfOnly ? [session.userId] : listed.channels
  .filter((channel) => channel.user !== undefined && channel.user !== session.userId && channel.user !== 'USLACKBOT' && channel.is_user_deleted !== true)
  .map((channel) => channel.user as string)
  .slice(0, people)
console.log(selfOnly ? 'presence-sub-live: your own id only' : `presence-sub-live: ${ids.length} DM partners`)

const guard = Layer.effect(
  HttpTransport,
  Effect.map(HttpTransport, (inner) =>
    HttpTransport.of({
      request: (request) => {
        const method = /\/api\/([^?]+)/.exec(request.url)?.[1] ?? 'unknown'
        return READS.has(method) ? inner.request(request) : Effect.die(new Error(`presence-sub-live: refusing ${method}`))
      },
    }),
  ),
).pipe(Layer.provide(HttpTransport.nodeFetch({ headers: { cookie } })))

const layer = SlackClient.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      SlackSession.layer(session),
      guard,
      SocketHandshake.fixed({ cookie, userAgent: 'Juno presence check' }),
      slackConfigLayer({ socket: { allowedHosts: ['slack.com'] } }),
    ),
  ),
)

const program = Effect.gen(function* () {
  const socket = yield* SlackSocket
  const events = yield* socket.events
  const seen = new Map<string, 'active' | 'away'>()
  let frames = 0
  let singleUser = 0
  let firstAt: number | undefined
  const state = { connected: false }
  const batches: Array<string> = []
  yield* Effect.forkScoped(
    Stream.runForEach(events, (event) =>
      Effect.sync(() => {
        if (event._tag === 'Connected') state.connected = true
        if (event._tag !== 'Frame' || event.frame.type !== 'presence_change') return
        frames++
        firstAt ??= Date.now()
        if (event.frame.users === undefined) singleUser++
        const named = event.frame.users ?? (event.frame.user === undefined ? [] : [event.frame.user])
        batches.push(`${event.frame.presence}x${named.length}`)
        for (const id of named) seen.set(id, event.frame.presence)
      }),
    ),
  )
  while (!state.connected) yield* Effect.sleep(200)
  console.log('presence-sub-live: socket connected')

  const sentAt = Date.now()
  yield* socket.send({ type: 'presence_sub', ids })
  yield* Effect.sleep(seconds * 1000)
  const values = [...seen.values()]
  console.log(`  after presence_sub: ${frames} presence_change frames (${singleUser} with a single user), first ${firstAt === undefined ? 'never' : `${firstAt - sentAt} ms`} after sending`)
  console.log(`  batches in order: ${batches.join(' ')}`)
  if (selfOnly) console.log(`  your own id named: ${seen.get(session.userId) ?? 'no'}`)
  console.log(`  users named: ${seen.size} of ${ids.length} (${values.filter((v) => v === 'active').length} active, ${values.filter((v) => v === 'away').length} away)`)

  let agree = 0
  let active = 0
  let unread = 0
  const errors = new Map<string, number>()
  const disagreements = new Map<string, number>()
  for (const id of ids) {
    const answer = yield* Effect.promise(() => read<{ presence: string; online?: boolean; auto_away?: boolean; manual_away?: boolean; connection_count?: number }>('users.getPresence', { user: id }))
    yield* Effect.sleep(1_300)
    if (!answer.ok) {
      unread++
      errors.set(answer.error ?? 'unknown', (errors.get(answer.error ?? 'unknown') ?? 0) + 1)
      continue
    }
    if (seen.get(id) !== answer.presence) {
      const key = `socket ${seen.get(id) ?? 'none'} / http ${answer.presence} online=${String(answer.online)} auto_away=${String(answer.auto_away)} manual_away=${String(answer.manual_away)} connections=${answer.connection_count === undefined ? '?' : answer.connection_count > 0 ? '>0' : '0'}`
      disagreements.set(key, (disagreements.get(key) ?? 0) + 1)
    }
    if (answer.presence === 'active') active++
    if (seen.get(id) === answer.presence || (seen.get(id) === undefined && answer.presence === 'away')) agree++
  }
  console.log(`  users.getPresence: ${active} active, ${unread} unreadable; ${agree} of ${ids.length - unread} agree with the socket (no frame counted as away)`)

  for (const [error, count] of errors) console.log(`  unreadable: ${error} x${count}`)
  for (const [key, count] of disagreements) console.log(`  disagree: ${key} x${count}`)
  console.log(`  socket now: ${[...seen.values()].filter((v) => v === 'active').length} active (frames during the reads included)`)

  const framesBefore = frames
  yield* socket.send({ type: 'presence_sub', ids: [] })
  yield* Effect.sleep(seconds * 1000)
  console.log(`  after an empty presence_sub: ${frames - framesBefore} presence_change frames in ${seconds} s`)
})

await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(layer)))
