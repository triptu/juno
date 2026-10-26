#!/usr/bin/env bun
/**
 * The live check of Slackbot's "you mentioned people who are not in this
 * channel" message and its buttons (research `integration-shapes.md`,
 * "Buttons on a Slackbot message"). Run with `JUNO_LIVE=1 bun
 * scripts/ephemeral-live.ts` after `bun run smoke:live --cache-session`. It
 * refuses to run without `JUNO_LIVE=1`.
 *
 * What it does:
 * 1. Finds or creates the private test channel `juno-ephemeral-test` and
 *    opens the socket.
 * 2. Posts a message there that mentions one workspace member who is not in
 *    it. The channel is private, so that person is not told. `--user <id>`
 *    picks the person.
 * 3. Waits for Slackbot's ephemeral message on the socket and reports its
 *    shape and its buttons.
 * 4. Clicks Dismiss as the official client does (`chat.attachmentAction`)
 *    and reports the answer and the frames that follow. `--add-them` clicks
 *    Add them instead, which adds the person to the channel; it needs
 *    `--user`, someone who agreed to that. `--no-service-id` leaves out
 *    `service_id`.
 * 5. Deletes its own post.
 *
 * It never clicks Let Them Know, which messages the person.
 * Writes are guarded: posts, deletes and button clicks go only to the test
 * channel, and deletes only of the messages this run made. Output: methods,
 * `ok` or the error code, field names, button names and labels, and frame
 * types. No token, cookie, id, name or message text is printed.
 */
import { randomUUID } from 'node:crypto'
import { readCachedSession } from './live-common.ts'

if (process.env.JUNO_LIVE !== '1') {
  console.error('ephemeral-live: set JUNO_LIVE=1 to run against your real workspace.')
  process.exit(2)
}

type Json = Record<string, unknown>

const CHANNEL_NAME = 'juno-ephemeral-test'
const argument = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const chosenUser = argument('--user')
const addThem = process.argv.includes('--add-them')
if (addThem && chosenUser === undefined) {
  console.error('ephemeral-live: --add-them needs --user <id>, a person who agreed to be added to the test channel.')
  process.exit(2)
}
const cached = await readCachedSession(argument('--team'))
if (cached === undefined) {
  console.error('ephemeral-live: no cached session. Run `JUNO_LIVE=1 bun run smoke:live --cache-session` first.')
  process.exit(2)
}
const { session, cookie } = cached
const apiBase = new URL('/api/', session.workspaceUrl).toString()

const READS = new Set(['auth.test', 'client.getWebSocketURL', 'users.list', 'users.conversations', 'conversations.history'])
const WRITES = new Set(['chat.postMessage', 'chat.delete', 'chat.attachmentAction'])

let testChannel: string | undefined
const made = new Set<string>()
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function call(method: string, fields: Record<string, string>): Promise<Json> {
  if (!READS.has(method) && method !== 'conversations.create') {
    const inChannel = testChannel !== undefined && (fields.channel === testChannel || (method === 'chat.attachmentAction' && JSON.parse(fields.payload ?? '{}').channel_id === testChannel))
    const own = method !== 'chat.delete' || made.has(fields.ts ?? '')
    if (!WRITES.has(method) || !inChannel || !own) throw new Error(`ephemeral-live: ${method} is not allowed here`)
  }
  if (method === 'conversations.create' && (fields.name !== CHANNEL_NAME || fields.is_private !== 'true')) throw new Error('ephemeral-live: only the private test channel may be created')
  await sleep(1200)
  const body = new FormData()
  body.append('token', session.token)
  body.append('_x_reason', 'ephemeral-live')
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
const ids = (text: unknown) => (typeof text === 'string' ? text.replace(/[UWBC][A-Z0-9]{6,}/g, 'ID') : text)
const keys = (value: unknown) => (value !== null && typeof value === 'object' ? Object.keys(value).toSorted() : null)
const buttons = (attachment: Json) =>
  ((attachment.actions as Array<Json> | undefined) ?? []).map((action) => ({ keys: keys(action), name: action.name, text: action.text, type: action.type, style: action.style ?? null, value: ids(action.value), hasConfirm: action.confirm !== undefined }))
const describe = (message: Json | undefined) =>
  message === undefined
    ? null
    : {
        keys: keys(message),
        subtype: message.subtype ?? null,
        user: message.user === 'USLACKBOT' ? 'USLACKBOT' : message.user === undefined ? null : 'other',
        isEphemeral: message.is_ephemeral ?? null,
        tsIsMade: made.has(String(message.ts ?? '')),
        attachments: ((message.attachments as Array<Json> | undefined) ?? []).map((attachment) => ({
          keys: keys(attachment),
          id: attachment.id ?? null,
          callbackId: ids(attachment.callback_id),
          fallback: attachment.fallback === undefined ? null : 'present',
          buttons: buttons(attachment),
        })),
        blocks: ((message.blocks as Array<Json> | undefined) ?? []).map((block) => block.type),
      }

const report: Record<string, unknown> = {}
const frames: Array<Json> = []
let ephemeral: Json | undefined
let socket: WebSocket | undefined
try {
  const auth = await call('auth.test', {})
  const mine = await call('users.conversations', { types: 'private_channel', limit: '1000', exclude_archived: 'true' })
  testChannel = String(((mine.channels as Array<Json> | undefined) ?? []).find((each) => each.name === CHANNEL_NAME)?.id ?? '') || undefined
  if (testChannel === undefined) {
    const created = await call('conversations.create', { name: CHANNEL_NAME, is_private: 'true' })
    report.created = answer(created)
    testChannel = String((created.channel as Json | undefined)?.id ?? '') || undefined
  }
  if (testChannel === undefined) throw new Error('no test channel')
  const channel = testChannel

  const people = chosenUser === undefined ? await call('users.list', { limit: '200' }) : { members: [{ id: chosenUser }] }
  const target = ((people.members as Array<Json> | undefined) ?? []).find(
    (each) => each.id !== auth.user_id && each.id !== 'USLACKBOT' && each.deleted !== true && each.is_bot !== true && each.is_app_user !== true && each.is_restricted !== true && each.is_ultra_restricted !== true,
  )
  if (target === undefined) throw new Error('no one to mention')

  const ws = await call('client.getWebSocketURL', {})
  if (typeof ws.primary_websocket_url !== 'string') throw new Error(`socket: ${answer(ws)}`)
  const url = new URL(ws.primary_websocket_url)
  url.searchParams.set('token', session.token)
  url.searchParams.set('sync_desync', '1')
  url.searchParams.set('slack_client', 'desktop')
  url.searchParams.set('no_query_on_subscribe', '1')
  url.searchParams.set('flannel', '3')
  url.searchParams.set('lazy_channels', '1')
  url.searchParams.set('batch_presence_aware', '1')
  if (typeof ws.routing_context === 'string') url.searchParams.set('gateway_server', ws.routing_context)
  socket = new WebSocket(url.toString(), { headers: { cookie, origin: 'https://app.slack.com' } } as unknown as string[])
  report.socketHello = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 15_000)
    socket?.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as Json
      if (frame.type === 'hello') {
        clearTimeout(timer)
        resolve(true)
      }
      if (frame.channel !== channel) return
      const inner = frame.message as Json | undefined
      if (frame.type === 'message' && frame.is_ephemeral === true && ephemeral === undefined) ephemeral = frame
      frames.push({
        type: frame.type,
        subtype: frame.subtype ?? null,
        keys: keys(frame),
        frame: frame.type === 'message' && frame.is_ephemeral === true ? describe(frame) : null,
        message: describe(inner),
        previous: describe(frame.previous_message as Json | undefined),
        deletedTsIsEphemeral: frame.deleted_ts === undefined ? null : frame.deleted_ts === ephemeral?.ts,
        tsIsEphemeral: frame.ts === undefined ? null : frame.ts === ephemeral?.ts,
      })
    })
  })

  const post = await call('chat.postMessage', { channel, text: `Juno ephemeral check <@${String(target.id)}>`, client_msg_id: randomUUID() })
  if (post.ok !== true) throw new Error(`could not post: ${answer(post)}`)
  made.add(String(post.ts))
  for (let i = 0; i < 20; i++) {
    if (ephemeral !== undefined) break
    await sleep(500)
  }
  report.framesAfterPost = [...frames]
  if (ephemeral === undefined) throw new Error('no ephemeral message arrived')
  report.ephemeralTsAfterPost = Number(ephemeral.ts) > Number(post.ts)
  report.ephemeralThreadTs = ephemeral.thread_ts === undefined ? null : ephemeral.thread_ts === post.ts ? 'post' : 'other'

  const history = await call('conversations.history', { channel, limit: '5' })
  report.ephemeralInHistory = ((history.messages as Array<Json> | undefined) ?? []).some((each) => each.ts === ephemeral?.ts)

  const attachment = ((ephemeral.attachments as Array<Json> | undefined) ?? [])[0]
  const wanted = addThem ? /^(invite|add them)$/i : /^(ignore|dismiss)$/i
  const button = ((attachment?.actions as Array<Json> | undefined) ?? []).find((action) => wanted.test(String(action.name ?? '')) || wanted.test(String(action.text ?? '')))
  if (attachment === undefined || button === undefined) throw new Error(`no ${addThem ? 'Add them' : 'Dismiss'} button`)
  const payload = {
    actions: [button],
    attachment_id: String(attachment.id),
    callback_id: attachment.callback_id,
    channel_id: channel,
    is_ephemeral: true,
    message_ts: ephemeral.ts,
    prompt_app_install: false,
  }
  const framesBefore = frames.length
  const clicked = await call('chat.attachmentAction', {
    payload: JSON.stringify(payload),
    client_token: `web-${Date.now()}`,
    ...(typeof ephemeral.bot_id === 'string' && !process.argv.includes('--no-service-id') ? { service_id: ephemeral.bot_id } : {}),
    bot_user_id: String(ephemeral.user ?? ''),
  })
  report.click = { button: button.name, answer: answer(clicked), keys: keys(clicked), replaced: clicked.replaced ?? null, deleted: clicked.deleted ?? null }
  await sleep(4000)
  report.framesAfterClick = frames.slice(framesBefore)
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
} finally {
  const deleted: Array<string> = []
  for (const ts of [...made].toReversed()) deleted.push(answer(await call('chat.delete', { channel: testChannel ?? '', ts })))
  report.cleanup = deleted
  socket?.close()
}
console.log(JSON.stringify(report, null, 2))
