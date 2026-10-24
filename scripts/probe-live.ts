#!/usr/bin/env bun
/**
 * The live probe: read-only questions about Slack's behaviour that the
 * smoke does not answer (research section 10, "Live probe"). Run with
 * `JUNO_LIVE=1 bun run probe:live`. It reuses the session the smoke cached
 * (`bun run smoke:live --cache-session`), so there is no keychain prompt.
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
 * `--only files` checks the newest self-DM image with an exact history read,
 * probes files.info, and compares thumbnail auth. Booleans and statuses only; no shapes saved.
 * `--only search` runs step 4 alone, plus one search with the exact
 * arguments the discovery sweep sends.
 *
 * `--only users` answers why senders show as ids: `client.userBoot`,
 * `client.counts`, eight history pages, then the ids those reference
 * (senders, mentions, DM and group DM members) through the edge
 * `users/info`, one page of edge `users/list` and one of `users.list`.
 * It also prints how each spells profile photos (which `image_*` keys,
 * on which hosts), and GETs one photo built from `avatar_hash` for a user
 * with a custom photo and one without, with and without the cookie.
 *
 * `--only external` answers why Slack Connect people show as "Someone":
 * `client.userBoot` and `client.counts` pick the six most recently active
 * shared member channels, one history page each (with `user_profile`), then
 * the senders and joiners go through the edge `users/info` as the sync asks,
 * and the ones not returned are asked again after 20 s, with `updated_ids`,
 * and through the Web API `users.info`. Counts and key names only.
 *
 * `--only usergroups` reads `client.userBoot`, `usergroups.list` and
 * recent history pages, and prints how user groups are listed and how a
 * group mention is spelled in `text` and in rich text blocks.
 *
 * `--only emoji` reads every edge `emojis/list` page and prints the result
 * keys and how image urls and aliases are spelled.
 *
 * `--only links` reads one history page of the self-DM and of the most
 * recently active conversations, and counts how messages sent from Slack's
 * clients spell links: `link` element keys, how `url` relates to `text`,
 * and the `<url>` and `<url|label>` forms in the mrkdwn `text`.
 *
 * `--only styles` reads one history page of the self-DM and of the 25 most
 * recently active conversations, and counts how messages sent from Slack's
 * clients spell text styles, code blocks and quotes: style key sets by
 * element type, `rich_text_preformatted` and `rich_text_quote` keys, and
 * which mrkdwn markers the `text` puts around a styled run. Nothing is
 * written to disk.
 *
 * `--only reactions` reads one history page of each of the 30 most recently
 * active conversations and five of the general channel, and counts
 * reactions whose `users` list is shorter than `count`. Then, for up to three messages (truncated ones first, else
 * the largest counts), it calls `reactions.get` without and with `full` and
 * compares `users.length` with `count` for each reaction. Counts only.
 *
 * Output is counts, key censuses and milliseconds. No id, text, name, URL or
 * value is printed. `--out DIR` writes the redacted response shapes there
 * (default: a new temporary directory); copy the ones a fixture needs into
 * packages/slack-schema/test/fixtures/recorded/ by hand.
 *
 * A 429 or `ratelimited` answer is logged with its `Retry-After` and retried
 * once after that wait (capped at 120 s). The probe never bursts.
 */
import { probeIntegrations } from './probe-integrations.ts'
import { probeSearch } from './probe-search.ts'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EdgeUsersInfoResponse, Methods, type MethodName } from '@juno/slack-schema'
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
  'client.userBoot',
  'api.getFlannelHttpUrl',
  'users.list',
  'usergroups.list',
  'reactions.get',
  'users.info',
] as const
/** Edge methods `--only users` and `--only emoji` may call, all reads. */
const READ_ONLY_EDGE = ['users/info', 'users/list', 'emojis/list'] as const
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
    console.error('probe-live: no cached session; run `JUNO_LIVE=1 bun run smoke:live --cache-session` first')
    return 2
  }
  if (flag('--only') === 'search2') {
    await probeSearch(cached, flag('--out'), flag('--section'))
    return 0
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

  if (flag('--only') === 'files') {
    const auth = await call('auth.test', {}, 'files')
    const boot = await call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, 'files')
    const selfDm = ((boot?.['ims'] as Array<Json> | undefined) ?? []).find((im) => im['user'] === auth?.['user_id'])
    if (typeof selfDm?.['id'] !== 'string') throw new Error('self-DM not found')
    const channel = selfDm['id']
    const history = await call('conversations.history', { channel, limit: 100 }, 'self-dm-files')
    const message = ((history?.['messages'] as Array<Msg> | undefined) ?? []).find((message) => message.files?.some((file) => String(file['mimetype']).startsWith('image/')))
    const file = message?.files?.find((file) => String(file['mimetype']).startsWith('image/'))
    if (message === undefined || file === undefined) throw new Error('self-DM image not found in newest page')
    const exact = await call('conversations.history', { channel, oldest: message.ts, latest: message.ts, inclusive: true, limit: 2 }, 'exact-file-message')
    const reread = ((exact?.['messages'] as Array<Msg> | undefined) ?? []).find((each) => each.ts === message.ts)?.files?.find((each) => each['id'] === file['id'])
    await call('files.info', { file: String(file['id']) }, 'file-info-support')
    const downloads = []
    if (typeof reread?.['thumb_360'] === 'string') {
      for (const authenticated of [false, true]) {
        const response = await fetch(reread['thumb_360'], { redirect: 'manual', headers: authenticated ? { cookie } : {} })
        downloads.push({ authenticated, status: response.status, image: (response.headers.get('content-type') ?? '').startsWith('image/') })
        await response.body?.cancel()
      }
    }
    console.log(JSON.stringify({ exactMessageFound: reread !== undefined, hasThumb: typeof reread?.['thumb_360'] === 'string', hasSize: typeof reread?.['original_w'] === 'number' && typeof reread?.['original_h'] === 'number', downloads, calls }, null, 2))
    return 0
  }

  if (flag('--only') === 'integrations') {
    await probeIntegrations(call, out)
    return 0
  }

  if (flag('--only') === 'links') {
    console.log(JSON.stringify(await linksOnly(call), null, 2))
    return writeShapes(out)
  }

  if (flag('--only') === 'reactions') {
    console.log(JSON.stringify(await reactionsOnly(call), null, 2))
    return 0
  }

  if (flag('--only') === 'styles') {
    console.log(JSON.stringify(await stylesOnly(call), null, 2))
    return 0
  }

  const now = Date.now() / 1000
  if (flag('--only') === 'search') {
    await searchOnly(call, now)
    return writeShapes(out)
  }
  if (flag('--only') === 'usergroups') {
    console.log(JSON.stringify(await usergroupsOnly(call), null, 2))
    return writeShapes(out)
  }
  if (flag('--only') === 'users' || flag('--only') === 'emoji' || flag('--only') === 'external') {
    const edge = async (method: (typeof READ_ONLY_EDGE)[number], base: string, body: Json, purpose: string): Promise<Json | undefined> => {
      if (!(READ_ONLY_EDGE as ReadonlyArray<string>).includes(method)) throw new Error(`refusing edge ${method}`)
      const wait = lastStart + SPACING_MILLIS - Date.now()
      if (wait > 0) await sleep(wait)
      lastStart = Date.now()
      const started = performance.now()
      const response = await fetch(`${base}/${method}?_x_app_name=client`, {
        method: 'POST',
        body: JSON.stringify({ token: session.token, ...body }),
        headers: { cookie, 'content-type': 'application/json' },
      })
      const text = await response.text()
      let json: Json | undefined
      try {
        json = JSON.parse(text) as Json
      } catch {
        json = undefined
      }
      const issues = json !== undefined && method === 'users/info' ? decodeIssues(EdgeUsersInfoResponse, text) : []
      calls.push({ method: `edge:${method}`, purpose, millis: Math.round(performance.now() - started), status: response.status, ok: json?.['ok'] === true, ...(json?.['ok'] === false ? { error: String(json['error']) } : {}), decodeIssues: issues })
      if (json !== undefined && !shapes.has(`edge.${method.replace('/', '.')}.${purpose}`)) shapes.set(`edge.${method.replace('/', '.')}.${purpose}`, redact(json))
      return json
    }
    const only = flag('--only')
    console.log(JSON.stringify(only === 'emoji' ? await emojiOnly(call, edge) : only === 'external' ? await externalOnly(call, edge, session.teamId) : await usersOnly(call, edge, session.teamId, cookie), null, 2))
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
  const targets = [...mains, ...threads].toSorted((a, b) => b.activity - a.activity).slice(0, 10)
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
    .toSorted((a, b) => tsSeconds(b.latest!) - tsSeconds(a.latest!))
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

type Edge = (method: (typeof READ_ONLY_EDGE)[number], base: string, body: Json, purpose: string) => Promise<Json | undefined>

/** `--only emoji`: the edge `emojis/list` result keys, and how aliases and image urls are spelled. Counts only. */
async function emojiOnly(call: Call, edge: Edge): Promise<unknown> {
  const flannel = await call('api.getFlannelHttpUrl', { include_external_workspaces: true }, 'emoji')
  const base = String(flannel?.['url'] ?? '').replace(/\/+$/, '')
  const results: Array<Json> = []
  let marker: string | undefined
  let pages = 0
  do {
    const page = await edge('emojis/list', base, { count: 1000, ...(marker === undefined ? {} : { marker }) }, 'emoji')
    const list = page?.['results']
    if (Array.isArray(list)) results.push(...(list as Array<Json>))
    marker = typeof page?.['next_marker'] === 'string' && page['next_marker'] !== '' ? page['next_marker'] : undefined
    pages++
  } while (marker !== undefined && pages < 20)
  const urlish = (value: unknown) => (typeof value !== 'string' ? typeof value : value.startsWith('alias:') ? 'alias:' : value.startsWith('https://') ? 'https' : 'other')
  return {
    pages,
    results: results.length,
    nameCharacterClasses: countBy(results.flatMap((row) => typeof row['name'] === 'string' ? [...row['name']] : []), (character) => /^[a-z0-9_+-]$/.test(character) ? 'ascii_name' : /\p{L}/u.test(character) ? 'unicode_letter' : /\p{M}/u.test(character) ? 'unicode_mark' : /\p{N}/u.test(character) ? 'unicode_number' : `other_U+${character.codePointAt(0)?.toString(16).toUpperCase()}`),
    keys: keyCensus(results),
    stringValueKinds: Object.fromEntries(
      ['url', 'value', 'alias_for', 'alias', 'is_alias'].map((key) => [key, countBy(results, (r) => (key in r ? urlish(r[key]) : 'absent'))]),
    ),
    // An object `value` and an alias entry, by shape only.
    valueObjects: keyCensus(results.flatMap((r) => (r['value'] !== null && typeof r['value'] === 'object' ? [r['value']] : []))),
    aliasEntries: countBy(results.filter((r) => r['is_alias'] === true || 'alias' in r), (r) => `value:${urlish(r['value'])} alias:${urlish(r['alias'])} aliasNamesAnEntry:${results.some((o) => o['name'] === r['alias'] || `alias:${o['name']}` === r['value'])}`),
  }
}

/** `--only users`: which ids the store would hold and what the edge says about them. Counts only. */
async function usersOnly(call: Call, edge: Edge, teamId: string, cookie: string): Promise<unknown> {
  const boot = await call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, 'users')
  const counts = await call('client.counts', { thread_counts_by_channel: true }, 'users')
  const flannel = await call('api.getFlannelHttpUrl', { include_external_workspaces: true }, 'users')
  const base = String(flannel?.['url'] ?? '').replace(/\/+$/, '')
  const channels = (boot?.['channels'] as Array<Json> | undefined) ?? []
  const ims = (boot?.['ims'] as Array<Json> | undefined) ?? []
  const memberIds = new Set(['channels', 'mpims', 'ims'].flatMap((list) => ((counts?.[list] as Array<{ id: string }> | undefined) ?? []).map((e) => e.id)))
  const mpims = channels.filter((c) => c['is_mpim'] === true && memberIds.has(String(c['id'])))
  const ids = { sender: new Set<string>(), mention: new Set<string>(), im: new Set<string>(), mpim: new Set<string>(), replyUser: new Set<string>() }
  for (const im of ims) if (memberIds.has(String(im['id'])) && typeof im['user'] === 'string') ids.im.add(im['user'])
  for (const mpim of mpims) for (const member of (mpim['members'] as Array<string> | undefined) ?? []) ids.mpim.add(member)
  const recent = ['channels', 'mpims', 'ims'].flatMap((list) => (counts?.[list] as Array<{ id: string; latest?: string }> | undefined) ?? [])
    .filter((e) => e.latest !== undefined)
    .toSorted((a, b) => tsSeconds(b.latest!) - tsSeconds(a.latest!))
    .slice(0, 8)
  let messages = 0
  let escaped = 0
  for (const entry of recent) {
    const page = await call('conversations.history', { channel: entry.id, limit: 50, ignore_replies: true, no_user_profile: true }, 'users')
    for (const m of (page?.['messages'] as Array<Msg> | undefined) ?? []) {
      messages++
      if (typeof m['user'] === 'string') ids.sender.add(m['user'])
      for (const u of (m['reply_users'] as Array<string> | undefined) ?? []) ids.replyUser.add(u)
      const text = typeof m['text'] === 'string' ? m['text'] : ''
      if (/&(amp|lt|gt);/.test(text)) escaped++
      for (const match of text.matchAll(/<@([UW][A-Z0-9]+)/g)) ids.mention.add(match[1]!)
    }
  }
  const all = [...new Set([...ids.sender, ...ids.mention, ...ids.im, ...ids.mpim, ...ids.replyUser])].filter((id) => /^[UW][A-Z0-9]+$/.test(id))
  const infoUsers: Array<Json> = []
  const info = { calls: 0, resultsShape: new Set<string>(), results: 0, failed: 0, pending: 0, invalid: 0, disconnected: 0, otherTeam: 0, emptyDisplayName: 0, noProfile: 0, bots: 0, keys: new Map<string, number>() }
  const returned = new Set<string>()
  if (base !== '') {
    for (let i = 0; i < all.length; i += 100) {
      const answer = await edge('users/info', base, { ids: all.slice(i, i + 100) }, 'users')
      info.calls++
      const results = answer?.['results']
      info.resultsShape.add(Array.isArray(results) ? 'array' : typeof results)
      const list = Array.isArray(results) ? (results as Array<Json>) : results !== null && typeof results === 'object' ? Object.values(results as Record<string, Json>) : []
      for (const user of list) {
        infoUsers.push(user)
        info.results++
        returned.add(String(user['id']))
        if (user['team_id'] !== teamId) info.otherTeam++
        if (user['is_bot'] === true) info.bots++
        const profile = user['profile'] as Json | undefined
        if (profile === undefined) info.noProfile++
        else if (profile['display_name'] === '') info.emptyDisplayName++
        for (const key of Object.keys(user)) info.keys.set(key, (info.keys.get(key) ?? 0) + 1)
      }
      info.failed += ((answer?.['failed_ids'] as Array<unknown> | undefined) ?? []).length
      info.pending += ((answer?.['pending_ids'] as Array<unknown> | undefined) ?? []).length
      info.invalid += ((answer?.['invalid_ids'] as Array<unknown> | undefined) ?? []).length
      info.disconnected += ((answer?.['disconnected_ids'] as Array<unknown> | undefined) ?? []).length
    }
  }
  const photos = await avatarPhotos(infoUsers, cookie)
  const missingBy = (set: Set<string>) => [...set].filter((id) => !returned.has(id)).length
  const edgeList = base === '' ? undefined : await edge('users/list', base, { count: 100, present_first: false }, 'users')
  const webList = await call('users.list', { limit: 200 }, 'users')
  return {
    calls: summariseCalls(),
    boot: { topLevelKeys: Object.keys(boot ?? {}).toSorted(), imsOfMember: ids.im.size, mpimsOfMember: mpims.length, mpimsWithMembers: mpims.filter((c) => Array.isArray(c['members'])).length },
    history: { pages: recent.length, messages, textWithEntities: escaped },
    ids: { all: all.length, sender: ids.sender.size, mention: ids.mention.size, im: ids.im.size, mpim: ids.mpim.size, replyUser: ids.replyUser.size, wPrefix: all.filter((id) => id.startsWith('W')).length },
    usersInfo: { ...info, resultsShape: [...info.resultsShape], keys: Object.fromEntries([...info.keys].toSorted()), notReturned: { all: all.length - returned.size, sender: missingBy(ids.sender), mention: missingBy(ids.mention), im: missingBy(ids.im), mpim: missingBy(ids.mpim) } },
    edgeUsersList: { ok: edgeList?.['ok'], error: edgeList?.['error'], results: Array.isArray(edgeList?.['results']) ? (edgeList['results'] as Array<unknown>).length : typeof edgeList?.['results'], nextMarker: typeof edgeList?.['next_marker'] === 'string' },
    usersList: { ok: webList?.['ok'] ?? false, members: ((webList?.['members'] as Array<unknown> | undefined) ?? []).length, nextCursor: ((webList?.['response_metadata'] as Json | undefined)?.['next_cursor'] ?? '') !== '' },
    images: {
      usersInfo: imageCensus(infoUsers),
      edgeUsersList: imageCensus(Array.isArray(edgeList?.['results']) ? (edgeList['results'] as Array<Json>) : []),
      usersList: imageCensus((webList?.['members'] as Array<Json> | undefined) ?? []),
      bootSelf: imageCensus(boot?.['self'] === undefined ? [] : [boot['self'] as Json]),
      avatarBase: avatarBase(boot),
      profileKeys: keyCensus(infoUsers.map((user) => user['profile'])),
      teamIdPrefix: Object.fromEntries([...new Set(infoUsers.map((user) => String(user['team_id'] ?? 'absent')[0]))].map((prefix) => [prefix, infoUsers.filter((user) => String(user['team_id'] ?? 'absent')[0] === prefix).length])),
      photos,
    },
  }
}

type Role = 'sender' | 'joiner'
type EdgeAnswer = { readonly where: ReadonlyMap<string, string>; readonly users: ReadonlyArray<Json> }

/** `--only external`: what the edge says about the people of Slack Connect channels. Counts and key names only. */
async function externalOnly(call: Call, edge: Edge, teamId: string): Promise<unknown> {
  const people = await sharedChannelPeople(call, teamId)
  const flannel = await call('api.getFlannelHttpUrl', { include_external_workspaces: true }, 'external')
  const base = String(flannel?.['url'] ?? '').replace(/\/+$/, '')
  const ask = async (body: Json, purpose: string): Promise<EdgeAnswer> => {
    const answer = await edge('users/info', base, body, purpose)
    const results = answer?.['results']
    const users = Array.isArray(results) ? (results as Array<Json>) : results !== null && typeof results === 'object' ? Object.values(results as Record<string, Json>) : []
    const where = new Map(users.map((user) => [String(user['id']), 'results']))
    for (const key of ['failed_ids', 'pending_ids', 'invalid_ids', 'disconnected_ids']) for (const id of (answer?.[key] as Array<string> | undefined) ?? []) where.set(id, key)
    return { where, users }
  }
  const all = [...people.roles.keys()].filter((id) => /^[UW][A-Z0-9]+$/.test(id))
  const landing = new Map<string, string>()
  const results: Array<Json> = []
  if (base !== '') {
    for (let i = 0; i < all.length; i += 100) {
      const answer = await ask({ ids: all.slice(i, i + 100) }, 'external')
      for (const [id, list] of answer.where) landing.set(id, list)
      results.push(...answer.users)
    }
  }
  const byRole = (where: ReadonlyMap<string, string>, subset: ReadonlyArray<string>) => countBy(subset, (id) => `${people.roles.get(id)} -> ${where.get(id) ?? 'absent'}`)
  const notReturned = all.filter((id) => landing.get(id) !== 'results').slice(0, 100)
  const team = (user: Json | undefined) => `otherTeam:${user?.['team_id'] !== teamId} stranger:${user?.['is_stranger'] === true} deleted:${user?.['deleted'] === true} bot:${user?.['is_bot'] === true}`
  return {
    calls: summariseCalls(),
    ...people.census,
    ids: { all: all.length, byRole: countBy(all, (id) => people.roles.get(id)!), idPrefix: countBy(all, (id) => id[0]!) },
    usersInfo: byRole(landing, all),
    usersInfoByTeam: countBy(results, team),
    resultsKeys: keyCensus(results),
    notReturned: notReturned.length,
    again: notReturned.length === 0 || base === '' ? {} : await askAgain(call, ask, byRole, notReturned, team),
  }
}

/** The senders and joiners of the most recently active shared channels, and a census of their messages. */
async function sharedChannelPeople(call: Call, teamId: string) {
  const boot = await call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, 'external')
  const counts = await call('client.counts', { thread_counts_by_channel: true }, 'external')
  const channels = (boot?.['channels'] as Array<Json> | undefined) ?? []
  const latest = new Map(((counts?.['channels'] as Array<{ id: string; latest?: string }> | undefined) ?? []).map((e) => [e.id, e.latest]))
  const shared = channels
    .filter((c) => (c['is_ext_shared'] === true || c['is_shared'] === true) && latest.get(String(c['id'])) !== undefined)
    .toSorted((a, b) => tsSeconds(latest.get(String(b['id']))!) - tsSeconds(latest.get(String(a['id']))!))
    .slice(0, Number(flag('--channels') ?? 6))
  const roles = new Map<string, Role>()
  const messages: Array<Msg> = []
  for (const channel of shared) {
    const page = await call('conversations.history', { channel: String(channel['id']), limit: 100, ignore_replies: true }, 'external')
    messages.push(...((page?.['messages'] as Array<Msg> | undefined) ?? []))
  }
  for (const m of messages) {
    if (typeof m['user'] !== 'string') continue
    if (m.subtype !== 'channel_join') roles.set(m['user'], 'sender')
    else if (!roles.has(m['user'])) roles.set(m['user'], 'joiner')
  }
  const fromOtherTeam = (m: Msg) => m['user_team'] !== undefined && m['user_team'] !== teamId
  return {
    roles,
    census: {
      channelFlags: countBy(channels, (c) => `ext:${c['is_ext_shared'] === true} shared:${c['is_shared'] === true} org:${c['is_org_shared'] === true} pendingExt:${c['is_pending_ext_shared'] === true}`),
      sharedChannelsRead: shared.length,
      messages: messages.length,
      joins: messages.filter((m) => m.subtype === 'channel_join').length,
      teamFields: countBy(messages, (m) => ['team', 'user_team', 'source_team'].filter((key) => key in m).join('+') || 'none'),
      userProfile: countBy(messages, (m) => `fromOtherTeam:${fromOtherTeam(m)} join:${m.subtype === 'channel_join'} profile:${m['user_profile'] !== undefined}`),
      userProfileKeys: keyCensus(messages.flatMap((m) => (m['user_profile'] === undefined ? [] : [m['user_profile']]))),
    },
  }
}

/** The ids the edge did not return, asked again: later, with `updated_ids`, as Slack's client asks, and through the Web API. */
async function askAgain(
  call: Call,
  ask: (body: Json, purpose: string) => Promise<EdgeAnswer>,
  byRole: (where: ReadonlyMap<string, string>, subset: ReadonlyArray<string>) => Record<string, number>,
  ids: ReadonlyArray<string>,
  team: (user: Json | undefined) => string,
): Promise<unknown> {
  await sleep(20_000)
  const after20s = byRole((await ask({ ids }, 'external-again')).where, ids)
  const updatedIds = byRole((await ask({ updated_ids: Object.fromEntries(ids.map((id) => [id, 0])) }, 'external-updated')).where, ids)
  // As Slack's client fetches missing members: profile-only users included, pending ids asked again.
  const profileOnly: Array<unknown> = []
  let pending = [...ids]
  for (const wait of [0, 500, 1_000, 1_500, 5_000, 15_000]) {
    if (pending.length === 0) break
    await sleep(wait)
    const { where } = await ask({ ids: pending, include_profile_only_users: true, check_interaction: true }, 'external-profile-only')
    profileOnly.push({ waitedMillis: wait, ...byRole(where, pending) })
    pending = pending.filter((id) => where.get(id) === 'pending_ids')
  }
  const web = new Map<string, string>()
  for (const id of ids.slice(0, 10)) {
    const answer = await call('users.info', { user: id }, 'external')
    const user = answer?.['user'] as Json | undefined
    const named = String((user?.['profile'] as Json | undefined)?.['real_name'] ?? '').trim() !== ''
    web.set(id, answer === undefined ? 'error' : `${named ? 'named' : 'unnamed'} ${team(user)}`)
  }
  return { after20s, updatedIds, profileOnly, webUsersInfo: byRole(web, ids.slice(0, 10)), webErrors: countBy(calls.filter((c) => c.method === 'users.info' && !c.ok), (c) => c.error ?? 'none') }
}

/** `--only links`: how Slack's own clients encode links in `blocks` and `text`. Counts only. */
async function linksOnly(call: Call): Promise<unknown> {
  const auth = await call('auth.test', {}, 'links')
  const boot = await call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, 'links')
  const counts = await call('client.counts', { thread_counts_by_channel: true }, 'links')
  const self = String(auth?.['user_id'] ?? '')
  const selfDm = ((boot?.['ims'] as Array<Json> | undefined) ?? []).find((im) => im['user'] === self)
  const recent = ['channels', 'mpims', 'ims'].flatMap((list) => (counts?.[list] as Array<{ id: string; latest?: string }> | undefined) ?? [])
    .filter((e) => e.latest !== undefined)
    .toSorted((a, b) => tsSeconds(b.latest!) - tsSeconds(a.latest!))
    .slice(0, 10)
    .map((e) => e.id)
  const ids = [...new Set([...(selfDm === undefined ? [] : [String(selfDm['id'])]), ...recent])]
  const links: Array<Json> = []
  const relation = new Map<string, number>()
  const textForms = new Map<string, number>()
  const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
  let messages = 0
  let fromClients = 0
  let withLinks = 0
  let urlInTextElement = 0
  const bareScheme = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const walk = (node: unknown, found: (el: Json) => void) => {
    if (Array.isArray(node)) for (const item of node) walk(item, found)
    else if (node !== null && typeof node === 'object') {
      const el = node as Json
      if (typeof el['type'] === 'string' && (el['type'] === 'link' || el['type'] === 'text') && el !== undefined) found(el)
      for (const value of Object.values(el)) if (typeof value === 'object') walk(value, found)
    }
  }
  for (const channel of ids) {
    const page = await call('conversations.history', { channel, limit: 100, no_user_profile: true }, 'links')
    for (const m of (page?.['messages'] as Array<Msg> | undefined) ?? []) {
      messages++
      if (typeof m['client_msg_id'] !== 'string' || m.subtype !== undefined) continue
      fromClients++
      let has = false
      walk(m['blocks'], (el) => {
        if (el['type'] === 'text') {
          if (/(?:https?:\/\/|\b[a-z0-9-]+\.(?:com|org|net|io|dev|ai)\b)/i.test(String(el['text']))) urlInTextElement++
          return
        }
        has = true
        links.push(el)
        const url = String(el['url'])
        const text = typeof el['text'] === 'string' ? el['text'] : undefined
        const scheme = /^([a-z]+):/i.exec(url)?.[1] ?? 'none'
        if (text === undefined) add(relation, `no text, url scheme ${scheme}`)
        else if (text === url) add(relation, 'text equals url')
        else if (bareScheme(url) === text) add(relation, `text is url without ${scheme}:// (trailing slash ${url.endsWith('/') && !text.endsWith('/')})`)
        else add(relation, `text is a label, url scheme ${scheme}`)
        if (el['unsafe'] !== undefined) add(relation, 'has unsafe')
        if (el['truncated'] !== undefined) add(relation, `truncated, ${text === undefined ? 'no text' : bareScheme(url) === text ? 'text is url without scheme' : 'text is a label'}`)
      })
      if (has) withLinks++
      const mrkdwn = typeof m['text'] === 'string' ? m['text'] : ''
      for (const match of mrkdwn.matchAll(/<([^@#!][^|>]*)(?:\|([^>]*))?>/g)) {
        const url = match[1]!
        const label = match[2]
        if (label === undefined) add(textForms, '<url>')
        else if (label === url) add(textForms, '<url|url>')
        else if (bareScheme(url) === label) add(textForms, '<url|url without scheme>')
        else add(textForms, '<url|label>')
      }
      if (has && !/<[^@#!]/.test(mrkdwn)) add(textForms, 'message with link elements but no <…> in text')
    }
  }
  return {
    calls: summariseCalls(),
    selfDmRead: selfDm !== undefined,
    conversations: ids.length,
    messages,
    fromClients,
    withLinks,
    linkKeys: keyCensus(links),
    linkStyleKeys: keyCensus(links.map((l) => l['style']).filter((s) => s !== undefined)),
    relation: Object.fromEntries(relation),
    textForms: Object.fromEntries(textForms),
    urlLikeTextInTextElements: urlInTextElement,
  }
}

/** `--only reactions`: whether a message lists fewer reactors than its count, and what `reactions.get` lists. Counts only. */
async function reactionsOnly(call: Call): Promise<unknown> {
  const counts = await call('client.counts', { thread_counts_by_channel: true }, 'reactions')
  const recent = ['channels', 'mpims', 'ims'].flatMap((list) => (counts?.[list] as Array<{ id: string; latest?: string }> | undefined) ?? [])
    .filter((e) => e.latest !== undefined)
    .toSorted((a, b) => tsSeconds(b.latest!) - tsSeconds(a.latest!))
    .slice(0, 30)
    .map((e) => e.id)
  type Seen = { count: number; users: number }
  const reactionsOf = (message: Json | undefined): Array<Seen> =>
    ((message?.['reactions'] as Array<{ count?: number; users?: Array<string> }> | undefined) ?? []).map((r) => ({ count: r.count ?? 0, users: r.users?.length ?? 0 }))
  const bucket = (count: number) => (count <= 1 ? '1' : count <= 5 ? '2-5' : count <= 10 ? '6-10' : count <= 20 ? '11-20' : count <= 50 ? '21-50' : '51+')
  const histogram: Record<string, { reactions: number; truncated: number; usersLengths: Record<string, number> }> = {}
  const candidates: Array<{ channel: string; ts: string; max: number; truncated: boolean }> = []
  let messages = 0
  let withReactions = 0
  let reactions = 0
  let truncated = 0
  let largest: Seen | undefined
  // The workspace's general channel has the most members, so the largest counts: five pages of it too.
  const boot = await call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, 'reactions')
  const general = ((boot?.['channels'] as Array<Json> | undefined) ?? []).find((c) => c['is_general'] === true)?.['id']
  const pages: Array<{ channel: string; cursor?: string }> = recent.map((channel) => ({ channel }))
  if (typeof general === 'string') pages.push({ channel: general })
  let generalPages = 0
  while (pages.length > 0) {
    const { channel, cursor } = pages.shift()!
    const page = await call('conversations.history', { channel, limit: 100, no_user_profile: true, ...(cursor === undefined ? {} : { cursor }) }, 'reactions')
    const next = (page?.['response_metadata'] as { next_cursor?: string } | undefined)?.next_cursor
    if (channel === general && ++generalPages < 5 && next) pages.push({ channel, cursor: next })
    for (const m of (page?.['messages'] as Array<Msg> | undefined) ?? []) {
      messages++
      const seen = reactionsOf(m)
      if (seen.length === 0) continue
      withReactions++
      for (const r of seen) {
        reactions++
        const entry = (histogram[bucket(r.count)] ??= { reactions: 0, truncated: 0, usersLengths: {} })
        entry.reactions++
        if (r.users < r.count) {
          truncated++
          entry.truncated++
          entry.usersLengths[String(r.users)] = (entry.usersLengths[String(r.users)] ?? 0) + 1
        }
        if (largest === undefined || r.count > largest.count) largest = r
      }
      candidates.push({ channel, ts: m.ts, max: Math.max(...seen.map((r) => r.count)), truncated: seen.some((r) => r.users < r.count) })
    }
  }
  // Truncated messages first, then the largest counts.
  const picked = candidates.toSorted((a, b) => Number(b.truncated) - Number(a.truncated) || b.max - a.max).slice(0, 3)
  const gets = []
  for (const target of picked) {
    const plain = await call('reactions.get', { channel: target.channel, timestamp: target.ts }, 'reactions-get')
    const full = await call('reactions.get', { channel: target.channel, timestamp: target.ts, full: true }, 'reactions-get-full')
    const before = reactionsOf(plain?.['message'] as Json | undefined)
    const after = reactionsOf(full?.['message'] as Json | undefined)
    gets.push({
      truncatedInHistory: target.truncated,
      reactions: before.map((r, i) => ({ count: r.count, users: r.users, fullCount: after[i]?.count, fullUsers: after[i]?.users })),
    })
  }
  return {
    calls: summariseCalls(),
    rateLimits,
    conversations: recent.length,
    generalChannelPages: generalPages,
    messages,
    withReactions,
    reactions,
    truncated,
    usersAlwaysEqualCount: truncated === 0,
    largestCount: largest?.count,
    usersForLargest: largest?.users,
    byCount: histogram,
    reactionsGet: gets,
  }
}

const styleKey = (style: unknown) => (style !== null && typeof style === 'object' ? Object.keys(style).filter((k) => (style as Json)[k] === true).toSorted().join('+') : '')
const styleMarkers: Record<string, readonly [string, string]> = { bold: ['*', '*'], italic: ['_', '_'], strike: ['~', '~'], code: ['`', '`'] }

/** The census of one `rich_text` block's elements for `--only styles`: true when any is styled, a code block or a quote. */
function containerStyles(elements: ReadonlyArray<Json>, mrkdwn: string, add: (key: string) => void): boolean {
  let has = false
  elements.forEach((container, index) => {
    const kind = String(container['type'])
    const kids = (container['elements'] as Array<Json> | undefined) ?? []
    if (kind === 'rich_text_preformatted' || kind === 'rich_text_quote') {
      has = true
      add(`${kind} keys ${Object.keys(container).toSorted().join(',')}`)
      if (container['border'] !== undefined) add(`${kind} border ${String(container['border'])}`)
      add(`${kind} child types ${[...new Set(kids.map((k) => String(k['type'])))].toSorted().join(',')}`)
      const first = kids[0]
      const last = kids.at(-1)
      if (typeof first?.['text'] === 'string' && first['text'].startsWith('\n')) add(`${kind} first text starts with newline`)
      if (typeof last?.['text'] === 'string' && last['text'].endsWith('\n')) add(`${kind} last text ends with newline`)
      if (kids.some((k) => k['style'] !== undefined)) add(`${kind} has styled children ${[...new Set(kids.map((k) => styleKey(k['style'])).filter((k) => k !== ''))].join(' ')}`)
      const before = elements[index - 1]
      const beforeLast = ((before?.['elements'] as Array<Json> | undefined) ?? []).at(-1)
      if (before !== undefined) add(`${kind} after ${String(before['type'])}${typeof beforeLast?.['text'] === 'string' && beforeLast['text'].endsWith('\n') ? ' ending with newline' : ''}`)
      const after = elements[index + 1]
      const afterFirst = ((after?.['elements'] as Array<Json> | undefined) ?? [])[0]
      if (after !== undefined) add(`${kind} before ${String(after['type'])}${typeof afterFirst?.['text'] === 'string' && afterFirst['text'].startsWith('\n') ? ' starting with newline' : ''}`)
      if (kind === 'rich_text_preformatted') {
        const body = kids.map((k) => (typeof k['text'] === 'string' ? k['text'] : '')).join('')
        if (mrkdwn.includes('```' + body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '```')) add('preformatted in text as ```body```')
        else if (mrkdwn.includes('```\n')) add('preformatted in text with a newline after the opening fence')
        else add('preformatted in text in another form')
      }
    }
    if (kind === 'rich_text_quote' && !/(^|\n)&gt; ?/.test(mrkdwn)) add('quote but no &gt; line in text')
    if (kind === 'rich_text_quote' && /(^|\n)&gt; /.test(mrkdwn)) add('quote as "&gt; " in text')
    if (kind === 'rich_text_quote' && /(^|\n)&gt;[^ ]/.test(mrkdwn)) add('quote as "&gt;" without space in text')
    for (const kid of [...kids, ...kids.flatMap((k) => (k['elements'] as Array<Json> | undefined) ?? [])]) {
      const key = styleKey(kid['style'])
      if (key === '') continue
      has = true
      add(`style ${String(kid['type'])} ${key}`)
      if (kid['type'] !== 'text' || typeof kid['text'] !== 'string') continue
      const text = kid['text']
      if (/^\s/.test(text)) add(`styled text starts with whitespace ${key}`)
      if (/\s$/.test(text)) add(`styled text ends with whitespace ${key}`)
      if (text.includes('\n')) add(`styled text holds a newline ${key}`)
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const names = key.split('+')
      if (names.length === 1) {
        const [open, close] = styleMarkers[names[0]!] ?? ['', '']
        add(`${key} in text ${mrkdwn.includes(open + escaped + close) ? 'wrapped in its markers' : mrkdwn.includes(escaped) ? 'present without its markers' : 'absent'}`)
      } else {
        const at = mrkdwn.indexOf(escaped)
        add(`${key} in text ${at < 0 ? 'absent' : 'with ' + JSON.stringify(mrkdwn.slice(Math.max(0, at - 3), at).replace(/[^*_~`]/g, '.')) + ' before'}`)
      }
    }
    for (const kid of kids) {
      if (kid['type'] === 'text' && kid['style'] === undefined && typeof kid['text'] === 'string') {
        if (/(^|[\s(])\*[^*\s][^*\n]*\*(?=$|[\s).,!?])/.test(kid['text'])) add('unstyled text holding *words*')
        if (/(^|[\s(])_[^_\s][^_\n]*_(?=$|[\s).,!?])/.test(kid['text'])) add('unstyled text holding _words_')
        if (/`[^`\n]+`/.test(kid['text'])) add('unstyled text holding `words`')
      }
    }
  })
  return has
}

/** `--only styles`: how Slack's own clients encode bold, italic, strike, code, code blocks and quotes. Counts only. */
async function stylesOnly(call: Call): Promise<unknown> {
  const auth = await call('auth.test', {}, 'styles')
  const boot = await call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, 'styles')
  const counts = await call('client.counts', { thread_counts_by_channel: true }, 'styles')
  const self = String(auth?.['user_id'] ?? '')
  const selfDm = ((boot?.['ims'] as Array<Json> | undefined) ?? []).find((im) => im['user'] === self)
  const recent = ['channels', 'mpims', 'ims'].flatMap((list) => (counts?.[list] as Array<{ id: string; latest?: string }> | undefined) ?? [])
    .filter((e) => e.latest !== undefined)
    .toSorted((a, b) => tsSeconds(b.latest!) - tsSeconds(a.latest!))
    .slice(0, 25)
    .map((e) => e.id)
  const ids = [...new Set([...(selfDm === undefined ? [] : [String(selfDm['id'])]), ...recent])]
  const tally = new Map<string, number>()
  const add = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1)
  let messages = 0
  let fromClients = 0
  let styled = 0
  let blocksType = 0
  for (const channel of ids) {
    const page = await call('conversations.history', { channel, limit: 100, no_user_profile: true }, 'styles')
    for (const m of (page?.['messages'] as Array<Msg> | undefined) ?? []) {
      messages++
      if (typeof m['client_msg_id'] !== 'string' || m.subtype !== undefined) continue
      fromClients++
      const mrkdwn = typeof m['text'] === 'string' ? m['text'] : ''
      let has = false
      for (const block of (m['blocks'] as Array<Json> | undefined) ?? []) {
        add(`block ${String(block['type'])}`)
        if (block['type'] !== 'rich_text') continue
        blocksType++
        const elements = (block['elements'] as Array<Json> | undefined) ?? []
        if (containerStyles(elements, mrkdwn, add)) has = true
      }
      if (has) styled++
    }
  }
  return {
    calls: summariseCalls(),
    selfDmRead: selfDm !== undefined,
    conversations: ids.length,
    messages,
    fromClients,
    richTextBlocks: blocksType,
    styledMessages: styled,
    counts: Object.fromEntries([...tally].toSorted((a, b) => a[0].localeCompare(b[0]))),
  }
}

/** `--only usergroups`: how groups are listed and how a group mention is spelled. Counts and key names only. */
async function usergroupsOnly(call: Call): Promise<unknown> {
  const boot = await call('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true }, 'usergroups')
  const counts = await call('client.counts', { thread_counts_by_channel: true }, 'usergroups')
  const subteams = (boot?.['subteams'] ?? {}) as Json
  const listed = await call('usergroups.list', { include_disabled: true }, 'usergroups')
  const listedCount = await call('usergroups.list', { include_disabled: true, include_count: true }, 'usergroups.count')
  const groups = (listed?.['usergroups'] as Array<Json> | undefined) ?? []
  const ids = new Set(groups.map((g) => String(g['id'])))
  const self = (subteams['self'] as Array<string> | undefined) ?? []
  const recent = ['channels', 'mpims', 'ims'].flatMap((list) => (counts?.[list] as Array<{ id: string; latest?: string }> | undefined) ?? [])
    .filter((e) => e.latest !== undefined)
    .toSorted((a, b) => tsSeconds(b.latest!) - tsSeconds(a.latest!))
    .slice(0, 15)
  const mentions = { messages: 0, textLabelled: 0, textBare: 0, labelHasAt: 0, blockElements: 0, blockKeys: [] as Array<unknown>, textWithoutBlock: 0, blockWithoutText: 0, mentionedIdsListed: 0, mentionedIdsNotListed: 0 }
  const mentioned = new Set<string>()
  const walk = (node: unknown, found: Array<Json>) => {
    if (Array.isArray(node)) for (const child of node) walk(child, found)
    else if (node !== null && typeof node === 'object') {
      if ((node as Json)['type'] === 'usergroup') found.push(node as Json)
      for (const value of Object.values(node as Json)) walk(value, found)
    }
  }
  for (const entry of recent) {
    const page = await call('conversations.history', { channel: entry.id, limit: 100, no_user_profile: true }, 'usergroups')
    for (const m of (page?.['messages'] as Array<Msg> | undefined) ?? []) {
      mentions.messages++
      const text = typeof m['text'] === 'string' ? m['text'] : ''
      const inText = [...text.matchAll(/<!subteam\^([A-Z0-9]+)(\|([^>]*))?>/g)]
      for (const match of inText) {
        mentioned.add(match[1]!)
        if (match[3] === undefined) mentions.textBare++
        else {
          mentions.textLabelled++
          if (match[3].startsWith('@')) mentions.labelHasAt++
        }
      }
      const elements: Array<Json> = []
      walk(m['blocks'], elements)
      mentions.blockElements += elements.length
      for (const element of elements) if (typeof element['usergroup_id'] === 'string') mentioned.add(element['usergroup_id'])
      if (elements.length > 0) mentions.blockKeys.push(...elements)
      if (inText.length > 0 && elements.length === 0) mentions.textWithoutBlock++
      if (elements.length > 0 && inText.length === 0) mentions.blockWithoutText++
    }
  }
  for (const id of mentioned) if (ids.has(id)) mentions.mentionedIdsListed++
  else mentions.mentionedIdsNotListed++
  return {
    calls: summariseCalls(),
    bootSubteams: { keys: Object.keys(subteams).toSorted(), self: self.length, selfListed: self.filter((id) => ids.has(id)).length, all: Array.isArray(subteams['all']) ? (subteams['all'] as Array<unknown>).length : typeof subteams['all'] },
    usergroupsList: {
      ok: listed?.['ok'] ?? false,
      topLevelKeys: Object.keys(listed ?? {}).toSorted(),
      groups: groups.length,
      keys: keyCensus(groups),
      deleted: groups.filter((g) => typeof g['date_delete'] === 'number' && g['date_delete'] > 0).length,
      handleHasAt: groups.filter((g) => String(g['handle'] ?? '').startsWith('@')).length,
      emptyHandle: groups.filter((g) => !g['handle']).length,
      withUsers: groups.filter((g) => Array.isArray(g['users'])).length,
      withCountArg: { ok: listedCount?.['ok'] ?? false, withUserCount: ((listedCount?.['usergroups'] as Array<Json> | undefined) ?? []).filter((g) => typeof g['user_count'] === 'number').length },
      paged: (listed?.['response_metadata'] as Json | undefined)?.['next_cursor'] !== undefined,
    },
    mentions: { ...mentions, blockKeys: keyCensus(mentions.blockKeys) },
  }
}

/** Where `client.userBoot`'s team says photos live: host, and whether the path is bare. */
function avatarBase(boot: Json | undefined) {
  const raw = (boot?.['team'] as Json | undefined)?.['avatar_base_url']
  if (typeof raw !== 'string') return { present: false }
  try {
    const url = new URL(raw)
    return { present: true, host: url.hostname, barePath: url.pathname === '/', search: url.search !== '' }
  } catch {
    return { present: true, host: 'not-a-url' }
  }
}

/**
 * One GET of the `ca.slack-edge.com/<team>-<user>-<avatar_hash>-<size>` photo
 * for a user with a custom image and one without, with and without the
 * cookie. Status and content type only.
 */
async function avatarPhotos(users: ReadonlyArray<Json>, cookie: string) {
  const pick = (custom: boolean) => users.find((user) => (user['profile'] as Json | undefined)?.['is_custom_image'] === (custom ? true : undefined) && typeof (user['profile'] as Json | undefined)?.['avatar_hash'] === 'string')
  const out: Array<{ user: string; how: string; status: number; type: string; redirectHost: string }> = []
  for (const [label, user] of [['custom', pick(true)], ['default', pick(false)]] as const) {
    if (user === undefined) continue
    const url = `https://ca.slack-edge.com/${String(user['team_id'])}-${String(user['id'])}-${String((user['profile'] as Json)['avatar_hash'])}-72`
    for (const [how, headers] of [['none', {}], ['cookie', { cookie }]] as const) {
      const wait = lastStart + SPACING_MILLIS - Date.now()
      if (wait > 0) await sleep(wait)
      lastStart = Date.now()
      const response = await fetch(url, { headers, redirect: 'manual' })
      await response.arrayBuffer()
      const location = response.headers.get('location')
      out.push({ user: label, how, status: response.status, type: response.headers.get('content-type') ?? '', redirectHost: location === null ? '' : new URL(location, url).hostname })
    }
  }
  return out
}

/** How profile photos are spelled: which `image_*` keys are set, on which hosts, and how gravatar defaults look. Counts and hostnames only. */
function imageCensus(users: ReadonlyArray<Json>) {
  const keys = new Map<string, number>()
  const hosts = new Map<string, number>()
  const flags = { users: users.length, noProfile: 0, customImage: 0, notCustomImage: 0, customImageAbsent: 0, avatarHash: 0, image72Empty: 0, gravatarWithDefault: 0, defaultHosts: new Map<string, number>() }
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
  for (const user of users) {
    const profile = user['profile'] as Json | undefined
    if (profile === undefined) {
      flags.noProfile++
      continue
    }
    if (profile['is_custom_image'] === true) flags.customImage++
    else if (profile['is_custom_image'] === false) flags.notCustomImage++
    else flags.customImageAbsent++
    if (typeof profile['avatar_hash'] === 'string' && profile['avatar_hash'] !== '') flags.avatarHash++
    if (typeof profile['image_72'] !== 'string' || profile['image_72'] === '') flags.image72Empty++
    for (const [key, value] of Object.entries(profile)) {
      if (!key.startsWith('image_')) continue
      bump(keys, `${key}:${value === '' ? 'empty' : typeof value}`)
      if (key !== 'image_72' || typeof value !== 'string' || value === '') continue
      try {
        const url = new URL(value)
        bump(hosts, url.hostname)
        const fallback = url.searchParams.get('d')
        if (fallback !== null) {
          flags.gravatarWithDefault++
          try {
            bump(flags.defaultHosts, new URL(fallback).hostname)
          } catch {
            bump(flags.defaultHosts, 'not-a-url')
          }
        }
      } catch {
        bump(hosts, 'not-a-url')
      }
    }
  }
  return { ...flags, defaultHosts: Object.fromEntries(flags.defaultHosts), keys: Object.fromEntries([...keys].toSorted()), image72Hosts: Object.fromEntries(hosts) }
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
  return Object.fromEntries([...seen].toSorted(([a], [b]) => a.localeCompare(b)).map(([key, { n, types }]) => [key, `${n}/${objects.length} ${[...types].join('|')}`]))
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
      topKeys: Object.keys(response).toSorted(),
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
    topKeys: prefs === undefined ? undefined : Object.keys(prefs).toSorted(),
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
    console.error(['integrations', 'search2'].includes(flag('--only') ?? '') ? 'probe-live: probe failed (details suppressed)' : `probe-live: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  },
)
