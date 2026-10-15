import { Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EdgeUsersInfoResponse, isThreadRoot, Message, searchMatches } from '@juno/slack-schema'
import { CONVERSATIONS, startFakeSlack, type FakeSlack } from '../src/index.ts'
import { isType, TestClient } from './helpers.ts'

let fake: FakeSlack
let client: TestClient

beforeAll(async () => {
  fake = await startFakeSlack()
  client = new TestClient(fake)
})

afterAll(async () => {
  await fake.close()
})

describe('every fixture response decodes with @juno/slack schemas', () => {
  it('boot: userBoot, counts, prefs, socket url, edge url', async () => {
    const boot = await client.ok('client.userBoot', { version_all_channels: true, return_all_relevant_mpdms: true })
    expect(boot.self.id).toBe(fake.selfId)
    expect(boot.channels.map((c) => c.name)).toEqual(expect.arrayContaining(['eng', 'alerts-prod', 'hiring', 'leadership']))
    expect(boot.channels.find((c) => c.name === 'hiring')?.is_private).toBe(true)
    expect(boot.channels.filter((c) => c.is_mpim)).toHaveLength(1)
    expect(boot.ims).toHaveLength(2)
    expect(boot.prefs?.muted_channels).toBe('C0DEPLOYS')
    // As recorded live: every channel of the workspace, metadata only; membership and read state are in counts.
    expect(boot.channels.map((c) => c.name)).toEqual(expect.arrayContaining(['sales', 'social']))
    for (const channel of boot.channels) {
      expect(channel.is_member).toBeUndefined()
      expect(channel.last_read).toBeUndefined()
      expect(channel.latest).toBeUndefined()
      expect(channel.unread_count).toBeUndefined()
    }
    for (const im of boot.ims) expect(im.last_read).toBeUndefined()

    const counts = await client.ok('client.counts', { thread_counts_by_channel: true, org_wide_aware: true })
    const memberIds = CONVERSATIONS.filter((c) => c.members.includes(fake.selfId)).map((c) => c.id)
    expect([...counts.channels, ...counts.ims, ...counts.mpims].map((c) => c.id).toSorted()).toEqual(memberIds.toSorted())
    expect(counts.threads.timestamp).toBeUndefined()
    const eng = counts.channels.find((c) => c.id === 'C0ENG')
    expect(eng?.has_unreads).toBe(true)
    expect(counts.threads.has_unreads).toBe(true)
    expect(counts.threads.mention_count).toBeGreaterThan(0)
    expect(counts.ims.find((c) => c.id === 'D0MAYA')?.has_unreads).toBe(false)

    const prefs = await client.ok('users.prefs.get', {})
    expect(prefs.prefs.highlight_words).toBe('postgres,offsite')

    const socket = await client.ok('client.getWebSocketURL', {})
    expect(socket.primary_websocket_url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/websocket\//)

    const edge = await client.ok('api.getFlannelHttpUrl', { include_external_workspaces: true })
    expect(edge.url).toBe(`${fake.url}/edge`)
  })

  it('history for every conversation and replies for every thread', async () => {
    let roots = 0
    for (const conversation of CONVERSATIONS) {
      const history = await client.ok('conversations.history', {
        channel: conversation.id,
        limit: 100,
        ignore_replies: true,
        include_pin_count: true,
        no_user_profile: true,
      })
      expect(history.has_more).toBe(false)
      expect(history.messages.length).toBeGreaterThan(0)
      for (const message of history.messages) {
        expect(message.channel).toBe(conversation.id)
        if (!isThreadRoot(message)) continue
        roots += 1
        const replies = await client.ok('conversations.replies', { channel: conversation.id, ts: message.ts, limit: 100, inclusive: true })
        expect(replies.messages[0]?.ts).toBe(message.ts)
        expect(replies.messages).toHaveLength((message.reply_count ?? 0) + 1)
        for (const reply of replies.messages.slice(1)) expect(reply.thread_ts).toBe(message.ts)
      }
    }
    expect(roots).toBe(CONVERSATIONS.flatMap((c) => c.messages.filter((m) => m.replies !== undefined)).length)
  })

  it('messages carry rich_text blocks, mentions, quotes and reactions', async () => {
    const history = await client.ok('conversations.history', { channel: 'C0ENG', limit: 100, ignore_replies: true })
    const postgres = history.messages.find((m) => m.text?.startsWith('Draft plan'))
    expect(postgres?.reply_count).toBe(6)
    expect(postgres?.subscribed).toBe(true)
    const replies = await client.ok('conversations.replies', { channel: 'C0ENG', ts: postgres!.ts, limit: 100 })
    const quoted = replies.messages.find((m) => m.text?.startsWith('&gt; '))
    expect(quoted?.blocks?.[0]?.type).toBe('rich_text')
    const block = quoted?.blocks?.[0]
    if (block?.type !== 'rich_text') throw new Error('expected rich_text')
    expect(block.elements[0]?.type).toBe('rich_text_quote')
    const mention = replies.messages.find((m) => m.text?.includes('<@U0DEV>'))
    const section = mention?.blocks?.[0]?.type === 'rich_text' ? mention.blocks[0].elements[0] : undefined
    expect(section?.type === 'rich_text_section' && section.elements.some((e) => e.type === 'user' && e.user_id === 'U0DEV')).toBe(true)
    expect(section?.type === 'rich_text_section' && section.elements.some((e) => e.type === 'channel' && e.channel_id === 'C0PLATFORM')).toBe(true)
    const reacted = replies.messages.find((m) => m.reactions !== undefined)
    expect(reacted?.reactions?.[0]).toEqual({ name: '+1', users: ['U0TUSHAR', 'U0DEV'], count: 2 })
  })

  it('thread view, marks, subscriptions', async () => {
    const view = await client.ok('subscriptions.thread.getView', { limit: 50, fetch_threads_state: true })
    // More than one page of followed threads, so the sync has to page as it does live.
    expect(view.has_more).toBe(true)
    expect(view.threads).toHaveLength(10)
    const threads = await client.allThreadViews()
    expect(threads.length).toBeGreaterThan(10)
    const hiring = threads.find((t) => t.root_msg.channel === 'C0HIRING' && t.root_msg.reply_count === 2)
    expect(hiring?.unread_replies).toHaveLength(2)
    expect(hiring?.unread_replies?.some((m) => m.text?.includes(`<@${fake.selfId}>`))).toBe(true)
    expect(threads.some((t) => t.root_msg.text?.startsWith('checkout.spec'))).toBe(false)
    // Threads in channels self is not in are not followed.
    expect(threads.some((t) => t.root_msg.channel === 'C0SALES' || t.root_msg.channel === 'C0SOCIAL')).toBe(false)
    expect(view.threads_state?.unread_count_by_channel?.['C0HIRING']).toBe(2)

    const root = hiring!.root_msg
    const latest = root.latest_reply!
    expect(await client.ok('subscriptions.thread.mark', { channel: root.channel, thread_ts: root.thread_ts, ts: latest, read: true })).toEqual({ ok: true })
    const after = await client.allThreadViews()
    expect(after.find((t) => t.root_msg.ts === root.ts)?.unread_replies).toHaveLength(0)

    const removed = await client.ok('subscriptions.thread.remove', { channel: root.channel, thread_ts: root.thread_ts, last_read: latest })
    expect(removed.subscription?.active).toBe(false)
    const added = await client.ok('subscriptions.thread.add', { channel: root.channel, thread_ts: root.thread_ts, last_read: latest })
    expect(added.subscription?.active).toBe(true)

    expect(await client.ok('conversations.mark', { channel: 'C0ENG', ts: latest })).toEqual({ ok: true })
  })

  it('view, open, post, update, delete, reactions', async () => {
    const view = await client.ok('conversations.view', { channel: 'C0PRODUCT', count: 5 })
    expect(view.channel.id).toBe('C0PRODUCT')
    expect(view.messages?.length).toBeGreaterThan(0)

    const opened = await client.ok('conversations.open', { users: 'U0PRIYA', return_im: true })
    expect(opened.channel.is_im).toBe(true)
    expect(opened.channel.user).toBe('U0PRIYA')
    const again = await client.ok('conversations.open', { users: 'U0PRIYA', return_im: true })
    expect(again.channel.id).toBe(opened.channel.id)
    expect(again.already_open).toBe(true)

    const posted = await client.ok('chat.postMessage', { channel: opened.channel.id, text: 'hello priya', client_msg_id: 'cm-1' })
    expect(posted.message.client_msg_id).toBe('cm-1')
    expect(Schema.is(Message)(posted.message)).toBe(true)

    const updated = await client.ok('chat.update', { channel: opened.channel.id, ts: posted.ts, text: 'hello again' })
    expect(updated.message?.edited?.user).toBe(fake.selfId)
    expect(updated.text).toBe('hello again')

    expect(await client.ok('reactions.add', { channel: opened.channel.id, timestamp: posted.ts, name: 'eyes' })).toEqual({ ok: true })
    const twice = await client.call('reactions.add', { channel: opened.channel.id, timestamp: posted.ts, name: 'eyes' })
    expect(twice.body).toEqual({ ok: false, error: 'already_reacted' })
    expect(await client.ok('reactions.remove', { channel: opened.channel.id, timestamp: posted.ts, name: 'eyes' })).toEqual({ ok: true })

    const deleted = await client.ok('chat.delete', { channel: opened.channel.id, ts: posted.ts })
    expect(deleted.ts).toBe(posted.ts)
    const history = await client.ok('conversations.history', { channel: opened.channel.id })
    expect(history.messages).toHaveLength(0)
  })

  it('search answers like the live module API: items holding messages, a reply naming its thread only in the permalink', async () => {
    const result = await client.ok('search.modules.messages', { module: 'messages', query: 'is:thread', count: 100, extracts: 1, highlight: 1 })
    expect(result.items?.every((item) => item.ts === undefined && item.messages?.length === 1)).toBe(true)
    const matches = searchMatches(result)
    expect(matches.length).toBeGreaterThan(10)
    expect(matches.every((m) => m.thread_ts === undefined && m.reply_count === undefined && m.blocks === undefined && m.files === undefined)).toBe(true)
    expect(matches.filter((m) => m.permalink?.includes('?thread_ts=') === true).length).toBeGreaterThan(10)
    expect(matches.every((m) => typeof m.channel === 'object' && m.channel.id.length > 0)).toBe(true)
    const words = await client.ok('search.modules.messages', { module: 'messages', query: 'rollback in:#eng', count: 20 })
    expect(searchMatches(words).length).toBeGreaterThanOrEqual(2)
  })

  it('edge users/info returns users and failed ids', async () => {
    const raw = await client.edge('users/info', { ids: ['U0MAYA', 'U0NOBODY'] })
    const response = Schema.decodeUnknownSync(EdgeUsersInfoResponse)(raw)
    if (!response.ok) throw new Error(response.error)
    expect(response.results.map((u) => u.id)).toEqual(['U0MAYA'])
    expect(response.results[0]?.profile?.image_72).toBe(`${fake.url}/avatars/U0MAYA.svg`)
    expect(response.failed_ids).toEqual(['U0NOBODY'])
    const avatar = await fetch(response.results[0]!.profile!.image_72!)
    expect(avatar.headers.get('content-type')).toBe('image/svg+xml')
  })

  it('socket says hello and answers pings', async () => {
    const socket = await client.connect()
    const hello = await socket.next(isType('hello'))
    expect(hello.region).toBe('fake')
    socket.send({ type: 'ping', id: 16385 })
    const pong = await socket.next(isType('pong'))
    expect(pong.reply_to).toBe(16385)
    socket.send({ type: 'presence_sub', ids: ['U0MAYA', 'U0LEO'] })
    const presence = await socket.next(isType('presence_change'))
    expect(presence.users).toEqual(['U0MAYA', 'U0LEO'])
    socket.close()
  })
})
