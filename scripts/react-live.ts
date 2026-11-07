#!/usr/bin/env node
// Runs on Node: Bun's node:sqlite on macOS cannot open the store (docs/development.md, "Runtimes").
/**
 * The live reaction check: Juno's real reaction path (the `messages.react`
 * command, the outbox row and `ActionWorker`) against your real workspace,
 * on one message in your self-DM. Run with `JUNO_LIVE=1 bun run react:live`.
 * It refuses to run without `JUNO_LIVE=1`.
 *
 * What it does:
 * 1. Starts the whole engine on the session `smoke-live.ts --cache-session`
 *    kept, in a temporary data directory that is deleted afterwards, and
 *    waits for the boot.
 * 2. Finds your self-DM and its newest message.
 * 3. Adds, through the command, `+1`, `+1::skin-tone-2`, one custom emoji
 *    and a name Slack does not know, each waiting until its row ends, then
 *    removes them, reading `reactions.get` after each round.
 * 4. Posts a test message through Juno and reacts while it is still
 *    sending, then posts a reply in its thread and reacts to that.
 * 5. Asks Slack about a reaction at a ts no message has, then deletes the
 *    two test posts through Juno. Anything left is removed directly.
 *
 * `-- --probe-get` does none of the writes: it asks `reactions.get`
 * (read-only, the same `{channel, timestamp}` a reaction names) for up to
 * six stored messages of each kind, and counts the answers.
 *
 * Writes are guarded below the engine: every request goes through one
 * fetch that refuses any method outside the read list, allows reactions
 * and posts only in the self-DM, and deletes only of what this run posted.
 *
 * Output: methods, Slack's `ok` or error code, whether the channel and
 * timestamp were the ones meant, and the emoji's kind. No token, cookie,
 * id, name or message text is printed.
 */
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MessageChannel } from 'node:worker_threads'
import { HttpTransport } from '@juno/slack'
import { configureConnection, deleteMessage, engineStatusAtom, makeRegistry, messagesAtom, reactToMessage, sendMessage, sessionStatusAtom, type PortLike } from '@juno/state'
import { memoryHost, startEngine } from '../packages/engine/src/index.ts'
import { memoryTransport, type MessagePortLike } from '../packages/engine/src/protocol/transport.ts'
import { readCachedSession } from './live-common.ts'

if (process.env.JUNO_LIVE !== '1') {
  console.error('react-live: set JUNO_LIVE=1 to run against your real workspace.')
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
  'reactions.get',
  'emoji.list',
])
const EDGE = /\/(users\/info|users\/list|users\/search|channels\/info|channels\/search|emojis\/list)$/

const cached = await readCachedSession(process.argv.includes('--team') ? process.argv[process.argv.indexOf('--team') + 1] : undefined)
if (cached === undefined) {
  console.error('react-live: no cached session. Run `JUNO_LIVE=1 bun run smoke:live --cache-session` first.')
  process.exit(2)
}
const { session, cookie } = cached
const apiBase = new URL('/api/', session.workspaceUrl).toString()

let selfDm: string | undefined
/** The messages this run acts on: the self-DM's newest, and the ones it posts. */
const targets = new Map<string, string>()
/** What this run posted, the only messages it may delete. */
const posted = new Set<string>()
const refused = new Map<string, number>()
const calls: Array<Record<string, unknown>> = []

const UNKNOWN = 'juno_no_such_emoji_zz'
let custom: string | undefined
const nameKind = (name: string) => (name === '+1' ? 'standard' : name.includes('::skin-tone-') ? 'skin tone' : name === UNKNOWN ? 'unknown name' : name === custom ? 'custom' : 'standard')

const WRITES = new Set(['reactions.add', 'reactions.remove', 'chat.postMessage', 'chat.delete'])

/** Every request the engine makes. Reads pass; reactions and posts pass only in the self-DM, deletes only of what this run posted; anything else is refused before it leaves. */
const guarded = async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const api = /^\/api\/([^/]+)$/.exec(url.pathname)?.[1]
  const allowed = api === undefined ? EDGE.test(url.pathname) : READS.has(api)
  const headers = { ...(init?.headers as Record<string, string>), cookie }
  if (api !== undefined && WRITES.has(api)) {
    const body = init?.body as FormData
    const channel = body.get('channel')
    const ts = String(body.get('timestamp') ?? body.get('ts') ?? '')
    const call: Record<string, unknown> = { method: api, channelIsSelfDm: channel === selfDm }
    if (api.startsWith('reactions.')) Object.assign(call, { target: targets.get(ts) ?? 'unknown ts', name: nameKind(String(body.get('name'))) })
    const ok = selfDm !== undefined && channel === selfDm && (api !== 'chat.delete' || posted.has(ts))
    if (!ok) {
      call.answer = 'refused by the script'
      calls.push(call)
      throw new TypeError('react-live: refused')
    }
    const response = await fetch(input, { ...init, headers })
    try {
      const json = JSON.parse(await response.clone().text()) as { ok?: boolean; error?: string; ts?: string }
      call.answer = json.ok === true ? 'ok' : `error ${json.error}`
      if (api === 'chat.postMessage' && json.ok === true && json.ts !== undefined) posted.add(json.ts)
    } catch {
      call.answer = `HTTP ${response.status}, not JSON`
    }
    calls.push(call)
    return response
  }
  if (!allowed) {
    const key = api ?? url.pathname.split('/').slice(-2).join('/')
    refused.set(key, (refused.get(key) ?? 0) + 1)
    throw new TypeError('react-live: refused')
  }
  return fetch(input, { ...init, headers })
}

/** A Web API call made by the script itself, outside the engine: reads, a reaction on a ts no message has, and the cleanup in the self-DM. */
async function direct(method: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const inSelfDm = selfDm !== undefined && fields.channel === selfDm
  if (!READS.has(method) && !((method === 'reactions.remove' || method === 'reactions.add') && inSelfDm) && !(method === 'chat.delete' && inSelfDm && posted.has(fields.ts ?? ''))) {
    throw new Error(`react-live: ${method} is not allowed`)
  }
  const body = new FormData()
  body.append('token', session.token)
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  const response = await fetch(`${apiBase}${method}`, { method: 'POST', body, headers: { cookie } })
  return (await response.json()) as Record<string, unknown>
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function waitFor<A>(f: () => A | undefined, ms: number): Promise<A | undefined> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = f()
    if (value !== undefined) return value
    await sleep(100)
  }
  return undefined
}

const host = memoryHost()
host.onEngine((message) => {
  if (message._tag === 'requestSecrets') host.deliver({ _tag: 'secrets', id: message.id, secrets: { teamId: session.teamId, userId: session.userId, workspaceUrl: session.workspaceUrl, token: session.token, teamName: 'Live' } })
  else if (message._tag === 'handshake') host.deliver({ _tag: 'handshake', id: message.id, cookie, origin: 'https://app.slack.com', userAgent: 'Juno react live check', proxy: 'DIRECT' })
})

const userData = join(tmpdir(), `juno-react-live-${process.pid}-${Date.now()}`)
await mkdir(userData, { recursive: true })
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
const unmounts = [registry.mount(sessionStatusAtom), registry.mount(engineStatusAtom)]

const query = <A>(file: 'cache.db' | 'user.db', sql: string, ...params: Array<string>): Array<A> => {
  const dir = join(userData, 'workspaces')
  const dirs = existsSync(dir) ? readdirSync(dir) : []
  if (dirs.length !== 1) return []
  const conn = new DatabaseSync(join(dir, dirs[0]!, file), { readOnly: true })
  try {
    return conn.prepare(sql).all(...params) as Array<A>
  } finally {
    conn.close()
  }
}

const report: Record<string, unknown> = {}
try {
  const started = Date.now()
  const live = await waitFor(() => {
    const result = registry.get(engineStatusAtom)
    return result._tag === 'Success' && result.value.phase._tag === 'live' ? true : undefined
  }, 15 * 60_000)
  report.bootSeconds = Math.round((Date.now() - started) / 1000)
  if (live === undefined) throw new Error('the engine did not reach live')

  selfDm = query<{ id: string }>('cache.db', `SELECT id FROM conversations WHERE kind = 'im' AND user_id = ?`, session.userId)[0]?.id
  if (selfDm === undefined) throw new Error('no self-DM in the store')
  const dm = selfDm
  const main = `m:${dm}`
  // Open the self-DM's Main so its history is read, then take its newest message.
  unmounts.push(registry.mount(messagesAtom(main)))
  const history = await waitFor(() => query<{ ts: string }>('cache.db', `SELECT ts FROM messages WHERE channel = ? AND deleted = 0 AND thread_ts IS NULL ORDER BY ts DESC LIMIT 1`, dm)[0]?.ts, 60_000)
  if (history === undefined) throw new Error('no message in the self-DM')
  targets.set(history, 'history message')

  if (process.argv.includes('--probe-get')) {
    // Read-only: does Slack find the stored messages by the (channel, ts) a reaction would name? `reactions.get` takes the same pair.
    const rows = query<{ channel: string; ts: string; kind: string; is_member: number; position: string; subtype: string; mine: number }>(
      'cache.db',
      `SELECT m.channel, m.ts, c.kind, c.is_member,
         CASE WHEN m.thread_ts IS NULL THEN 'plain' WHEN m.thread_ts = m.ts THEN 'root' ELSE 'reply' END AS position,
         CASE WHEN m.subtype IS NULL THEN 'none' WHEN m.subtype IN ('thread_broadcast', 'bot_message', 'file_share', 'channel_join', 'huddle_thread') THEN m.subtype ELSE 'other' END AS subtype,
         CASE WHEN m.user_id = ? THEN 1 ELSE 0 END AS mine
       FROM messages m LEFT JOIN conversations c ON c.id = m.channel WHERE m.deleted = 0 ORDER BY random()`,
      session.userId,
    )
    const buckets = new Map<string, Array<(typeof rows)[number]>>()
    for (const row of rows) {
      const key = `${row.kind ?? 'unknown conversation'} ${row.is_member === 1 ? 'member' : 'not member'} ${row.position} ${row.subtype} ${row.mine === 1 ? 'own' : 'others'}`
      const list = buckets.get(key) ?? []
      if (list.length < 6) list.push(row)
      buckets.set(key, list)
    }
    const results: Record<string, Record<string, number>> = {}
    for (const [key, list] of buckets) {
      for (const row of list) {
        const answer = await direct('reactions.get', { channel: row.channel, timestamp: row.ts })
        const code = answer.ok === true ? 'ok' : String(answer.error)
        results[key] = { ...results[key], [code]: (results[key]?.[code] ?? 0) + 1 }
        await sleep(800)
      }
    }
    report.storedMessages = rows.length
    report.reactionsGetByKind = results
    throw new Error('probe done')
  }

  const emoji = await direct('emoji.list', {})
  const customs = Object.entries((emoji.emoji ?? {}) as Record<string, string>).filter(([, value]) => !value.startsWith('alias:'))
  report.emojiList = emoji.ok === true ? `ok, ${customs.length} custom` : `error ${emoji.error}`
  custom = customs[0]?.[0]

  const names = ['+1', '+1::skin-tone-2', ...(custom === undefined ? [] : [custom])]
  const rowsLeft = () => query<{ attempts: number; last_error: string | null; depends_on: string | null }>('user.db', `SELECT attempts, last_error, depends_on FROM outbox WHERE kind = 'react'`)
  const settle = async () => {
    const asked = Date.now()
    const done = await waitFor(() => (rowsLeft().length === 0 ? true : undefined), 60_000)
    return done === true ? `row ended in ${Date.now() - asked} ms` : `row still waiting: ${JSON.stringify(rowsLeft().map((row) => ({ ...row, depends_on: row.depends_on !== null })))}`
  }
  const slackMine = async (ts: string) => {
    const answer = await direct('reactions.get', { channel: dm, timestamp: ts, full: 'true' })
    if (answer.ok !== true) return `error ${answer.error}`
    const reactions = (answer.message as { reactions?: Array<{ name: string; users?: Array<string> }> } | undefined)?.reactions ?? []
    return reactions.filter((r) => r.users?.includes(session.userId) && (names.includes(r.name) || r.name === UNKNOWN)).map((r) => nameKind(r.name))
  }
  const react = async (ts: string, name: string, on: boolean) => {
    const exit = await reactToMessage(registry, { channelId: dm, ts }, name, on)
    return { target: targets.get(ts), name: nameKind(name), on, command: exit._tag, outbox: await settle() }
  }

  // 1. A message from history: add each kind, a name Slack does not know, then remove.
  const steps: Array<unknown> = []
  for (const name of [...names, UNKNOWN]) steps.push(await react(history, name, true))
  report.historyAdds = steps.splice(0)
  report.historySlackAfterAdd = await slackMine(history)
  for (const name of names) steps.push(await react(history, name, false))
  report.historyRemoves = steps.splice(0)
  report.historySlackAfterRemove = await slackMine(history)

  // 2. A post Juno makes, reacted to while it is still sending (the row depends on it), and again once stored.
  // The post's id: from its pending row, or, when it was already sent, from the stored message with this run's text.
  const newestPost = (text: string) =>
    query<{ client_msg_id: string }>('user.db', `SELECT client_msg_id FROM pending_messages ORDER BY rowid DESC LIMIT 1`)[0]?.client_msg_id ??
    query<{ client_msg_id: string }>('cache.db', `SELECT client_msg_id FROM messages WHERE channel = ? AND text = ? ORDER BY ts DESC LIMIT 1`, dm, text)[0]?.client_msg_id
  report.postCommand = (await sendMessage(registry, { kind: 'channel', channelId: dm }, 'Juno reaction check'))._tag
  report.postStillPendingWhenReacted = query('user.db', `SELECT 1 FROM pending_messages`).length > 0
  const clientMsgId = newestPost('Juno reaction check')
  if (clientMsgId === undefined) throw new Error('the post was not queued')
  const early = await reactToMessage(registry, { channelId: dm, ts: `pending:${clientMsgId}`, clientMsgId }, '+1', true)
  report.reactWhileSending = { command: early._tag, outbox: await settle() }
  const own = await waitFor(() => query<{ ts: string }>('cache.db', `SELECT ts FROM messages WHERE channel = ? AND client_msg_id = ?`, dm, clientMsgId)[0]?.ts, 60_000)
  if (own === undefined) throw new Error('the post was not stored')
  targets.set(own, 'own new post')
  report.ownSlackAfterEarly = await slackMine(own)
  steps.push(await react(own, 'eyes', true))
  steps.push(await react(own, 'eyes', false))
  steps.push(await react(own, '+1', false))
  report.ownSteps = steps.splice(0)
  report.ownSlackAfter = await slackMine(own)

  // 3. A reply in that thread, posted by Juno, reacted to once stored.
  report.replyCommand = (await sendMessage(registry, { kind: 'channel', channelId: dm, threadTs: own }, 'Juno reaction check reply'))._tag
  const replyId = newestPost('Juno reaction check reply')
  if (replyId === undefined) throw new Error('the reply was not queued')
  const reply = await waitFor(() => query<{ ts: string }>('cache.db', `SELECT ts FROM messages WHERE channel = ? AND client_msg_id = ?`, dm, replyId)[0]?.ts, 60_000)
  if (reply === undefined) throw new Error('the reply was not stored')
  targets.set(reply, 'thread reply')
  steps.push(await react(reply, '+1', true))
  report.replySlackAfterAdd = await slackMine(reply)
  steps.push(await react(reply, '+1', false))
  report.replySteps = steps.splice(0)

  // 4. What Slack answers for a ts no message has, the answer the worker counts as done.
  const missing = await direct('reactions.add', { channel: dm, timestamp: '1000000000.000100', name: '+1' })
  report.unknownTsAnswer = missing.ok === true ? 'ok' : `error ${missing.error}`

  // Cleanup: the two posts go, through Juno.
  for (const ts of [reply, own]) report[`delete ${targets.get(ts)}`] = (await deleteMessage(registry, { channelId: dm, ts }))._tag
  await waitFor(() => (query('user.db', `SELECT id FROM outbox`).length === 0 ? true : undefined), 60_000)
} catch (error) {
  report.failed = error instanceof Error ? error.message : 'unknown'
} finally {
  report.calls = calls
  report.refusedByGuard = Object.fromEntries(refused)
  // Cleanup: anything of ours left on the message goes.
  if (selfDm !== undefined && !process.argv.includes('--probe-get')) {
    const leftover: Array<string> = []
    for (const ts of targets.keys()) {
      for (const name of ['+1', '+1::skin-tone-2', 'eyes', ...(custom === undefined ? [] : [custom])]) {
        const answer = await direct('reactions.remove', { channel: selfDm, timestamp: ts, name })
        if (answer.ok === true) leftover.push(`${targets.get(ts)}: ${nameKind(name)}`)
      }
    }
    for (const ts of posted) {
      const answer = await direct('chat.delete', { channel: selfDm, ts })
      if (answer.ok === true) leftover.push('a post')
    }
    report.cleanupRemoved = leftover
  }
  for (const unmount of unmounts) unmount()
  registry.dispose()
  await handle.stop()
  await rm(userData, { recursive: true, force: true })
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}
