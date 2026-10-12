import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isMessagePosted, isMessageReplied, type MessagePostedEvent, type RtmFrame } from '@juno/slack/schemas'
import { startFakeSlack, type FakeSlack } from '../src/index.ts'
import { isType, TestClient, type SocketClient } from './helpers.ts'

let fake: FakeSlack
let client: TestClient
let socket: SocketClient

const isPosted = (frame: RtmFrame): frame is MessagePostedEvent => isMessagePosted(frame) && frame.subtype === undefined

beforeAll(async () => {
  fake = await startFakeSlack()
  client = new TestClient(fake)
  socket = await client.connect()
  await socket.next(isType('hello'))
})

afterAll(async () => {
  socket.close()
  await fake.close()
})

describe('posting', () => {
  it('echoes a posted message on the socket with the same client_msg_id and ts', async () => {
    const posted = await client.ok('chat.postMessage', {
      channel: 'C0ENG',
      text: 'Deploy window is 2pm',
      blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Deploy window is 2pm' }] }] }],
      client_msg_id: 'uuid-echo-1',
    })
    const echo = await socket.next(isMessagePosted)
    expect(echo.client_msg_id).toBe('uuid-echo-1')
    expect(echo.ts).toBe(posted.ts)
    expect(echo.channel).toBe('C0ENG')
    expect(echo.user).toBe(fake.selfId)
    expect(echo.blocks).toEqual(posted.message.blocks)
    // Posting marks the channel read for the sender.
    const counts = await client.ok('client.counts', {})
    expect(counts.channels.find((c) => c.id === 'C0ENG')?.has_unreads).toBe(false)
  })

  it('a reply emits the reply and a message_replied for the root', async () => {
    const history = await client.ok('conversations.history', { channel: 'C0INCIDENTS', limit: 10 })
    const root = history.messages.find((m) => (m.reply_count ?? 0) > 0)!
    const before = root.reply_count ?? 0
    const posted = await client.ok('chat.postMessage', { channel: 'C0INCIDENTS', thread_ts: root.ts, text: 'Postmortem is up.', client_msg_id: 'uuid-reply-1' })
    expect(posted.message.thread_ts).toBe(root.ts)
    const echo = await socket.next((f): f is MessagePostedEvent => isPosted(f) && f.client_msg_id === 'uuid-reply-1')
    expect(echo.thread_ts).toBe(root.ts)
    expect(echo.parent_user_id).toBe(root.user)
    const replied = await socket.next(isMessageReplied)
    expect(replied.message.ts).toBe(root.ts)
    expect(replied.message.reply_count).toBe(before + 1)
    expect(replied.message.latest_reply).toBe(posted.ts)
  })

  it('a broadcast reply carries the root', async () => {
    const history = await client.ok('conversations.history', { channel: 'C0PLATFORM', limit: 10 })
    const root = history.messages.find((m) => (m.reply_count ?? 0) > 0)!
    await client.ok('chat.postMessage', { channel: 'C0PLATFORM', thread_ts: root.ts, reply_broadcast: true, text: 'FYI all', client_msg_id: 'uuid-bc-1' })
    const echo = await socket.next((f): f is MessagePostedEvent => isMessagePosted(f) && f.subtype === 'thread_broadcast')
    expect(echo.root?.ts).toBe(root.ts)
    const main = await client.ok('conversations.history', { channel: 'C0PLATFORM', limit: 1, ignore_replies: true })
    expect(main.messages[0]?.subtype).toBe('thread_broadcast')
  })

  it('a message from someone else in a DM arrives with a desktop_notification', async () => {
    const injected = fake.injectMessage({ channel: 'D0MAYA', user: 'U0MAYA', text: 'got a minute?' })
    const message = await socket.next((f): f is MessagePostedEvent => isPosted(f) && f.ts === injected.ts)
    expect(message.user).toBe('U0MAYA')
    const notification = await socket.next(isType('desktop_notification'))
    expect(notification.channel).toBe('D0MAYA')
    expect(notification.msg).toBe(injected.ts)
    expect(notification.content).toBe('got a minute?')
    const counts = await client.ok('client.counts', {})
    const dm = counts.ims.find((c) => c.id === 'D0MAYA')
    expect(dm?.has_unreads).toBe(true)
    expect(dm?.mention_count).toBe(1)
  })

  it('a mention in a channel notifies, a plain message does not', async () => {
    const mention = fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: `<@${fake.selfId}> can you review?` })
    const notification = await socket.next(isType('desktop_notification'))
    expect(notification.msg).toBe(mention.ts)
    expect(notification.subtitle).toBe('Leo Park in #eng')
    const plain = fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'just a note' })
    await socket.next((f) => isPosted(f) && f.ts === plain.ts)
    expect(socket.frames.filter((f) => f.type === 'desktop_notification')).toHaveLength(0)
  })

  it('rejects an empty message and a reply to a missing thread', async () => {
    const empty = await client.call('chat.postMessage', { channel: 'C0ENG', text: '', client_msg_id: 'x' })
    expect(empty.body).toEqual({ ok: false, error: 'no_text' })
    const missing = await client.call('chat.postMessage', { channel: 'C0ENG', thread_ts: '1000000000.000001', text: 'hi', client_msg_id: 'y' })
    expect(missing.body).toEqual({ ok: false, error: 'thread_not_found' })
    const notMember = await client.call('chat.postMessage', { channel: 'C0NOPE', text: 'hi', client_msg_id: 'z' })
    expect(notMember.body).toEqual({ ok: false, error: 'channel_not_found' })
  })
})
