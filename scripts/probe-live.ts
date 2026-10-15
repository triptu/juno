#!/usr/bin/env node
/**
 * The live probe: read-only questions about Slack's behaviour that the
 * smoke does not answer (research section 10, "Live probe"). Run with
 * `JUNO_LIVE=1 pnpm probe:live`. It reuses the session the smoke cached
 * (`pnpm smoke:live -- --cache-session`), so there is no keychain prompt.
 *
 * What it does, in order, one call at a time, starts at least 1.5 s apart
 * (the background lane's spacing):
 *
 * 1. The M7 recheck as a warm boot would run it now: `client.counts` and one
 *    `getView` page pick the 10 most recently active topics of the last 24
 *    hours, then one history or replies page each, back 24 hours.
 * 2. Five older Main pages (no `oldest`) for edits, files and broadcasts.
 * 3. A history read at the ts of thread broadcasts seen in replies pages.
 * 4. `search.modules.messages`: `is:thread after:`, its second page, plain
 *    `after:` to compare, and a one-word query for highlights.
 * 5. `files.info` for one file, and three GETs of one thumbnail (no
 *    credentials, cookie only, bearer token only).
 * 6. `users.prefs.get` and `dnd.info`.
 *
 * `--only search` runs step 4 alone, plus one search with the exact
 * arguments the discovery sweep sends.
 *
 * Output is counts, key censuses and milliseconds. No id, text, name, URL or
 * value is printed. `--out DIR` writes the redacted response shapes there
 * (default: a new temporary directory); copy the ones a fixture needs into
 * packages/slack-schema/test/fixtures/recorded/ by hand.
 *
 * A 429 or `ratelimited` answer is logged with its `Retry-After` and retried
 * once after that wait (capped at 120 s). The probe never bursts.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Methods, type MethodName } from '@juno/slack-schema'
import { apiBaseFromWorkspace, slackRoute } from '@juno/slack'
import { decodeIssues, readCachedSession, redact } from './live-common.ts'

const READ_ONLY_METHODS = [
  'auth.test',
  'client.counts',
  'subscriptions.thread.getView',
  'conversations.history',
  'conversations.replies',
  'search.modules.messages',
  'files.info',
  'users.prefs.get',
  'dnd.info',
] as const
type ReadOnlyMethod = (typeof READ_ONLY_METHODS)[number]

const SPACING_MILLIS = 1_500
const DAY = 86_400
const flag = (name: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

type Json = Record<string, unknown>
interface Msg extends Json {
  ts: string
  thread_ts?: string
  subtype?: string
  reply_count?: number
  edited?: { ts: string }
  reactions?: Array<unknown>
  files?: Array<Json>
}

interface CallRecord {
  readonly method: string
  readonly purpose: string
  readonly millis: number
  readonly status: number
  readonly ok: boolean
  readonly error?: string
  readonly retryAfter?: string
  readonly decodeIssues: ReadonlyArray<string>
}

const calls: Array<CallRecord> = []
const rateLimits: Array<{ method: string; status: number; retryAfter: string | null; error?: string }> = []
const shapes = new Map<string, unknown>()
let lastStart = 0

const sleep = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis))
const tsSeconds = (ts: string) => Number(ts.split('.')[0])

async function main(): Promise<number> {
  if (process.env['JUNO_LIVE'] !== '1') {
    console.error('probe-live: refusing to touch a real workspace without JUNO_LIVE=1')
    return 2
  }
  const cached = await readCachedSession(flag('--team'))
  if (cached === undefined) {
    console.error('probe-live: no cached session; run `JUNO_LIVE=1 pnpm smoke:live -- --cache-session` first')
    return 2
  }
  const { session, cookie } = cached
  const base = apiBaseFromWorkspace(session.workspaceUrl)
  const route = slackRoute(session)
  const out = flag('--out') ?? (await mkdtemp(join(tmpdir(), 'juno-probe-')))
  await mkdir(out, { recursive: true })
  console.log(`probe-live: read-only. Methods allowed: ${READ_ONLY_METHODS.join(', ')}; GET of one thumbnail.`)

  const call = async (method: ReadOnlyMethod, args: Record<string, string | number | boolean>, purpose: string): Promise<Json | undefined> => {
    if (!(READ_ONLY_METHODS as ReadonlyArray<string>).includes(method)) throw new Error(`refusing ${method}`)
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = lastStart + SPACING_MILLIS - Date.now()
      if (wait > 0) await sleep(wait)
      lastStart = Date.now()
      const url = new URL(`${base}/${method}`)
      url.searchParams.set('_x_id', `noversion-${(Date.now() / 1000).toFixed(3)}`)
      url.searchParams.set('slack_route', route)
      url.searchParams.set('_x_app_name', 'client')
      if (attempt > 0) url.searchParams.set('_x_num_retries', String(attempt))
      const body = new FormData()
      body.append('token', session.token)
      body.append('_x_reason', 'probe')
      body.append('_x_mode', 'online')
      for (const [name, value] of Object.entries(args)) body.append(name, String(value))
      const started = performance.now()
      const response = await fetch(url, { method: 'POST', body, headers: { cookie } })
      const text = await response.text()
      const millis = Math.round(performance.now() - started)
      let json: Json | undefined
      try {
        json = JSON.parse(text) as Json
      } catch {
        json = undefined
      }
      const retryAfter = response.headers.get('retry-after')
      const limited = response.status === 429 || (json !== undefined && json['ok'] === false && /rate_?limit/.test(String(json['error'])))
      if (limited) {
        rateLimits.push({ method, status: response.status, retryAfter, ...(json?.['error'] === undefined ? {} : { error: String(json['error']) }) })
        console.log(`  ${method}: rate limited (HTTP ${response.status}, Retry-After ${retryAfter ?? 'absent'})`)
        if (attempt === 0) {
          await sleep(Math.min(Number(retryAfter ?? 60), 120) * 1000)
          continue
        }
      }
      const issues = json !== undefined && method in Methods ? decodeIssues(Methods[method as MethodName].response, text) : []
      calls.push({
        method,
        purpose,
        millis,
        status: response.status,
        ok: json?.['ok'] === true,
        ...(json?.['ok'] === false ? { error: String(json['error']) } : {}),
        ...(retryAfter === null ? {} : { retryAfter }),
        decodeIssues: issues,
      })
      if (json !== undefined && !shapes.has(`${method}.${purpose}`)) shapes.set(`${method}.${purpose}`, redact(json))
      return json?.['ok'] === true ? json : undefined
    }
    return undefined
  }

  const now = Date.now() / 1000
  if (flag('--only') === 'search') {
    await searchOnly(call, now)
    return writeShapes(out)
  }

  // 1. The recheck, as a warm boot would run it now.
  await call('auth.test', {}, 'auth')
  const from = now - DAY
  const fromTs = from.toFixed(6)
  const counts = await call('client.counts', { thread_counts_by_channel: true }, 'recheck-targets')
  const view = await call('subscriptions.thread.getView', { limit: 10 }, 'recheck-targets')
  type Target = { kind: 'main'; channel: string; activity: number } | { kind: 'thread'; channel: string; threadTs: string; activity: number }
  const mains: Array<Target> = []
  for (const list of ['channels', 'mpims', 'ims'] as const) {
    for (const entry of (counts?.[list] as Array<{ id: string; latest?: string }> | undefined) ?? []) {
      if (entry.latest !== undefined && tsSeconds(entry.latest) >= from) mains.push({ kind: 'main', channel: entry.id, activity: tsSeconds(entry.latest) })
    }
  }
  const threads: Array<Target> = []
  for (const thread of (view?.['threads'] as Array<{ root_msg: { channel: string; thread_ts: string; latest_reply?: string } }> | undefined) ?? []) {
    const latest = thread.root_msg.latest_reply ?? thread.root_msg.thread_ts
    if (tsSeconds(latest) >= from) threads.push({ kind: 'thread', channel: thread.root_msg.channel, threadTs: thread.root_msg.thread_ts, activity: tsSeconds(latest) })
  }
  const targets = [...mains, ...threads].sort((a, b) => b.activity - a.activity).slice(0, 10)
  console.log(`probe-live: recheck targets: ${mains.length} Main and ${threads.length} followed threads active in 24 h (first getView page); reading ${targets.length}`)

  const historyPages: Array<{ channel: string; messages: Array<Msg>; purpose: string }> = []
  const repliesPages: Array<{ channel: string; threadTs: string; oldest: string; messages: Array<Msg>; hasMore: boolean }> = []
  const recheckStarted = Date.now()
  const recheckRows: Array<{ kind: string; millis: number; messages: number; hasMore: boolean }> = []
  for (const target of targets) {
    if (target.kind === 'main') {
      const page = await call('conversations.history', { channel: target.channel, oldest: fromTs, inclusive: true, limit: 100, ignore_replies: true, no_user_profile: true }, 'recheck-main')
      const messages = (page?.['messages'] as Array<Msg> | undefined) ?? []
      historyPages.push({ channel: target.channel, messages, purpose: 'recheck' })
      recheckRows.push({ kind: 'main', millis: calls.at(-1)!.millis, messages: messages.length, hasMore: page?.['has_more'] === true })
    } else {
      const page = await call('conversations.replies', { channel: target.channel, ts: target.threadTs, oldest: fromTs, inclusive: true, limit: 100 }, 'recheck-thread')
      const messages = (page?.['messages'] as Array<Msg> | undefined) ?? []
      repliesPages.push({ channel: target.channel, threadTs: target.threadTs, oldest: fromTs, messages, hasMore: page?.['has_more'] === true })
      recheckRows.push({ kind: 'thread', millis: calls.at(-1)!.millis, messages: messages.length, hasMore: page?.['has_more'] === true })
    }
  }
  const recheckWall = Date.now() - recheckStarted

  // 2. Older Main pages: the five most recently active member channels not read above, one page each, no `oldest`.
  const read = new Set(targets.filter((t) => t.kind === 'main').map((t) => t.channel))
  const older = ((counts?.['channels'] as Array<{ id: string; latest?: string }> | undefined) ?? [])
    .filter((entry) => entry.latest !== undefined && !read.has(entry.id))
    .sort((a, b) => tsSeconds(b.latest!) - tsSeconds(a.latest!))
    .slice(0, 5)
  for (const entry of older) {
    const page = await call('conversations.history', { channel: entry.id, limit: 100, ignore_replies: true, no_user_profile: true }, 'older-main')
    historyPages.push({ channel: entry.id, messages: (page?.['messages'] as Array<Msg> | undefined) ?? [], purpose: 'older' })
  }

  // 3. Broadcasts seen in replies pages: does a history read at their ts return them?
  const broadcastsInReplies = repliesPages.flatMap((page) => page.messages.filter((m) => m.subtype === 'thread_broadcast').map((m) => ({ channel: page.channel, ts: m.ts })))
  const broadcastChecks: Array<{ found: boolean; subtype?: string }> = []
  for (const broadcast of broadcastsInReplies.slice(0, 2)) {
    const page = await call('conversations.history', { channel: broadcast.channel, oldest: broadcast.ts, latest: broadcast.ts, inclusive: true, limit: 1, ignore_replies: true, no_user_profile: true }, 'broadcast-check')
    const hit = ((page?.['messages'] as Array<Msg> | undefined) ?? []).find((m) => m.ts === broadcast.ts)
    broadcastChecks.push({ found: hit !== undefined, ...(hit?.subtype === undefined ? {} : { subtype: hit.subtype }) })
  }

  // 3b. Replies with `oldest` after the root: one followed thread whose root is older than its latest reply.
  const rootCheckThread = ((view?.['threads'] as Array<{ root_msg: { channel: string; thread_ts: string; latest_reply?: string } }> | undefined) ?? []).find(
    (thread) => thread.root_msg.latest_reply !== undefined && tsSeconds(thread.root_msg.latest_reply) - tsSeconds(thread.root_msg.thread_ts) > 60,
  )
  let rootCheck: { rootFirst: boolean; count: number; hasMore: boolean } | undefined
  if (rootCheckThread !== undefined) {
    const page = await call('conversations.replies', { channel: rootCheckThread.root_msg.channel, ts: rootCheckThread.root_msg.thread_ts, oldest: rootCheckThread.root_msg.latest_reply!, inclusive: true, limit: 2 }, 'replies-oldest-after-root')
    const messages = (page?.['messages'] as Array<Msg> | undefined) ?? []
    rootCheck = { rootFirst: messages[0]?.ts === rootCheckThread.root_msg.thread_ts, count: messages.length, hasMore: page?.['has_more'] === true }
  }

  // 4. Search.
  const afterDate = day(now, 2 * DAY)
  const search1 = await call('search.modules.messages', searchArgs(`is:thread after:${afterDate}`, 1, 20), 'is-thread-p1')
  const search2 = await call('search.modules.messages', searchArgs(`is:thread after:${afterDate}`, 2, 20), 'is-thread-p2')
  const search3 = await call('search.modules.messages', searchArgs(`after:${afterDate}`, 1, 20), 'after-only')
  const search4 = await call('search.modules.messages', searchArgs(`the after:${day(now, 7 * DAY)}`, 1, 5), 'one-word')

  // 5. Files.
  const allMessages = [...historyPages.flatMap((p) => p.messages), ...repliesPages.flatMap((p) => p.messages)]
  const files = allMessages.flatMap((m) => m.files ?? [])
  const image = files.find((f) => typeof f['thumb_64'] === 'string' && f['mode'] === 'hosted')
  let fileInfo: Json | undefined
  const downloads: Array<{ how: string; status: number; image: boolean; redirectsToSignIn: boolean }> = []
  if (image !== undefined) {
    fileInfo = await call('files.info', { file: String(image['id']) }, 'one-file')
    const thumb = String(image['thumb_64'])
    const host = new URL(thumb).host
    if (host !== 'files.slack.com' && !host.endsWith('.slack.com') && !host.endsWith('.slack-edge.com')) throw new Error('thumbnail on an unexpected host; not fetching')
    const token = session.token
    for (const [how, headers] of [
      ['none', {}],
      ['cookie', { cookie }],
      ['bearer', { authorization: `Bearer ${token}` }],
    ] as const) {
      const wait = lastStart + SPACING_MILLIS - Date.now()
      if (wait > 0) await sleep(wait)
      lastStart = Date.now()
      const response = await fetch(thumb, { headers, redirect: 'manual' })
      await response.arrayBuffer()
      const location = response.headers.get('location') ?? ''
      downloads.push({ how, status: response.status, image: (response.headers.get('content-type') ?? '').startsWith('image/'), redirectsToSignIn: /signin|login|redir/.test(location) })
    }
  }

  // 6. Notification schedule.
  const prefs = await call('users.prefs.get', {}, 'all')
  const dnd = await call('dnd.info', {}, 'self')

  // Report: counts only.
  const report = {
    calls: summariseCalls(),
    rateLimits,
    recheck: {
      targets: { main: targets.filter((t) => t.kind === 'main').length, thread: targets.filter((t) => t.kind === 'thread').length },
      activeIn24h: { main: mains.length, followedThreadsFirstPage: threads.length },
      wallMillis: recheckWall,
      perCall: recheckRows,
    },
    history: historyCensus(historyPages),
    replies: {
      pages: repliesPages.length,
      rootFirstWhenRootOlderThanOldest: repliesPages.filter((p) => tsSeconds(p.threadTs) < tsSeconds(p.oldest)).map((p) => p.messages[0]?.ts === p.threadTs),
      rootFirstWhenRootNewer: repliesPages.filter((p) => tsSeconds(p.threadTs) >= tsSeconds(p.oldest)).map((p) => p.messages[0]?.ts === p.threadTs),
      broadcastsInReplies: broadcastsInReplies.length,
      oldestAfterRoot: rootCheck,
      messageKeys: keyCensus(repliesPages.flatMap((p) => p.messages)),
    },
    broadcastChecks,
    edits: editCensus(allMessages, now),
    reactions: {
      messages: allMessages.length,
      withReactionsKey: allMessages.filter((m) => 'reactions' in m).length,
      withEmptyReactions: allMessages.filter((m) => Array.isArray(m.reactions) && m.reactions.length === 0).length,
    },
    files: fileCensus(files, fileInfo, downloads),
    search: searchCensus([search1, search2, search3, search4], historyPages, afterDate),
    prefs: prefsCensus(prefs, dnd),
  }
  console.log(JSON.stringify(report, null, 2))
  return writeShapes(out)
}

async function writeShapes(out: string): Promise<number> {
  for (const [name, shape] of shapes) await writeFile(join(out, `${name}.json`), JSON.stringify(shape, null, 2) + '\n')
  console.log(`probe-live: wrote ${shapes.size} redacted shapes to ${out}`)
  return 0
}

type Call = (method: ReadOnlyMethod, args: Record<string, string | number | boolean>, purpose: string) => Promise<Json | undefined>

const day = (now: number, secondsAgo: number) => new Date((now - secondsAgo) * 1000).toISOString().slice(0, 10)

/** The arguments the official client sends for search (research section 3). */
const searchArgs = (query: string, page: number, count: number) => ({
  module: 'messages',
  query,
  page,
  count,
  sort: 'timestamp',
  sort_dir: 'desc',
  extracts: 1,
  highlight: 1,
  max_extract_len: 200,
  extra_message_data: 1,
  no_user_profile: 1,
})

/** `--only search`: the discovery sweep's exact arguments against the client's, and a one-word query by time and by relevance. */
async function searchOnly(call: Call, now: number): Promise<void> {
  const afterDate = day(now, 2 * DAY)
  const query = `is:thread after:${afterDate}`
  const sweep = await call('search.modules.messages', { module: 'messages', query, count: 20, page: 1, no_user_profile: 1, sort: 'timestamp', sort_dir: 'desc' }, 'sweep-args')
  const client = await call('search.modules.messages', searchArgs(query, 1, 20), 'client-args')
  const word = await call('search.modules.messages', searchArgs(`the after:${day(now, 7 * DAY)}`, 1, 20), 'one-word-20')
  const { sort: _sort, sort_dir: _dir, ...byRelevance } = searchArgs(`the after:${day(now, 7 * DAY)}`, 1, 20)
  const relevance = await call('search.modules.messages', byRelevance, 'one-word-relevance')
  const census = searchCensus([sweep, client, word, relevance], [], afterDate, ['sweep-args', 'client-args', 'one-word-20', 'one-word-relevance'])
  console.log(JSON.stringify({ calls: summariseCalls(), rateLimits, search: census }, null, 2))
}

function summariseCalls() {
  const byMethod: Record<string, { calls: number; totalMillis: number; maxMillis: number; failed: Array<string>; decodeIssues: Array<string> }> = {}
  for (const record of calls) {
    const entry = (byMethod[record.method] ??= { calls: 0, totalMillis: 0, maxMillis: 0, failed: [], decodeIssues: [] })
    entry.calls++
    entry.totalMillis += record.millis
    entry.maxMillis = Math.max(entry.maxMillis, record.millis)
    if (!record.ok) entry.failed.push(`${record.purpose}: ${record.error ?? `HTTP ${record.status}`}`)
    for (const issue of record.decodeIssues) if (!entry.decodeIssues.includes(issue)) entry.decodeIssues.push(issue)
  }
  return { total: calls.length, retryAfterHeadersSeen: calls.filter((c) => c.retryAfter !== undefined).length, byMethod }
}

/** For each key: how many of the objects have it, and the JSON types seen. */
function keyCensus(objects: ReadonlyArray<unknown>): Record<string, string> {
  const seen = new Map<string, { n: number; types: Set<string> }>()
  for (const object of objects) {
    if (object === null || typeof object !== 'object') continue
    for (const [key, value] of Object.entries(object)) {
      const name = /^[A-Z][A-Z0-9]{4,}$/.test(key) ? '<id>' : key
      const entry = seen.get(name) ?? { n: 0, types: new Set() }
      entry.n++
      entry.types.add(value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value)
      seen.set(name, entry)
    }
  }
  return Object.fromEntries([...seen].sort(([a], [b]) => a.localeCompare(b)).map(([key, { n, types }]) => [key, `${n}/${objects.length} ${[...types].join('|')}`]))
}

function historyCensus(pages: ReadonlyArray<{ messages: Array<Msg>; purpose: string }>) {
  const messages = pages.flatMap((p) => p.messages)
  const spanDays = pages
    .filter((p) => p.purpose === 'older' && p.messages.length > 0)
    .map((p) => Math.round((tsSeconds(p.messages[0]!.ts) - tsSeconds(p.messages.at(-1)!.ts)) / DAY))
  return {
    pages: pages.length,
    messages: messages.length,
    olderPageSpanDays: spanDays,
    subtypes: countBy(messages, (m) => m.subtype ?? '(none)'),
    repliesThatAreNotBroadcasts: messages.filter((m) => m.thread_ts !== undefined && m.thread_ts !== m.ts && m.subtype !== 'thread_broadcast').length,
    broadcasts: messages.filter((m) => m.subtype === 'thread_broadcast').length,
    roots: messages.filter((m) => (m.reply_count ?? 0) > 0).length,
  }
}

function editCensus(messages: ReadonlyArray<Msg>, now: number) {
  const unique = new Map(messages.map((m) => [m.ts, m]))
  const edited = [...unique.values()].filter((m) => m.edited?.ts !== undefined)
  const buckets = { under1m: 0, under1h: 0, under24h: 0, under7d: 0, over7d: 0 }
  for (const m of edited) {
    const delay = tsSeconds(m.edited!.ts) - tsSeconds(m.ts)
    if (delay < 60) buckets.under1m++
    else if (delay < 3_600) buckets.under1h++
    else if (delay < DAY) buckets.under24h++
    else if (delay < 7 * DAY) buckets.under7d++
    else buckets.over7d++
  }
  const olderThan24h = [...unique.values()].filter((m) => now - tsSeconds(m.ts) > DAY)
  return {
    messages: unique.size,
    edited: edited.length,
    editDelay: buckets,
    messagesOlderThan24hNow: olderThan24h.length,
    editedMoreThan24hAfterPosting: buckets.under7d + buckets.over7d,
  }
}

function fileCensus(files: ReadonlyArray<Json>, info: Json | undefined, downloads: ReadonlyArray<unknown>) {
  const hosts = countBy(files.filter((f) => typeof f['url_private'] === 'string'), (f) => {
    const host = new URL(String(f['url_private'])).host
    return host === 'files.slack.com' ? host : host.endsWith('.slack.com') ? '<workspace>.slack.com' : 'other'
  })
  return {
    files: files.length,
    modes: countBy(files, (f) => String(f['mode'] ?? '(none)')),
    filetypes: countBy(files, (f) => String(f['filetype'] ?? '(none)')),
    urlPrivateHosts: hosts,
    keys: keyCensus(files),
    filesInfoKeys: info === undefined ? undefined : keyCensus([info]),
    filesInfoFileKeys: info?.['file'] === undefined ? undefined : keyCensus([info['file']]),
    downloads,
  }
}

function searchCensus(
  responses: ReadonlyArray<Json | undefined>,
  pages: ReadonlyArray<{ channel: string; messages: Array<Msg> }>,
  afterDate: string,
  names: ReadonlyArray<string> = ['is-thread-p1', 'is-thread-p2', 'after-only', 'one-word'],
) {
  const roots = new Set(pages.flatMap((p) => p.messages.filter((m) => (m.reply_count ?? 0) > 0).map((m) => `${p.channel}:${m.ts}`)))
  const plain = new Set(pages.flatMap((p) => p.messages.filter((m) => (m.reply_count ?? 0) === 0 && m.thread_ts === undefined).map((m) => `${p.channel}:${m.ts}`)))
  const afterBoundary = Date.parse(`${afterDate}T00:00:00Z`) / 1000 + DAY
  return responses.map((response, index) => {
    if (response === undefined) return { query: names[index], failed: true }
    const items = (response['items'] as Array<Json> | undefined) ?? []
    const messages = items.flatMap((item) => ((item['messages'] as Array<Json> | undefined) ?? []).map((m) => ({ m, channel: item['channel'] as Json | undefined })))
    const ts = messages.map(({ m }) => Number(m['ts']))
    const descending = ts.every((value, i) => i === 0 || value <= ts[i - 1]!)
    const classify = ({ m, channel }: { m: Json; channel: Json | undefined }) => {
      if (typeof m['thread_ts'] === 'string') return m['thread_ts'] === m['ts'] ? 'root (thread_ts = ts)' : 'reply (thread_ts)'
      const permalink = typeof m['permalink'] === 'string' ? new URL(m['permalink']) : undefined
      if (permalink?.searchParams.has('thread_ts') === true) return 'reply (permalink thread_ts)'
      const key = `${String(channel?.['id'])}:${String(m['ts'])}`
      if (roots.has(key)) return 'root (seen in history)'
      if (plain.has(key)) return 'not a thread (seen in history)'
      return 'unknown'
    }
    return {
      query: names[index],
      topKeys: Object.keys(response).sort(),
      pagination: response['pagination'] === undefined ? undefined : keyCensus([response['pagination']]),
      paginationValues: response['pagination'] === undefined ? undefined : pick(response['pagination'] as Json, ['page', 'page_count', 'per_page', 'total_count', 'first', 'last']),
      responseMetadata: response['response_metadata'] === undefined ? undefined : keyCensus([response['response_metadata']]),
      items: items.length,
      messages: messages.length,
      messagesPerItem: countBy(items, (item) => String(((item['messages'] as Array<unknown> | undefined) ?? []).length)),
      itemKeys: keyCensus(items),
      channelKeys: keyCensus(items.map((item) => item['channel'])),
      messageKeys: keyCensus(messages.map(({ m }) => m)),
      extractKeys: keyCensus(messages.flatMap(({ m }) => (Array.isArray(m['extracts']) ? m['extracts'] : []))),
      extractTypes: countBy(messages.flatMap(({ m }) => (Array.isArray(m['extracts']) ? m['extracts'] : [])), (e) => (Array.isArray(e) ? 'array' : e === null ? 'null' : typeof e)),
      extractsPerMessage: countBy(messages, ({ m }) => String(Array.isArray(m['extracts']) ? m['extracts'].length : 'absent')),
      blocksExtractKeys: keyCensus(messages.flatMap(({ m }) => (Array.isArray(m['blocks_extracts']) ? m['blocks_extracts'] : []))),
      blocksExtractTypedKeys: keyCensus(messages.flatMap(({ m }) => (Array.isArray(m['blocks_extracts_typed']) ? m['blocks_extracts_typed'] : []))),
      highlightMarkers: markerCensus(messages.map(({ m }) => m)),
      sortedDescending: descending,
      beforeAfterBoundaryUtc: ts.filter((value) => value < afterBoundary).length,
      beforeAfterBoundaryMinus14h: ts.filter((value) => value < afterBoundary - 14 * 3_600).length,
      kinds: countBy(messages, classify),
      withRootFields: messages.filter(({ m }) => 'reply_count' in m || 'thread_ts' in m).length,
    }
  })
}

/** Where highlight-like markers appear in the matches: key paths (indexes as []) and the kind of marker. Never the text. */
function markerCensus(messages: ReadonlyArray<Json>): Record<string, number> {
  const kinds: ReadonlyArray<readonly [string, RegExp]> = [
    ['private-use U+E000/U+E001', /[\ue000\ue001]/],
    ['other private-use', /[\ue002-\uf8ff]/],
    ['control U+0002/U+0003', /[\u0002\u0003]/],
    ['<em> or <b> tag', /<\/?(em|b|mark)>/],
  ]
  const out: Record<string, number> = {}
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      for (const [kind, pattern] of kinds) if (pattern.test(value)) out[`${path}: ${kind}`] = (out[`${path}: ${kind}`] ?? 0) + 1
    } else if (Array.isArray(value)) value.forEach((item) => walk(item, `${path}[]`))
    else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, path === '' ? key : `${path}.${key}`)
  }
  for (const message of messages) walk(message, '')
  return out
}

function prefsCensus(prefs: Json | undefined, dnd: Json | undefined) {
  const all = (prefs?.['prefs'] as Json | undefined) ?? {}
  const schedule = Object.fromEntries(
    Object.entries(all)
      .filter(([key]) => /dnd|vip|priority/.test(key))
      .map(([key, value]) => [key, typeof value === 'string' ? (/^\d{1,2}:\d{2}$/.test(value) ? `string ${value.length === 4 ? 'H:MM' : 'HH:MM'}` : /^(every_day|weekdays|custom|all_day|disabled|partial)$/.test(value) ? `enum ${value}` : `string(${value.length})`) : typeof value]),
  )
  return {
    prefsCount: Object.keys(all).length,
    topKeys: prefs === undefined ? undefined : Object.keys(prefs).sort(),
    schedule,
    dndKeys: dnd === undefined ? undefined : keyCensus([dnd]),
  }
}

function countBy<T>(items: ReadonlyArray<T>, key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1
  return out
}

function pick(object: Json, keys: ReadonlyArray<string>): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, typeof object[key] === 'number' || typeof object[key] === 'boolean' ? object[key] : typeof object[key]]))
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`probe-live: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  },
)
