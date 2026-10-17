import { afterEach, describe, expect, it } from 'vitest'
import { newChatConversations, type PickConversations } from '@juno/contract'
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

})
