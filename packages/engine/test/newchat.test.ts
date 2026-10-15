import { afterEach, describe, expect, it } from 'vitest'
import { newChatConversations, newChatThreads, type PickConversations, type PickThread } from '@juno/contract'
import { liveQuery } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { bootedEngine } from './scenario'

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

  it('finds group DMs by their members and shows member names', async () => {
    const engine = await bootedEngine(engines)
    for (const name of ['maya', 'leo']) {
      const result = await conversations(engine, name)
      expect(result.channels).toContainEqual(expect.objectContaining({
        key: 'G0MAYALEO', kind: 'mpim', name: 'Maya, Leo',
      }))
    }
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
})
