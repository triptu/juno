#!/usr/bin/env node
/**
 * The live sync dry run: the real `@juno/sync` cold boot against your real
 * workspace, into a temporary data directory that is deleted afterwards.
 * Run with `JUNO_LIVE=1 pnpm sync:live`. It refuses to run without
 * `JUNO_LIVE=1`.
 *
 * Read-only, by construction:
 * - `SlackApi.call` is wrapped so any method outside `READ_ONLY_METHODS`
 *   dies before a request is made; `HttpTransport` is wrapped the same way
 *   for the URL of every request (Web API and edge), so nothing can slip
 *   past the first guard.
 * - Only `runSync` is started: no outbox, no mark, no command handler.
 *
 * Output: aggregate numbers only. Calls by method and total time,
 * conversations by kind and membership, topics by kind and how many the
 * sidebar shows under the quiet rule, unread and mention counts, decode
 * issues by path, rate-limit hits, the `topics.list` query time and
 * snapshot size. Never a title, a name, a message text or an id. The
 * Effect logger is replaced by one that prints the message and a few
 * enum-like fields (`tag`, `type`, `reason`) only.
 *
 * Session: the one `smoke-live.ts --cache-session` kept in the login
 * keychain (`juno-dev-slack-session`, see docs/development.md). No
 * keychain prompt and no import from the Slack app here.
 *
 * Flags:
 *   --fake        run against an in-process fake Slack instead (no keychain, no JUNO_LIVE)
 *   --large       with --fake, use the large seed
 *   --paced       with --fake, retain production request pacing
 *   --latency N   with --fake, every Web API and edge call waits N ms (live calls took 257 to 446 ms)
 *   --seconds N   time limit for boot and discovery (default 900)
 *   --until-quiet after `live`, keep running until no call has been made for 30 s
 *                 (the background follow pass), within the same time limit
 *   --team T      pick this cached session when several teams are cached
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Logger, Scope } from 'effect'
import { listTopics, SIDEBAR_WINDOW } from '@juno/engine'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { EdgeUsersInfoResponse, Methods, type MethodName } from '@juno/slack-schema'
import {
  HttpTransport,
  RequestQueue,
  SlackApi,
  SlackEdge,
  SlackSession,
  SlackSocket,
  slackConfigLayer,
  SocketHandshake,
  type HttpResponse,
  type SlackApiShape,
} from '@juno/slack'
import { Store, StoreWriter, workspacePathsFromDir } from '@juno/store'
import { runSync, syncConfigLayer, type SyncPhase } from '@juno/sync'
import { decodeIssues, readCachedSession, type CachedSession } from './live-common.ts'

/** Every method the sync may call. All read. `conversations.mark`, `chat.*`, `reactions.*`, `subscriptions.thread.add/remove/mark`, `files.*` are not here. */
const READ_ONLY_METHODS = [
  'auth.test',
  'client.userBoot',
  'users.prefs.get',
  'client.counts',
  'client.getWebSocketURL',
  'api.getFlannelHttpUrl',
  'subscriptions.thread.getView',
  'conversations.history',
  'conversations.replies',
  'conversations.info',
  'search.modules.messages',
] as const satisfies ReadonlyArray<MethodName>
const READ_ONLY_EDGE = ['users/info', 'emojis/list'] as const

const isReadOnly = (method: string): method is (typeof READ_ONLY_METHODS)[number] => (READ_ONLY_METHODS as ReadonlyArray<string>).includes(method)

const flag = (name: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const useFake = process.argv.includes('--fake')
const seconds = Number(flag('--seconds') ?? (useFake ? 60 : 900))
const untilQuiet = process.argv.includes('--until-quiet')
const teamId = flag('--team')

// Aggregates. Keys are method names and schema paths; values are counts and milliseconds.

interface CallStat {
  n: number
  ms: number
  failures: Map<string, number>
}
const calls = new Map<string, CallStat>()
const statuses = new Map<string, Map<number, number>>()
const decodeProblems = new Map<string, number>()
let rateLimitHits = 0

/** `performance.now()` of the last call any method made. */
let lastCallAt = 0

const stat = (method: string): CallStat => {
  lastCallAt = performance.now()
  let entry = calls.get(method)
  if (entry === undefined) {
    entry = { n: 0, ms: 0, failures: new Map() }
    calls.set(method, entry)
  }
  return entry
}
const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1)

/** Which method a request URL is for: `api:<method>`, `edge:<method>`, or undefined when it is neither. */
function classify(url: string): { kind: 'api' | 'edge'; method: string } | undefined {
  const parsed = new URL(url)
  const api = /^\/api\/([^/]+)$/.exec(parsed.pathname)
  if (api !== null) return { kind: 'api', method: api[1]! }
  const edge = /\/(users\/info|users\/search|channels\/info|channels\/search|emojis\/list)$/.exec(parsed.pathname)
  if (edge !== null) return { kind: 'edge', method: edge[1]! }
  return undefined
}

/** The transport guard: refuses any URL outside the read list, counts statuses, re-decodes answers for issue paths. */
function guardedTransport(cookie: string): Layer.Layer<HttpTransport> {
  return Layer.effect(
    HttpTransport,
    Effect.map(HttpTransport, (inner) =>
      HttpTransport.of({
        request: (request) => {
          const target = classify(request.url)
          const allowed =
            target !== undefined &&
            ((target.kind === 'api' && isReadOnly(target.method)) || (target.kind === 'edge' && (READ_ONLY_EDGE as ReadonlyArray<string>).includes(target.method)))
          if (!allowed) return Effect.die(new Error(`sync-live: refusing a request to ${target === undefined ? 'an unknown URL' : `${target.kind} ${target.method}`}; not on the read-only list`))
          const key = `${target.kind}:${target.method}`
          return Effect.tap(inner.request(request), (response: HttpResponse) =>
            Effect.sync(() => {
              let byStatus = statuses.get(key)
              if (byStatus === undefined) {
                byStatus = new Map()
                statuses.set(key, byStatus)
              }
              bump(byStatus, response.status)
              if (response.status === 429) rateLimitHits++
              if (response.status !== 200) return
              const schema = target.kind === 'api' && isReadOnly(target.method) ? Methods[target.method].response : target.kind === 'edge' ? EdgeUsersInfoResponse : undefined
              if (schema === undefined) return
              for (const issue of decodeIssues(schema as never, response.text)) bump(decodeProblems, `${key} ${issue}`)
            }),
          )
        },
      }),
    ),
  ).pipe(Layer.provide(HttpTransport.nodeFetch({ headers: { cookie } })))
}

/** The API guard: the sync can only reach read methods, and every call is counted and timed. */
const guardedApi: Layer.Layer<SlackApi, never, SlackApi> = Layer.effect(
  SlackApi,
  Effect.map(SlackApi, (inner) => {
    const call: SlackApiShape['call'] = (method, args, options) => {
      if (!isReadOnly(method)) return Effect.die(new Error(`sync-live: refusing to call ${method}; it is not on the read-only list`))
      const started = performance.now()
      return inner.call(method, args, options).pipe(
        Effect.tapCause((cause) =>
          Effect.sync(() => {
            const error = Cause.findErrorOption(cause)
            const tag = error._tag === 'Some' ? (error.value as { _tag?: string })._tag ?? 'unknown' : 'defect'
            bump(stat(method).failures, tag)
            if (tag === 'SlackRateLimited') rateLimitHits++
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            const entry = stat(method)
            entry.n++
            entry.ms += performance.now() - started
          }),
        ),
      )
    }
    // Uploading writes to Slack: the dry run never does.
    const upload: SlackApiShape['upload'] = () => Effect.die(new Error('sync-live: refusing to upload a file'))
    return SlackApi.of({ call, upload })
  }),
)

/** Prints log lines without their payloads: the message, and a few enum-like annotation values. */
const SAFE_KEYS = new Set(['tag', 'type', 'reason', 'lane', 'method', 'retryInMillis', 'status'])
const quietLogger = Logger.make<unknown, void>((options) => {
  const message = Array.isArray(options.message) ? options.message : [options.message]
  const parts: Array<string> = []
  for (const item of message) {
    if (typeof item === 'string') parts.push(item)
    else if (item !== null && typeof item === 'object') {
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        if (SAFE_KEYS.has(key) && (typeof value === 'string' || typeof value === 'number')) parts.push(`${key}=${value}`)
        else if (key === 'cause') parts.push(`cause=${causeTags(value)}`)
        else parts.push(`${key}=…`)
      }
    } else parts.push('…')
  }
  const cause = options.cause.reasons.length === 0 ? '' : ` cause=${causeTags(options.cause)}`
  console.log(`  log ${String(options.logLevel).toLowerCase()}: ${parts.join(' ')}${cause}`)
})

/** Only the `_tag`s of the errors in a cause (no messages: a message could carry a value). */
function causeTags(value: unknown): string {
  if (!Cause.isCause(value)) return '?'
  const tags = value.reasons.map((reason) => {
    if (reason._tag === 'Fail') return (reason.error as { _tag?: string })?._tag ?? 'error'
    if (reason._tag === 'Die') {
      // Our own guard messages are safe to print; anything else is named by its tag or class only.
      if (reason.defect instanceof Error && reason.defect.message.startsWith('sync-live:')) return reason.defect.message
      return `defect:${(reason.defect as { _tag?: string })?._tag ?? (reason.defect instanceof Error ? reason.defect.name : 'unknown')}`
    }
    return reason._tag
  })
  return tags.join('+') || 'empty'
}

const fmt = (n: number) => n.toLocaleString('en-US')
const ms = (n: number) => `${fmt(Math.round(n))} ms`

interface Target {
  readonly cached: CachedSession
  readonly allowedHosts: ReadonlyArray<string>
  readonly close: () => Promise<void>
}

async function main(): Promise<number> {
  if (!useFake && process.env['JUNO_LIVE'] !== '1') {
    console.error('sync-live: refusing to touch a real workspace without JUNO_LIVE=1 (or pass --fake)')
    return 2
  }
  const target = useFake ? await fakeTarget() : await liveTarget()
  if (target === undefined) return 2
  console.log(`sync-live: read-only cold boot against ${useFake ? 'an in-process fake' : 'the real workspace'}. Methods allowed:`)
  console.log(`  ${READ_ONLY_METHODS.join(', ')}; edge ${READ_ONLY_EDGE.join(', ')}`)
  console.log(`  time limit ${seconds} s; the data directory is temporary and deleted at the end`)

  const dir = await mkdtemp(join(tmpdir(), 'juno-sync-live-'))
  try {
    return await run(target, join(dir, 'workspace'))
  } finally {
    await target.close()
    await rm(dir, { recursive: true, force: true })
    console.log('sync-live: temporary data directory deleted')
  }
}

async function liveTarget(): Promise<Target | undefined> {
  const cached = await readCachedSession(teamId)
  if (cached === undefined) {
    console.error('sync-live: no cached session. Run `JUNO_LIVE=1 pnpm smoke:live -- --cache-session` first (docs/development.md).')
    return undefined
  }
  return { cached, allowedHosts: ['slack.com'], close: async () => {} }
}

async function fakeTarget(): Promise<Target> {
  const latencyMillis = Number(flag('--latency') ?? 0)
  const fake = await startFakeSlack({ ...(process.argv.includes('--large') ? { seed: largeSeed() } : {}), latencyMillis })
  const c = fake.credentials()
  return {
    cached: { session: { teamId: c.teamId, userId: c.userId, workspaceUrl: c.url, token: c.token }, cookie: `d=${c.cookie}` },
    allowedHosts: ['127.0.0.1', 'localhost'],
    close: () => fake.close(),
  }
}

async function run(target: Target, workspaceDir: string): Promise<number> {
  const { cached } = target
  const startedAt = performance.now()
  const elapsed = () => ms(performance.now() - startedAt)
  const client = SlackSocket.layer.pipe(
    Layer.provideMerge(SlackEdge.layer),
    Layer.provideMerge(guardedApi.pipe(Layer.provide(SlackApi.layer))),
    Layer.provideMerge(RequestQueue.layer),
    // provideMerge: the sync needs SlackSession too.
    Layer.provideMerge(
      Layer.mergeAll(
        SlackSession.layer(cached.session),
        guardedTransport(cached.cookie),
        SocketHandshake.fixed({ cookie: cached.cookie, userAgent: 'Juno sync dry run' }),
        slackConfigLayer({
          socket: { allowedHosts: [...target.allowedHosts], onDiagnostic: (line) => console.log(`  socket: ${line}`) },
          // The fake normally skips pacing; --paced retains the production method budgets.
          ...(useFake && !process.argv.includes('--paced') ? { lanes: { backgroundMinIntervalMillis: 0 } } : {}),
        }),
      ),
    ),
  )
  const store = Store.layer(workspacePathsFromDir(workspaceDir))
  const layer = Layer.mergeAll(client, store, syncConfigLayer(), Logger.layer([quietLogger]))

  const program = Effect.gen(function* () {
    const booted = yield* Deferred.make<'live' | 'timeout'>()
    const phases: Array<string> = []
    let lastReported = ''
    const onPhase = (phase: SyncPhase) =>
      Effect.sync(() => {
        const line = phase._tag === 'catching-up' ? `catching-up ${phase.done}/${phase.total}` : phase._tag
        if (phase._tag !== 'catching-up' || phase.done === 0 || phase.done === phase.total || phase.done % 10 === 0) {
          if (line !== lastReported) console.log(`  ${elapsed()}: ${line}`)
          lastReported = line
        }
        phases.push(phase._tag)
        if (phase._tag === 'live') Deferred.doneUnsafe(booted, Effect.succeed('live' as const))
      })

    // The sidebar as the renderer sees it, sampled every 100 ms: when rows first exist, and when it would show them (`windowCovered`).
    const sidebar: { rows?: number; shown?: number; main?: number } = {}
    const watcher = yield* Effect.forkChild(
      Effect.gen(function* () {
        while (true) {
          const window = yield* listTopics({ kind: 'all', unreadOnly: false }, { now: Date.now(), limit: SIDEBAR_WINDOW })
          const at = performance.now() - startedAt
          if (window.rows.length > 0 && sidebar.rows === undefined) {
            sidebar.rows = at
            console.log(`  ${ms(at)}: first sidebar rows (${window.rows.length})`)
          }
          if (window.rows.length > 0 && window.windowCovered !== false && sidebar.shown === undefined) {
            sidebar.shown = at
            console.log(`  ${ms(at)}: sidebar usable, rows shown (${window.rows.length})`)
          }
          if (window.rows.some((row) => row.kind === 'main') && sidebar.main === undefined) {
            sidebar.main = at
            console.log(`  ${ms(at)}: first channel or DM row`)
          }
          yield* Effect.sleep(100)
        }
      }).pipe(Effect.catchCause(() => Effect.void)),
    )
    const scope = yield* Scope.make()
    const sync = yield* Effect.forkChild(
      runSync({ onPhase }).pipe(
        Scope.provide(scope),
        Effect.catchCause((cause) => Effect.sync(() => console.log(`  sync ended: ${causeTags(cause)}`))),
      ),
    )
    const outcome = yield* Deferred.await(booted).pipe(Effect.timeoutOption(seconds * 1000))
    const bootTime = performance.now() - startedAt
    console.log(outcome._tag === 'Some' ? `sync-live: boot and discovery finished in ${ms(bootTime)}` : `sync-live: time limit reached after ${ms(bootTime)}; reporting what is there`)
    if (untilQuiet && outcome._tag === 'Some') {
      const deadline = startedAt + seconds * 1000
      while (performance.now() < deadline && performance.now() - lastCallAt < 30_000) yield* Effect.sleep(1_000)
      console.log(`sync-live: ${performance.now() - lastCallAt >= 30_000 ? 'quiet' : 'time limit reached'} after ${ms(performance.now() - startedAt)}; the last call ended at ${ms(lastCallAt - startedAt)}`)
    }
    // A little time for root fetches and users already in flight, then stop everything before reading the store.
    yield* Effect.sleep(2_000)
    yield* Fiber.interrupt(watcher)
    yield* Scope.close(scope, Exit.void)
    yield* Fiber.interrupt(sync)
    yield* report(bootTime, phases)
    if (outcome._tag === 'None') return yield* Effect.fail(new Error('sync did not reach live before the time limit'))
  })

  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(layer), Effect.scoped))
  if (Exit.isFailure(exit)) {
    console.log(`sync-live: failed: ${causeTags(exit.cause)}`)
    return 1
  }
  return 0
}

const count = (rows: ReadonlyArray<{ n: number | null }>) => Number(rows[0]?.n ?? 0)

const report = (bootMillis: number, phases: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter

    console.log('')
    console.log('calls by method (n, total ms, failures by tag)')
    let total = 0
    for (const [method, entry] of [...calls].toSorted((a, b) => b[1].n - a[1].n)) {
      total += entry.n
      const failures = [...entry.failures].map(([tag, n]) => `${tag} x${n}`).join(', ')
      console.log(`  ${method}: ${entry.n}, ${ms(entry.ms)}${failures === '' ? '' : `, failed: ${failures}`}`)
    }
    for (const [key, byStatus] of statuses) {
      if (key.startsWith('edge:')) console.log(`  ${key}: ${[...byStatus].map(([status, n]) => `${n} x HTTP ${status}`).join(', ')}`)
    }
    const nonOk = [...statuses].flatMap(([key, byStatus]) => [...byStatus].filter(([status]) => status !== 200).map(([status, n]) => `${key} HTTP ${status} x${n}`))
    console.log(`  total: ${total} Web API calls, ${ms(bootMillis)} to boot${nonOk.length === 0 ? '' : `; non-200: ${nonOk.join(', ')}`}`)
    console.log(`  rate-limit hits: ${rateLimitHits}`)
    console.log(`  phases seen: ${[...new Set(phases)].join(' > ')}`)

    console.log('')
    console.log('conversations by kind (rows, members, archived)')
    const kinds = yield* sql<{ kind: string; n: number; members: number | null; archived: number | null }>`
      SELECT kind, count(*) AS n, sum(is_member) AS members, sum(is_archived) AS archived FROM conversations GROUP BY kind ORDER BY kind`
    for (const row of kinds) console.log(`  ${row.kind}: ${row.n}, ${row.members ?? 0} member, ${row.archived ?? 0} archived`)
    const reads = yield* sql<{ n: number; unread: number | null; mentions: number | null }>`SELECT count(*) AS n, sum(has_unreads) AS unread, sum(mention_count) AS mentions FROM channel_reads`
    console.log(`  channel_reads: ${count(reads)} rows, ${reads[0]?.unread ?? 0} with unreads, ${reads[0]?.mentions ?? 0} mentions (from client.counts)`)
    console.log(`  users: ${count(yield* sql<{ n: number }>`SELECT count(*) AS n FROM users`)}`)
    console.log(`  thread_subs followed: ${count(yield* sql<{ n: number }>`SELECT count(*) AS n FROM thread_subs WHERE subscribed = 1`)}`)

    console.log('')
    console.log('messages')
    const messages = yield* sql<{ n: number; channels: number; replies: number | null; roots: number | null; deleted: number | null }>`
      SELECT count(*) AS n, count(DISTINCT channel) AS channels,
        sum(CASE WHEN thread_ts IS NOT NULL AND thread_ts <> ts THEN 1 ELSE 0 END) AS replies,
        sum(CASE WHEN reply_count > 0 THEN 1 ELSE 0 END) AS roots,
        sum(deleted) AS deleted FROM messages`
    const m = messages[0]
    console.log(`  ${m?.n ?? 0} stored in ${m?.channels ?? 0} conversations: ${m?.roots ?? 0} thread roots, ${m?.replies ?? 0} replies, ${m?.deleted ?? 0} tombstones`)
    console.log(`  synced_ranges: ${count(yield* sql<{ n: number }>`SELECT count(*) AS n FROM synced_ranges`)}`)
    console.log(`  reactions: ${count(yield* sql<{ n: number }>`SELECT count(*) AS n FROM reactions`)}`)

    console.log('')
    console.log('topics (topic_index)')
    const topics = yield* sql<{ kind: string; n: number; unread: number | null; inexact: number | null; mentions: number | null }>`
      SELECT kind, count(*) AS n, sum(CASE WHEN unread_count > 0 THEN 1 ELSE 0 END) AS unread,
        sum(CASE WHEN unread_count > 0 AND unread_exact = 0 THEN 1 ELSE 0 END) AS inexact,
        sum(mentions_me) AS mentions FROM topic_index GROUP BY kind ORDER BY kind`
    for (const row of topics) console.log(`  ${row.kind}: ${row.n}, ${row.unread ?? 0} unread (${row.inexact ?? 0} shown as a dot), ${row.mentions ?? 0} mentioning me`)
    const members = yield* sql<{ kind: string; n: number }>`
      SELECT i.kind, count(*) AS n FROM topic_index i JOIN conversations c ON c.id = i.channel WHERE c.is_member = 1 GROUP BY i.kind ORDER BY i.kind`
    console.log(`  in member conversations: ${members.map((row) => `${row.kind} ${row.n}`).join(', ') || 'none'}`)
    const unreadTotal = yield* sql<{ n: number | null }>`SELECT sum(unread_count) AS n FROM topic_index`
    console.log(`  unread messages across topics: ${count(unreadTotal)}`)

    console.log('')
    console.log('sidebar (topics.list, kind all, 7-day quiet rule)')
    const now = Date.now()
    const everything = yield* listTopics({ kind: 'all', unreadOnly: false }, { now, limit: 1_000_000 })
    const byKind = new Map<string, number>()
    for (const row of everything.rows) bump(byKind, row.kind)
    console.log(`  shown: ${everything.rows.length} (${[...byKind].map(([kind, n]) => `${kind} ${n}`).join(', ') || 'none'}), ${everything.rows.filter((r) => r.unreadCount > 0).length} unread, ${everything.rows.filter((r) => r.mentionsMe).length} mentioning me`)
    const unreadOnly = yield* listTopics({ kind: 'all', unreadOnly: true }, { now, limit: 1_000_000 })
    console.log(`  unread filter: ${unreadOnly.rows.length}`)
    const timings: Array<number> = []
    let snapshot = 0
    for (let i = 0; i < 5; i++) {
      const started = performance.now()
      const window = yield* listTopics({ kind: 'all', unreadOnly: false }, { now, limit: SIDEBAR_WINDOW })
      timings.push(performance.now() - started)
      snapshot = JSON.stringify({ rows: window.rows, refs: window.refs }).length
    }
    timings.sort((a, b) => a - b)
    console.log(`  query time (window ${SIDEBAR_WINDOW}): ${ms(timings[0]!)} best, ${ms(timings[Math.floor(timings.length / 2)]!)} median of 5`)
    console.log(`  snapshot: ${fmt(Math.min(everything.rows.length, SIDEBAR_WINDOW))} rows, ${fmt(snapshot)} bytes of JSON`)

    console.log('')
    console.log('decode issues by path')
    if (decodeProblems.size === 0) console.log('  none')
    for (const [path, n] of [...decodeProblems].toSorted((a, b) => b[1] - a[1])) console.log(`  ${path} x${n}`)
  })

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`sync-live: ${error instanceof Error ? error.name : 'error'}`)
    process.exit(1)
  },
)
