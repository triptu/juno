#!/usr/bin/env node
/**
 * The live forward check: what `chat.shareMessage` does in your real
 * workspace, all inside your self-DM (research `slack-forward.md`). Run with
 * `JUNO_LIVE=1 pnpm forward:live` after `pnpm smoke:live -- --cache-session`.
 * It refuses to run without `JUNO_LIVE=1`.
 *
 * What it does, as the official client's Forward dialog does it:
 * 1. Finds your self-DM, posts a test message there and a reply in its thread.
 * 2. Forwards the message to the self-DM with a note, then without one,
 *    then forwards the reply, each with a new `client_msg_id`.
 * 3. Tries a forward to your user id instead of a conversation id, and one
 *    of a ts no message has.
 * 4. Reads the self-DM's history and reports the shape of each forward.
 * 5. Deletes everything it posted.
 *
 * Writes are guarded: posts, forwards and deletes go only to the self-DM,
 * and deletes only of what this run made. Output: methods, `ok` or the
 * error code, field names and whether expected values matched. No token,
 * cookie, id, name or message text is printed.
 */
import { randomUUID } from 'node:crypto'
import { readCachedSession } from './live-common.ts'

if (process.env.JUNO_LIVE !== '1') {
  console.error('forward-live: set JUNO_LIVE=1 to run against your real workspace.')
  process.exit(2)
}

type Json = Record<string, unknown>

const cached = await readCachedSession(process.argv.includes('--team') ? process.argv[process.argv.indexOf('--team') + 1] : undefined)
if (cached === undefined) {
  console.error('forward-live: no cached session. Run `JUNO_LIVE=1 pnpm smoke:live -- --cache-session` first.')
  process.exit(2)
}
const { session, cookie } = cached
const apiBase = new URL('/api/', session.workspaceUrl).toString()

const READS = new Set(['auth.test', 'client.userBoot', 'conversations.history', 'conversations.replies'])
const WRITES = new Set(['chat.postMessage', 'chat.shareMessage', 'chat.delete'])

let selfDm: string | undefined
/** What this run made, the only messages it may delete. */
const made = new Set<string>()
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function call(method: string, fields: Record<string, string>): Promise<Json> {
  if (!READS.has(method)) {
    const inSelfDm = selfDm !== undefined && fields.channel === selfDm && (method !== 'chat.shareMessage' || fields.share_channel === selfDm || fields.share_channel === session.userId)
    if (!WRITES.has(method) || !inSelfDm || (method === 'chat.delete' && !made.has(fields.ts ?? ''))) throw new Error(`forward-live: ${method} is not allowed here`)
  }
  await sleep(1200)
  const body = new FormData()
  body.append('token', session.token)
  body.append('_x_reason', method === 'chat.shareMessage' ? 'sendShareMessage' : 'forward-live')
  body.append('_x_mode', 'online')
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  const response = await fetch(`${apiBase}${method}?_x_app_name=client`, { method: 'POST', body, headers: { cookie } })
  try {
    return (await response.json()) as Json
  } catch {
    return { ok: false, error: `HTTP ${response.status}, not JSON` }
  }
}

const words = (text: string) => JSON.stringify([{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }] }])
const answer = (json: Json) => (json.ok === true ? 'ok' : `error ${String(json.error)}`)

const report: Record<string, unknown> = {}
try {
  const auth = await call('auth.test', {})
  const boot = await call('client.userBoot', { version_all_channels: 'false' })
  selfDm = String(((boot.ims as Array<Json> | undefined) ?? []).find((im) => im.user === auth.user_id)?.id ?? '') || undefined
  if (selfDm === undefined) throw new Error('self-DM not found')
  const channel = selfDm
  const before = (Date.now() / 1000 - 5).toFixed(6)

  const source = await call('chat.postMessage', { channel, text: 'Juno forward check: source', client_msg_id: randomUUID() })
  if (source.ok !== true) throw new Error(`could not post the source: ${answer(source)}`)
  const sourceTs = String(source.ts)
  made.add(sourceTs)
  const reply = await call('chat.postMessage', { channel, text: 'Juno forward check: reply', thread_ts: sourceTs, client_msg_id: randomUUID() })
  const replyTs = String(reply.ts)
  if (reply.ok === true) made.add(replyTs)

  const forwards: Array<{ name: string; id: string; ts?: string }> = []
  const share = async (name: string, fields: Record<string, string>) => {
    const id = randomUUID()
    const json = await call('chat.shareMessage', { channel, client_msg_id: id, text: '', ...fields })
    const ts = typeof json.ts === 'string' ? json.ts : undefined
    if (ts !== undefined) made.add(ts)
    report[name] = {
      answer: answer(json),
      answerKeys: Object.keys(json).sort(),
      answerChannelIsSelfDm: json.channel === channel,
      answerHasMessage: typeof json.message === 'object',
    }
    if (json.ok === true) forwards.push({ name, id, ...(ts === undefined ? {} : { ts }) })
  }
  await share('withNote', { timestamp: sourceTs, share_channel: channel, blocks: words('Juno forward check: note') })
  await share('withoutNote', { timestamp: sourceTs, share_channel: channel })
  if (reply.ok === true) await share('reply', { timestamp: replyTs, share_channel: channel })
  await share('toUserId', { timestamp: sourceTs, share_channel: session.userId })
  await share('missingTs', { timestamp: '1000000000.000100', share_channel: channel })

  await sleep(2000)
  const history = await call('conversations.history', { channel, oldest: before, limit: '50' })
  const messages = (history.messages as Array<Json> | undefined) ?? []
  for (const forward of forwards) {
    const message = messages.find((each) => each.ts === forward.ts) ?? messages.find((each) => each.client_msg_id === forward.id)
    if (message === undefined) {
      report[`${forward.name}Stored`] = 'not found in history'
      continue
    }
    if (typeof message.ts === 'string') made.add(message.ts)
    const attachments = (message.attachments as Array<Json> | undefined) ?? []
    const first = attachments[0] ?? {}
    const blocks = (first.message_blocks as Array<Json> | undefined)?.[0]
    const footer = typeof first.footer === 'string' ? first.footer : undefined
    report[`${forward.name}Stored`] = {
      messageKeys: Object.keys(message).sort(),
      subtype: message.subtype ?? null,
      clientMsgIdEchoed: message.client_msg_id === forward.id,
      textEmpty: message.text === '',
      hasTopBlocks: Array.isArray(message.blocks),
      attachmentCount: attachments.length,
      attachmentKeys: Object.keys(first).sort(),
      isShare: first.is_share ?? null,
      isMsgUnfurl: first.is_msg_unfurl ?? null,
      isReplyUnfurl: first.is_reply_unfurl ?? null,
      attachmentTsIsSource: first.ts === sourceTs || first.ts === replyTs,
      attachmentThreadTsIsSource: first.thread_ts === undefined ? null : first.thread_ts === sourceTs,
      channelIdIsSelfDm: first.channel_id === channel,
      authorIdIsSelf: first.author_id === auth.user_id,
      fromUrlHasThreadTs: typeof first.from_url === 'string' ? first.from_url.includes('thread_ts=') : null,
      footerKind: footer === undefined ? null : footer.startsWith('Posted in') ? 'Posted in …' : footer.startsWith('Thread in') ? 'Thread in …' : /conversation/i.test(footer) ? '… conversation' : /direct message/i.test(footer) ? '… direct message' : 'other',
      messageBlocksKeys: blocks === undefined ? null : Object.keys(blocks).sort(),
      color: first.color ?? null,
    }
  }
  if (reply.ok === true) {
    const thread = await call('conversations.replies', { channel, ts: sourceTs, limit: '20' })
    report.replyCountAfter = ((thread.messages as Array<Json> | undefined) ?? []).length - 1
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
} finally {
  const deleted: Array<string> = []
  for (const ts of [...made].reverse()) deleted.push(answer(await call('chat.delete', { channel: selfDm ?? '', ts })))
  report.cleanup = deleted
}
console.log(JSON.stringify(report, null, 2))
