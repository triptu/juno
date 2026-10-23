#!/usr/bin/env bun
/**
 * The live presence check (research section 3, Presence): how Slack shows
 * the owner while only Juno's socket is connected, with and without
 * `tickle`. Run with `JUNO_LIVE=1 bun run presence:live`. It refuses to run
 * without `JUNO_LIVE=1`, and reuses the session `smoke-live.ts
 * --cache-session` kept.
 *
 * Phases, each polling `users.getPresence` for the self user every 30 s:
 * 1. No Juno socket (`--baseline-seconds`, default 60).
 * 2. Juno's socket open, no `tickle` (`--quiet-seconds`, default 180).
 * 3. `tickle` through `SlackSocket.tickle`, tried every 10 s as main's idle
 *    poll does, so it goes out every 19 s (`--tickle-seconds`, default 120).
 * 4. Tickles stop, the socket stays open, until Slack sets `auto_away`
 *    (or shows away without a manual away) or `--idle-seconds` (default
 *    2400) pass.
 *
 * Writes nothing to Slack: the HTTP calls are `auth.test`,
 * `client.getWebSocketURL` and `users.getPresence`; the socket sends only
 * `ping` and `tickle`. Output is presence values, `connection_count` and
 * seconds since the phase began. No token, cookie, id or name is printed.
 * Other clients (the Slack app on the Mac or a phone) count as connections
 * and keep the owner active; the script says so when it sees them.
 */
import { Effect, Layer, Stream } from 'effect'
import { HttpTransport, SlackClient, SlackSession, SlackSocket, slackConfigLayer, SocketHandshake } from '@juno/slack'
import { readCachedSession } from './live-common.ts'

if (process.env['JUNO_LIVE'] !== '1') {
  console.error('presence-live: set JUNO_LIVE=1 to run against your real workspace.')
  process.exit(2)
}

const flag = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? Number(process.argv[index + 1]) : fallback
}
const baselineSeconds = flag('--baseline-seconds', 60)
const quietSeconds = flag('--quiet-seconds', 180)
const tickleSeconds = flag('--tickle-seconds', 120)
const idleSeconds = flag('--idle-seconds', 2400)

const READS = new Set(['auth.test', 'client.getWebSocketURL', 'users.getPresence'])

const cached = await readCachedSession()
if (cached === undefined) {
  console.error('presence-live: no cached session. Run `JUNO_LIVE=1 bun run smoke:live --cache-session` first.')
  process.exit(2)
}
const { session, cookie } = cached

interface Presence {
  readonly presence: string
  readonly online?: boolean
  readonly auto_away?: boolean
  readonly manual_away?: boolean
  readonly connection_count?: number
  readonly last_activity?: number
}

/** `users.getPresence` for the self user, straight over fetch: the client schema has no entry for it. */
async function readPresence(): Promise<Presence | string> {
  const body = new URLSearchParams({ token: session.token, user: session.userId })
  const response = await fetch(new URL('/api/users.getPresence', session.workspaceUrl), { method: 'POST', body, headers: { cookie } })
  const json = (await response.json()) as { ok: boolean; error?: string } & Presence
  return json.ok ? json : `error ${json.error ?? response.status}`
}

const lastActivityAge = (p: Presence) => (p.last_activity === undefined ? '' : ` last_activity ${Math.round(Date.now() / 1000 - p.last_activity)} s ago`)
const describe = (p: Presence | string) =>
  typeof p === 'string'
    ? p
    : `${p.presence} online=${String(p.online)} auto_away=${String(p.auto_away)} manual_away=${String(p.manual_away)} connections=${String(p.connection_count)}${lastActivityAge(p)}`

/** Polls every 30 s until `seconds` pass or `stop` says so. Returns the seconds when `stop` was met. */
const poll = (name: string, seconds: number, stop?: (p: Presence) => boolean, during?: Effect.Effect<unknown>) =>
  Effect.gen(function* () {
    console.log(`presence-live: phase ${name}, up to ${seconds} s`)
    const started = Date.now()
    let nextPoll = 0
    while (Date.now() - started < seconds * 1000) {
      const elapsed = Math.round((Date.now() - started) / 1000)
      if (during !== undefined) yield* during
      if (elapsed >= nextPoll) {
        nextPoll = elapsed + 30
        const p = yield* Effect.promise(readPresence)
        console.log(`  +${elapsed} s: ${describe(p)}`)
        if (typeof p !== 'string' && (p.connection_count ?? 0) > (name === 'baseline' ? 0 : 1)) {
          console.log('  note: another client is connected, so this run cannot show what Juno alone does')
        }
        if (typeof p !== 'string' && stop?.(p) === true) return elapsed
      }
      yield* Effect.sleep(10_000)
    }
    return undefined
  })

const guard = Layer.effect(
  HttpTransport,
  Effect.map(HttpTransport, (inner) =>
    HttpTransport.of({
      request: (request) => {
        const method = /\/api\/([^?]+)/.exec(request.url)?.[1] ?? 'unknown'
        return READS.has(method) ? inner.request(request) : Effect.die(new Error(`presence-live: refusing ${method}`))
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
      slackConfigLayer({ socket: { allowedHosts: ['slack.com'], onDiagnostic: (line) => console.log(`  socket: ${line}`) } }),
    ),
  ),
)

const program = Effect.gen(function* () {
  yield* poll('baseline (no Juno socket)', baselineSeconds)
  const socket = yield* SlackSocket
  const events = yield* socket.events
  yield* Effect.forkScoped(
    Stream.runForEach(events, (event) =>
      Effect.sync(() => {
        if (event._tag === 'Connected') console.log('  socket connected')
        else if (event._tag === 'Disconnected') console.log(`  socket disconnected: ${event.reason}`)
        else if (event.frame.type === 'presence_change' || event.frame.type === 'manual_presence_change') console.log(`  frame ${event.frame.type}`)
      }),
    ),
  )
  yield* poll('socket open, no tickle', quietSeconds)
  let tickles = 0
  const tickle = Effect.map(socket.tickle('polling'), (sent) => {
    if (sent) tickles++
  })
  yield* poll('tickle every 19 s', tickleSeconds, undefined, tickle)
  console.log(`  ${tickles} tickles sent`)
  // `auto_away` is Slack's idle verdict; it is set apart from a manual away, so it can be timed either way.
  const awayAfter = yield* poll('tickles stopped', idleSeconds, (p) => p.auto_away === true || (p.presence === 'away' && p.manual_away !== true))
  console.log(
    awayAfter === undefined
      ? `presence-live: no auto_away within ${idleSeconds} s after the last tickle`
      : `presence-live: away about ${awayAfter} s after the last tickle (polled every 30 s)`,
  )
})

await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(layer)))
