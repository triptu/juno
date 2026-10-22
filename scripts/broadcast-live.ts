#!/usr/bin/env node
/**
 * The live broadcast check: how Slack sends an existing thread reply to the
 * channel, all inside your self-DM (research `slack-data-access.md`,
 * "Send an existing reply to the channel"). Run with
 * `JUNO_LIVE=1 pnpm broadcast:live` after `pnpm smoke:live -- --cache-session`.
 * It refuses to run without `JUNO_LIVE=1`.
 *
 * What it does, as the official client's "Send reply to this conversation"
 * menu item does it:
 * 1. Finds your self-DM, opens the socket, posts a test message there and a
 *    reply in its thread.
 * 2. Calls `chat.update { channel, ts: reply, reply_broadcast: true }`.
 * 3. Tries the same on the root, again on the broadcast reply, and on a
 *    second reply with new text as well.
 * 4. Reads Main (`conversations.history`) and the thread
 *    (`conversations.replies`) and reports the reply's shape in each.
 * 5. Deletes everything it posted.
 *
 * Writes are guarded: posts, updates and deletes go only to the self-DM,
 * and deletes only of the messages this run made. Output: methods, `ok` or
 * the error code, field names, socket frame types and whether expected
 * values matched. No token, cookie, id, name or message text is printed.
 */
import { randomUUID } from 'node:crypto'
import { readCachedSession } from './live-common.ts'

if (process.env.JUNO_LIVE !== '1') {
  console.error('broadcast-live: set JUNO_LIVE=1 to run against your real workspace.')
  process.exit(2)
}

type Json = Record<string, unknown>

const cached = await readCachedSession(process.argv.includes('--team') ? process.argv[process.argv.indexOf('--team') + 1] : undefined)
if (cached === undefined) {
  console.error('broadcast-live: no cached session. Run `JUNO_LIVE=1 pnpm smoke:live -- --cache-session` first.')
  process.exit(2)
}
const { session, cookie } = cached
const apiBase = new URL('/api/', session.workspaceUrl).toString()

const READS = new Set(['auth.test', 'client.userBoot', 'client.getWebSocketURL', 'conversations.history', 'conversations.replies'])
const WRITES = new Set(['chat.postMessage', 'chat.update', 'chat.delete'])

let selfDm: string | undefined
/** What this run made, the only messages it may update or delete. */
const made = new Set<string>()
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function call(method: string, fields: Record<string, string>): Promise<Json> {
  if (!READS.has(method)) {
    const inSelfDm = selfDm !== undefined && fields.channel === selfDm
    const own = method === 'chat.postMessage' || made.has(fields.ts ?? '')
    if (!WRITES.has(method) || !inSelfDm || !own) throw new Error(`broadcast-live: ${method} is not allowed here`)
  }
  await sleep(1200)
  const body = new FormData()
  body.append('token', session.token)
  body.append('_x_reason', 'broadcast-live')
  body.append('_x_mode', 'online')
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  const response = await fetch(`${apiBase}${method}?_x_app_name=client`, { method: 'POST', body, headers: { cookie } })
  try {
    return (await response.json()) as Json
  } catch {
    return { ok: false, error: `HTTP ${response.status}, not JSON` }
  }
}

const answer = (json: Json) => (json.ok === true ? 'ok' : `error ${String(json.error)}`)
const shape = (message: Json | undefined, rootTs: string) =>
  message === undefined
    ? 'not found'
    : {
        keys: Object.keys(message).sort(),
        subtype: message.subtype ?? null,
        threadTsIsRoot: message.thread_ts === rootTs,
        rootKeys: typeof message.root === 'object' && message.root !== null ? Object.keys(message.root).sort() : null,
        rootTsIsRoot: (message.root as Json | undefined)?.ts === rootTs,
      }

const report: Record<string, unknown> = {}
const frames: Array<Json> = []
let socket: WebSocket | undefined
try {
  const auth = await call('auth.test', {})
  const boot = await call('client.userBoot', { version_all_channels: 'false' })
  selfDm = String(((boot.ims as Array<Json> | undefined) ?? []).find((im) => im.user === auth.user_id)?.id ?? '') || undefined
  if (selfDm === undefined) throw new Error('self-DM not found')
  const channel = selfDm

  const ws = await call('client.getWebSocketURL', {})
  if (typeof ws.primary_websocket_url === 'string') {
    const url = new URL(ws.primary_websocket_url)
    url.searchParams.set('token', session.token)
    url.searchParams.set('sync_desync', '1')
    url.searchParams.set('slack_client', 'desktop')
    url.searchParams.set('no_query_on_subscribe', '1')
    url.searchParams.set('flannel', '3')
    url.searchParams.set('lazy_channels', '1')
    url.searchParams.set('batch_presence_aware', '1')
    if (typeof ws.routing_context === 'string') url.searchParams.set('gateway_server', ws.routing_context)
    // Node's WebSocket (undici) takes upgrade headers in its init object.
    socket = new WebSocket(url.toString(), { headers: { cookie, origin: 'https://app.slack.com' } } as unknown as string[])
    const hello = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15_000)
      socket?.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data)) as Json
        if (frame.type === 'hello') {
          clearTimeout(timer)
          resolve(true)
        }
        if (frame.channel !== channel && (frame.item as Json | undefined)?.channel !== channel) return
        const inner = (frame.message as Json | undefined) ?? undefined
        const previous = (frame.previous_message as Json | undefined) ?? undefined
        frames.push({
          type: frame.type,
          subtype: frame.subtype ?? null,
          keys: Object.keys(frame).sort(),
          messageSubtype: inner === undefined ? null : (inner.subtype ?? null),
          messageKeys: inner === undefined ? null : Object.keys(inner).sort(),
          previousSubtype: previous === undefined ? null : (previous.subtype ?? null),
          tsIsMade: made.has(String(frame.ts ?? inner?.ts ?? '')),
          messageTsIsMade: inner === undefined ? null : made.has(String(inner.ts ?? '')),
        })
      })
    })
    report.socketHello = await hello
  } else report.socket = answer(ws)

  const root = await call('chat.postMessage', { channel, text: 'Juno broadcast check: root', client_msg_id: randomUUID() })
  if (root.ok !== true) throw new Error(`could not post the root: ${answer(root)}`)
  const rootTs = String(root.ts)
  made.add(rootTs)
  const reply = await call('chat.postMessage', { channel, text: 'Juno broadcast check: reply', thread_ts: rootTs, client_msg_id: randomUUID() })
  if (reply.ok !== true) throw new Error(`could not post the reply: ${answer(reply)}`)
  const replyTs = String(reply.ts)
  made.add(replyTs)
  const second = await call('chat.postMessage', { channel, text: 'Juno broadcast check: second reply', thread_ts: rootTs, client_msg_id: randomUUID() })
  const secondTs = String(second.ts)
  if (second.ok === true) made.add(secondTs)
  await sleep(1500)
  const framesBefore = frames.length

  const broadcast = await call('chat.update', { channel, ts: replyTs, reply_broadcast: 'true' })
  report.broadcast = {
    answer: answer(broadcast),
    answerKeys: Object.keys(broadcast).sort(),
    answerTsIsReply: broadcast.ts === replyTs,
    answerMessage: typeof broadcast.message === 'object' ? shape(broadcast.message as Json, rootTs) : null,
  }
  await sleep(3000)
  report.framesAfterBroadcast = frames.slice(framesBefore)

  report.broadcastAgain = answer(await call('chat.update', { channel, ts: replyTs, reply_broadcast: 'true' }))
  report.broadcastRoot = answer(await call('chat.update', { channel, ts: rootTs, reply_broadcast: 'true' }))
  if (second.ok === true) {
    report.broadcastWithText = answer(await call('chat.update', { channel, ts: secondTs, reply_broadcast: 'true', text: 'Juno broadcast check: changed' }))
  }

  const history = await call('conversations.history', { channel, oldest: (Number(rootTs) - 1).toFixed(6), limit: '20', ignore_replies: 'true' })
  const main = (history.messages as Array<Json> | undefined) ?? []
  report.mainHasReply = shape(main.find((each) => each.ts === replyTs), rootTs)
  report.mainHasSecond = main.some((each) => each.ts === secondTs)
  report.mainMessagesFromRun = main.filter((each) => made.has(String(each.ts))).length
  const thread = await call('conversations.replies', { channel, ts: rootTs, limit: '20' })
  const replies = (thread.messages as Array<Json> | undefined) ?? []
  report.threadReply = shape(replies.find((each) => each.ts === replyTs), rootTs)
  report.threadSecondSubtype = replies.find((each) => each.ts === secondTs)?.subtype ?? null
  report.threadRootReplyCount = replies.find((each) => each.ts === rootTs)?.reply_count ?? null

  const framesBeforeDelete = frames.length
  report.deleteBroadcast = answer(await call('chat.delete', { channel, ts: replyTs }))
  made.delete(replyTs)
  await sleep(3000)
  report.framesAfterDelete = frames.slice(framesBeforeDelete)
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
} finally {
  const deleted: Array<string> = []
  for (const ts of [...made].reverse()) deleted.push(answer(await call('chat.delete', { channel: selfDm ?? '', ts })))
  report.cleanup = deleted
  socket?.close()
}
console.log(JSON.stringify(report, null, 2))
