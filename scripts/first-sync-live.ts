#!/usr/bin/env node
/**
 * The first sync timeline: the whole engine, signed in from an empty data
 * folder, against your real workspace (read-only) or an in-process fake.
 * Run with `JUNO_LIVE=1 pnpm sync:timeline`, or `pnpm sync:timeline -- --fake`.
 *
 * It records, from the moment the engine starts:
 * - every Slack request: method, `_x_reason`, start and end, HTTP status,
 *   retry number, and the `Retry-After` of a 429;
 * - when the sidebar first has rows, when Home is ready and has rows, when
 *   every active conversation has a row, when the unread counts stop
 *   changing, when history is read for every active conversation, and the
 *   engine's phases;
 * - process CPU time, and the time spent inside SQLite statements, by kind.
 *
 * Read-only: every request goes through one fetch that refuses any method
 * outside the read list before it leaves. No outbox write can reach Slack.
 * AI has no key here, so no title or art call is made; the timeline notes
 * when those jobs become due instead.
 *
 * Output: method names, counts and milliseconds only, printed and written
 * as JSON to `--out` (default: none). Never a token, a name, an id or a
 * message text. The data folder is deleted at the end.
 *
 * Flags:
 *   --fake        an in-process fake Slack (large seed) instead of the cached session
 *   --latency N   with --fake, every call waits N ms (default 300)
 *   --small       with --fake, a small workspace (16 conversations) instead of the large seed
 *   --seconds N   stop after N seconds (default 900)
 *   --quiet N     after the engine is live and not syncing, stop once no call has been made for N s (default 30)
 *   --out FILE    write the timeline as JSON
 *   --team T      pick this cached session when several teams are cached
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync, StatementSync } from 'node:sqlite'
import { MessageChannel } from 'node:worker_threads'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { HttpTransport } from '@juno/slack'
import { configureConnection, engineStatusAtom, homeViewAtom, makeRegistry, sessionStatusAtom, topicListAtom, type PortLike } from '@juno/state'
import { memoryHost, startEngine } from '../packages/engine/src/index.ts'
import { memoryTransport, type MessagePortLike } from '../packages/engine/src/protocol/transport.ts'
import { readCachedSession, type CachedSession } from './live-common.ts'

const flag = (name: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const useFake = process.argv.includes('--fake')
const seconds = Number(flag('--seconds') ?? 900)
const quietSeconds = Number(flag('--quiet') ?? 30)
const out = flag('--out')

if (!useFake && process.env.JUNO_LIVE !== '1') {
  console.error('first-sync-live: set JUNO_LIVE=1 to run against your real workspace, or pass --fake.')
  process.exit(2)
}

const READS = new Set([
  'auth.test',
  'client.userBoot',
  'client.counts',
  'client.getWebSocketURL',
  'api.getFlannelHttpUrl',
  'users.prefs.get',
  'subscriptions.thread.getView',
  'conversations.history',
  'conversations.replies',
  'conversations.info',
  'search.modules.messages',
  'files.info',
  'dnd.info',
  'users.info',
  'users.list',
  'emoji.list',
  'usergroups.list',
  'users.getPresence',
  'team.info',
  'bots.info',
])
const EDGE = /\/(users\/info|users\/list|users\/search|channels\/info|channels\/search|emojis\/list|usergroups\/list)$/

let fake: Awaited<ReturnType<typeof startFakeSlack>> | undefined
let cached: CachedSession | undefined
if (useFake) {
  const small = { topics: 300, messages: 3_000, users: 60, days: 7, channels: { public: 10, private: 2, dms: 3, mpims: 1 } }
  fake = await startFakeSlack({ seed: largeSeed(process.argv.includes('--small') ? small : {}), latencyMillis: Number(flag('--latency') ?? 300) })
  const c = fake.credentials()
  cached = { session: { teamId: c.teamId, userId: c.userId, workspaceUrl: c.url, token: c.token }, cookie: `d=${c.cookie}` }
} else {
  cached = await readCachedSession(flag('--team'))
}
if (cached === undefined) {
  console.error('first-sync-live: no cached session. Run `JUNO_LIVE=1 pnpm smoke:live -- --cache-session` first.')
  process.exit(2)
}
const { session, cookie } = cached

const t0 = performance.now()
const now = () => Math.round(performance.now() - t0)

// SQLite time. node:sqlite is synchronous, so a statement's time is wall time on the engine's thread.
// The script's own polling sets `polling` and is left out.
let polling = false
const sqlTime = new Map<string, { n: number; ms: number }>()
const kindOf = (sql: string) => {
  const head = sql.trimStart().slice(0, 12).toUpperCase()
  if (head.startsWith('SELECT') || head.startsWith('WITH')) return 'select'
  if (head.startsWith('INSERT') || head.startsWith('REPLACE')) return 'insert'
  if (head.startsWith('UPDATE')) return 'update'
  if (head.startsWith('DELETE')) return 'delete'
  return 'other'
}
for (const name of ['all', 'get', 'run', 'iterate'] as const) {
  const original = StatementSync.prototype[name] as (...args: Array<unknown>) => unknown
  ;(StatementSync.prototype as unknown as Record<string, unknown>)[name] = function (this: StatementSync, ...args: Array<unknown>) {
    if (polling) return original.apply(this, args)
    const started = performance.now()
    try {
      return original.apply(this, args)
    } finally {
      const key = kindOf(this.sourceSQL)
      const entry = sqlTime.get(key) ?? { n: 0, ms: 0 }
      entry.n++
      entry.ms += performance.now() - started
      sqlTime.set(key, entry)
    }
  }
}

interface Call {
  /** Method name, `edge:<path>` for edge calls. */
  readonly m: string
  readonly reason?: string
  readonly s: number
  e?: number
  status?: number
  retry?: number
  retryAfter?: number
  /** A rate-limit `error` code in an ok:false answer. Codes only. */
  limited?: string
  /** History calls only: which conversation, kept in memory to classify it at the end, never printed or written. */
  channel?: string
  /** History calls only: `dm-unread`, `dm-read`, `mention`, `unread` or `other`, from the store at the end. */
  cls?: string
}
const calls: Array<Call> = []
const refused = new Map<string, number>()

const guarded = async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const api = /^\/api\/([^/]+)$/.exec(url.pathname)?.[1]
  const edge = EDGE.exec(url.pathname)?.[1]
  const allowed = api === undefined ? edge !== undefined : READS.has(api)
  if (!allowed) {
    const key = api ?? 'other url'
    refused.set(key, (refused.get(key) ?? 0) + 1)
    throw new TypeError('first-sync-live: refused')
  }
  const body = init?.body
  const reason = body instanceof FormData ? body.get('_x_reason') : null
  const retry = url.searchParams.get('_x_num_retries')
  const call: Call = {
    m: api ?? `edge:${edge}`,
    ...(typeof reason === 'string' ? { reason } : {}),
    s: now(),
    ...(retry === null ? {} : { retry: Number(retry) }),
  }
  const channel = body instanceof FormData ? body.get('channel') : null
  if (api === 'conversations.history' && reason === 'history' && typeof channel === 'string') call.channel = channel
  calls.push(call)
  const headers = { ...(init?.headers as Record<string, string>), cookie }
  try {
    const response = await fetch(input, { ...init, headers })
    call.status = response.status
    if (response.status === 429) call.retryAfter = Number(response.headers.get('retry-after') ?? -1)
    if (response.status === 200 && api !== undefined) {
      const text = await response.clone().text()
      const code = /"error"\s*:\s*"(rate_?limit[a-z_]*|ratelimit[a-z_]*)"/.exec(text)?.[1]
      if (code !== undefined) call.limited = code
    }
    return response
  } finally {
    call.e = now()
  }
}

const host = memoryHost()
host.onEngine((message) => {
  if (message._tag === 'requestSecrets') host.deliver({ _tag: 'secrets', secrets: { teamId: session.teamId, userId: session.userId, workspaceUrl: session.workspaceUrl, token: session.token, teamName: 'Timeline' } })
  else if (message._tag === 'handshake') host.deliver({ _tag: 'handshake', id: message.id, cookie, origin: 'https://app.slack.com', userAgent: 'Juno first sync timeline', proxy: 'DIRECT' })
})

const root = useFake ? tmpdir() : existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork/tmp' : tmpdir()
const userData = join(root, `juno-first-sync-${process.pid}-${Date.now()}`)
await mkdir(userData, { recursive: true })

const cpuStart = process.cpuUsage()
const eluStart = performance.eventLoopUtilization()
const transport = memoryTransport()
const handle = await startEngine(transport, { userData, e2e: false, dev: false }, { host, httpTransport: HttpTransport.nodeFetch({ fetch: guarded }) })
const registry = makeRegistry()
configureConnection(registry, {
  acquire: async () => {
    const channel = new MessageChannel()
    transport.add(channel.port2 as unknown as MessagePortLike)
    return channel.port1 as unknown as PortLike
  },
})
const sidebar = topicListAtom()
const unmounts = [registry.mount(sessionStatusAtom), registry.mount(engineStatusAtom), registry.mount(sidebar), registry.mount(homeViewAtom)]

let db: DatabaseSync | undefined
const query = <A>(sql: string): Array<A> => {
  if (db === undefined) {
    const dir = join(userData, 'workspaces')
    const dirs = existsSync(dir) ? readdirSync(dir) : []
    if (dirs.length !== 1 || !existsSync(join(dir, dirs[0]!, 'cache.db'))) return []
    db = new DatabaseSync(join(dir, dirs[0]!, 'cache.db'), { readOnly: true })
  }
  polling = true
  try {
    return db.prepare(sql).all() as Array<A>
  } catch {
    return []
  } finally {
    polling = false
  }
}

interface Sample {
  readonly t: number
  readonly phase: string
  readonly syncing: boolean
  readonly sidebarRows: number
  readonly sidebarUnread: number
  readonly homeReady: boolean
  readonly homeItems: number
  readonly mainRows: number
  readonly threadRows: number
  readonly unreadTopics: number
  readonly unreadDots: number
  /** Dots among unread DMs and group DMs and conversations that mention you: the counts a user needs first. */
  readonly priorityDots: number
  /** A hash of every unread topic's id and count: when it stops changing, the counts are settled. */
  readonly unreadHash: number
  readonly historyChannels: number
  readonly messages: number
  readonly bootDone: boolean
  readonly quickStart: boolean
}
const hash = (text: string) => {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0
  return h
}
const samples: Array<Sample> = []
const sample = (): Sample => {
  const status = registry.get(engineStatusAtom)
  const phase = status._tag === 'Success' ? status.value.phase._tag : 'none'
  const syncing = status._tag === 'Success' ? status.value.syncing : false
  const list = registry.get(sidebar)
  const rows = list._tag === 'Success' ? [...list.value.rows.values()] : []
  const home = registry.get(homeViewAtom)
  const n = (sql: string) => Number(query<{ n: number }>(sql)[0]?.n ?? 0)
  const unread = query<{ topic_id: string; unread_count: number; unread_exact: number }>(
    'SELECT topic_id, unread_count, unread_exact FROM topic_index WHERE unread_count > 0 ORDER BY topic_id',
  )
  const state = new Set(query<{ key: string }>('SELECT key FROM sync_state').map((row) => row.key))
  return {
    t: now(),
    phase,
    syncing,
    sidebarRows: list._tag === 'Success' ? list.value.order.length : 0,
    sidebarUnread: rows.filter((row) => row.unreadCount > 0).length,
    homeReady: home._tag === 'Success' && home.value.ready,
    homeItems: home._tag === 'Success' ? home.value.items.length : 0,
    mainRows: n(`SELECT count(*) AS n FROM topic_index i JOIN conversations c ON c.id = i.channel WHERE i.kind = 'main' AND c.is_member = 1`),
    threadRows: n(`SELECT count(*) AS n FROM topic_index WHERE kind = 'thread'`),
    unreadTopics: unread.length,
    unreadDots: unread.filter((row) => row.unread_exact === 0).length,
    priorityDots: n(`SELECT count(*) AS n FROM topic_index i JOIN conversations c ON c.id = i.channel LEFT JOIN channel_reads r ON r.channel = i.channel
      WHERE i.kind = 'main' AND c.is_member = 1 AND i.unread_count > 0 AND i.unread_exact = 0
        AND (c.kind IN ('im', 'mpim') OR i.mentions_me = 1 OR r.mention_count > 0)`),
    unreadHash: hash(unread.map((row) => `${row.topic_id}:${row.unread_count}:${row.unread_exact}`).join(',')),
    historyChannels: n('SELECT count(DISTINCT channel) AS n FROM synced_ranges'),
    messages: n('SELECT count(*) AS n FROM messages'),
    bootDone: state.has('boot'),
    quickStart: state.has('quickStart'),
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const deadline = seconds * 1000
let liveSince: number | undefined
while (now() < deadline) {
  await sleep(250)
  const s = sample()
  samples.push(s)
  const last = calls.at(-1)
  if (s.phase === 'session-expired' || s.phase === 'first-run') {
    if (s.t > 30_000) break
  }
  if (s.phase === 'live' && !s.syncing) liveSince ??= s.t
  else liveSince = undefined
  if (liveSince !== undefined && calls.every((c) => c.e !== undefined) && s.t - (last?.e ?? 0) > quietSeconds * 1000) break
}
const cpu = process.cpuUsage(cpuStart)
const elu = performance.eventLoopUtilization(eluStart)
const ended = now()

// Each history call's class, from the store before it goes: what kind of conversation, and what `client.counts` said.
// Without the thread counts, which the store does not keep by channel, so a channel with only unread followed threads
// is `other`.
const facts = new Map(
  query<{ id: string; kind: string; has_unreads: number | null; mention_count: number | null }>(
    `SELECT c.id, c.kind, r.has_unreads, r.mention_count
     FROM conversations c LEFT JOIN channel_reads r ON r.channel = c.id WHERE c.is_member = 1`,
  ).map((row) => [row.id, row]),
)
for (const c of calls) {
  if (c.channel === undefined) continue
  const f = facts.get(c.channel)
  const direct = f?.kind === 'im' || f?.kind === 'mpim'
  const unread = f?.has_unreads === 1
  const mention = unread && (f?.mention_count ?? 0) > 0
  c.cls = direct ? (unread ? 'dm-unread' : 'dm-read') : mention ? 'mention' : unread ? 'unread' : 'other'
  delete c.channel
}
for (const unmount of unmounts) unmount()
db?.close()
await handle.stop()
await fake?.close()
await rm(userData, { recursive: true, force: true })

// The timeline.
const first = (test: (s: Sample) => boolean) => samples.find(test)?.t
const final = samples.at(-1)!
/** The first sample from which `value` stays at its final value. */
const settled = <A>(value: (s: Sample) => A) => {
  const target = value(final)
  let at: number | undefined
  for (const s of samples) {
    if (value(s) === target) at ??= s.t
    else at = undefined
  }
  return at
}
const phaseChanges: Array<{ t: number; phase: string; syncing: boolean }> = []
for (const s of samples) {
  const prev = phaseChanges.at(-1)
  if (prev === undefined || prev.phase !== s.phase || prev.syncing !== s.syncing) phaseChanges.push({ t: s.t, phase: s.phase, syncing: s.syncing })
}

interface MethodStat { n: number; ms: number; first: number; last: number; retries: number; limited: number; retryAfter: Array<number>; reasons: Record<string, number> }
const byMethod = new Map<string, MethodStat>()
for (const c of calls) {
  const m = byMethod.get(c.m) ?? { n: 0, ms: 0, first: c.s, last: 0, retries: 0, limited: 0, retryAfter: [], reasons: {} }
  m.n++
  m.ms += (c.e ?? ended) - c.s
  m.last = Math.max(m.last, c.e ?? ended)
  if (c.retry !== undefined) m.retries++
  if (c.status === 429 || c.limited !== undefined) m.limited++
  if (c.retryAfter !== undefined) m.retryAfter.push(c.retryAfter)
  const reason = c.reason ?? '-'
  m.reasons[reason] = (m.reasons[reason] ?? 0) + 1
  byMethod.set(c.m, m)
}
const lastOf = (test: (c: Call) => boolean) => calls.filter(test).reduce((at, c) => Math.max(at, c.e ?? 0), 0) || undefined

const milestones = {
  quickStartStored: first((s) => s.quickStart),
  firstSidebarRows: first((s) => s.sidebarRows > 0),
  homeReady: first((s) => s.homeReady),
  firstHomeRows: first((s) => s.homeReady && s.homeItems > 0),
  allConversationsListed: settled((s) => s.mainRows),
  unreadCountsSettled: settled((s) => s.unreadHash),
  noUnreadDots: settled((s) => s.unreadDots),
  unreadDmsAndMentionsRight: settled((s) => s.priorityDots),
  historyAllChannels: settled((s) => s.historyChannels),
  lastHistoryCall: lastOf((c) => c.m === 'conversations.history'),
  lastRepliesCall: lastOf((c) => c.m === 'conversations.replies'),
  lastSearchCall: lastOf((c) => c.m === 'search.modules.messages'),
  bootRecorded: first((s) => s.bootDone),
  firstSyncEnded: first((s) => s.bootDone && s.phase === 'live' && !s.syncing),
  lastCall: lastOf(() => true),
}
const timeline = {
  target: useFake ? 'fake large seed' : 'live workspace',
  endedAt: ended,
  milestones,
  phases: phaseChanges,
  final: { ...final, unreadHash: undefined },
  calls: Object.fromEntries([...byMethod].toSorted((a, b) => b[1].n - a[1].n)),
  totalCalls: calls.length,
  refused: Object.fromEntries(refused),
  cpu: { userMs: Math.round(cpu.user / 1000), systemMs: Math.round(cpu.system / 1000), eventLoopUtilization: Number(elu.utilization.toFixed(3)), eventLoopActiveMs: Math.round(elu.active) },
  sqlite: Object.fromEntries([...sqlTime].map(([k, v]) => [k, { n: v.n, ms: Math.round(v.ms) }])),
  /** Calls started per 10 s bucket, by method: the shape of the sync over time. */
  buckets: (() => {
    const buckets: Record<string, Record<string, number>> = {}
    for (const c of calls) {
      const key = String(Math.floor(c.s / 10_000) * 10)
      buckets[key] ??= {}
      buckets[key][c.m] = (buckets[key][c.m] ?? 0) + 1
    }
    return buckets
  })(),
  /** Per call, compact: method, reason, start, end. For the gaps between history calls. */
  callLog: calls.map((c) => [c.m, c.reason ?? '', c.s, c.e ?? -1, c.status ?? 0, c.cls ?? '']),
  /** Per class of history call: how many, their first and last place in the order, and when the last one ended. */
  historyOrder: (() => {
    const history = calls.filter((c) => c.cls !== undefined)
    const byClass: Record<string, { n: number; first: number; last: number; lastEnd: number }> = {}
    history.forEach((c, i) => {
      const entry = (byClass[c.cls!] ??= { n: 0, first: i, last: i, lastEnd: 0 })
      entry.n++
      entry.last = i
      entry.lastEnd = Math.max(entry.lastEnd, c.e ?? 0)
    })
    const spacing = history.length > 1 ? ((history.at(-1)!.s - history[0]!.s) / (history.length - 1)) : 0
    return { byClass, spacing: Math.round(spacing) }
  })(),
}

const s = (ms: number | undefined) => (ms === undefined ? 'never' : `${(ms / 1000).toFixed(1)} s`)
console.log(`first-sync-live: ${timeline.target}, ${calls.length} calls, stopped at ${s(ended)}`)
for (const [name, at] of Object.entries(milestones)) console.log(`  ${name.padEnd(24)} ${s(at)}`)
console.log('  phases: ' + phaseChanges.map((p) => `${s(p.t)} ${p.phase}${p.syncing ? ' syncing' : ''}`).join(', '))
console.log('calls by method (n, summed ms, first start, last end, retries, rate limited, Retry-After)')
for (const [method, m] of byMethod) {
  console.log(`  ${method.padEnd(30)} ${String(m.n).padStart(4)}  ${s(m.ms).padStart(8)}  ${s(m.first)} .. ${s(m.last)}  r${m.retries} l${m.limited}${m.retryAfter.length > 0 ? ` RA ${m.retryAfter.join(',')}` : ''}  ${JSON.stringify(m.reasons)}`)
}
console.log(`history order: ${JSON.stringify(timeline.historyOrder)}`)
console.log(`refused: ${JSON.stringify(timeline.refused)}`)
console.log(`cpu: ${JSON.stringify(timeline.cpu)}`)
console.log(`sqlite: ${JSON.stringify(timeline.sqlite)}`)
console.log(`final: ${JSON.stringify(timeline.final)}`)
if (out !== undefined) writeFileSync(out, JSON.stringify(timeline, null, 1))
process.exit(0)
