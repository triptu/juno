import { afterEach, describe, expect, it } from 'vitest'
import { messagesSend, newChatConversations, newChatThreads, type PickConversations, type PickThread } from '@juno/contract'
import { liveQuery, runCommand } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, bootedEngine, readDb, valueOf } from './scenario'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

function valueUntil<A>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], predicate: (value: A) => boolean, label: string): Promise<A> {
  unmounts.push(engine.registry.mount(atom))
  return waitFor(() => {
    const result = engine.registry.get(atom) as { _tag: string; value?: A }
    return result._tag === 'Success' && predicate(result.value as A) ? { value: result.value as A } : undefined
  }, WAIT_MS, label).then((found) => found.value)
}

const conversations = (engine: RunningEngine, query: string, predicate: (value: PickConversations) => boolean = () => true) =>
  valueUntil<PickConversations>(engine, liveQuery(newChatConversations)({ query }), predicate, `conversations "${query}"`)

const threads = (engine: RunningEngine, payload: { channel?: string; query: string }, predicate: (value: ReadonlyArray<PickThread>) => boolean = () => true) =>
  valueUntil<ReadonlyArray<PickThread>>(engine, liveQuery(newChatThreads)(payload), predicate, `threads ${JSON.stringify(payload)}`)

describe('New chat', () => {
  it('lists recent conversations, then people and channels that match, with people never messaged', async () => {
    const engine = await bootedEngine(engines)
    const recent = await conversations(engine, '')
    expect(recent.recent.length).toBeGreaterThan(0)
    expect(recent.recent.length).toBeLessThanOrEqual(8)
    expect(recent.people).toEqual([])

    const jonas = await conversations(engine, 'jon')
    expect(jonas.people).toContainEqual(expect.objectContaining({ key: 'u:U0JONAS', name: 'Jonas', kind: 'im', tint: 'dm', empty: true }))
    expect(jonas.people.find((row) => row.key === 'u:U0JONAS')!.channelId).toBeUndefined()

    const maya = await conversations(engine, 'maya')
    expect(maya.people).toContainEqual(expect.objectContaining({ key: 'D0MAYA', channelId: 'D0MAYA', name: 'Maya', empty: false }))

    const eng = await conversations(engine, 'eng')
    expect(eng.channels).toContainEqual(expect.objectContaining({ key: 'C0ENG', name: 'eng', kind: 'public', tint: 'public' }))
  })

  it('lists a channel’s threads, and recent threads everywhere with their conversation', async () => {
    const engine = await bootedEngine(engines)
    const inEng = await threads(engine, { channel: 'C0ENG', query: '' }, (rows) => rows.length > 0)
    expect(inEng.every((row) => row.conversation.channelId === 'C0ENG')).toBe(true)
    expect(inEng.map((row) => row.lastActivityAt)).toEqual(inEng.map((row) => row.lastActivityAt).toSorted((a, b) => b - a))

    const everywhere = await threads(engine, { query: '' }, (rows) => rows.length > 0)
    expect(new Set(everywhere.map((row) => row.conversation.key)).size).toBeGreaterThan(1)

    const title = inEng[0]!.title.split(' ')[0]!
    const matched = await threads(engine, { query: title }, (rows) => rows.length > 0)
    expect(matched.map((row) => row.id)).toContain(inEng[0]!.id)
  })

  it('sends to a thread and stores the reply before answering', async () => {
    const engine = await bootedEngine(engines)
    const [root] = await threads(engine, { channel: 'C0ENG', query: '' }, (rows) => rows.length > 0)
    const exit = await runCommand(engine.registry, messagesSend, {
      to: { kind: 'channel', channelId: 'C0ENG', threadTs: root!.rootTs },
      text: 'Thursday works for me',
      clientMsgId: 'client-thread-1',
    })
    expect(valueOf(exit)).toEqual({ topicId: root!.id })
    const stored = readDb(engine, 'cache.db', (db) => db.prepare(`SELECT thread_ts FROM messages WHERE client_msg_id = 'client-thread-1'`).get() as { thread_ts: string } | undefined)
    expect(stored?.thread_ts).toBe(root!.rootTs)
  })

  it('opens a DM with conversations.open for a person never messaged, then sends', async () => {
    const engine = await bootedEngine(engines)
    engine.fake.resetCalls()
    const exit = await runCommand(engine.registry, messagesSend, { to: { kind: 'person', userId: 'U0JONAS' }, text: 'Welcome aboard', clientMsgId: 'client-dm-1' })
    const { topicId } = valueOf(exit)
    const opens = apiCalls(engine, 'conversations.open')
    expect(opens).toHaveLength(1)
    expect(opens[0]!.args['users']).toBe('U0JONAS')
    const channel = topicId.slice('m:'.length)
    expect(apiCalls(engine, 'chat.postMessage')[0]!.args['channel']).toBe(channel)
    const topic = readDb(engine, 'cache.db', (db) => db.prepare(`SELECT kind FROM topic_index WHERE topic_id = ?`).get(topicId) as { kind: string } | undefined)
    expect(topic?.kind).toBe('main')

    const after = await conversations(engine, 'jon', (value) => value.people.some((row) => row.channelId === channel))
    expect(after.people).toContainEqual(expect.objectContaining({ key: channel, name: 'Jonas', empty: false }))
  })
})
