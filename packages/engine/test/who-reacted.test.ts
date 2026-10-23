// "Who reacted" (`reactions.who`): a page lists at most `REACTORS_LISTED`
// people per reaction, as Slack may; the dialog's subscription shows what is
// stored at once, fetches everyone once with `reactions.get` `full`, names
// the people the store lacks, and refreshes after a later truncated snapshot. The topic window still names at most ten per chip.
import { describe, expect, it } from 'bun:test'
import type { WhoReacted } from '@juno/contract'
import { REACTORS_LISTED, type ManyReactionsSeed } from '@juno/fake-slack'
import { openTopic, reactToMessage, whoReactedAtom } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from './harness'
import { apiCalls, quiet, readDb, valueOf } from './scenario'
import { actionRows, booted, chip, MAIN, stopEnginesAfterEach, watch } from './actionScenario'

stopEnginesAfterEach()

/** Seeds the message with many reactions in #eng and opens Main, so a page stores them cut short. */
async function seeded(engine: RunningEngine): Promise<ManyReactionsSeed> {
  const seed = engine.fake.seedManyReactions()
  const rows = watch(engine, MAIN)
  valueOf(await openTopic(engine.registry, MAIN))
  await rows((list) => chip(list.find((row) => row.ts === seed.ts), '+1')?.count === 40, 'the reactions stored')
  await quiet(engine)
  engine.fake.resetCalls()
  return seed
}

/** Mounts the dialog's subscription; returns a reader that waits for a value matching `predicate`, and the values seen. */
function who(engine: RunningEngine, seed: ManyReactionsSeed) {
  const atom = whoReactedAtom(seed.channel, seed.ts)
  const seen: Array<WhoReacted | null> = []
  const unmount = engine.registry.mount(atom)
  const stop = engine.registry.subscribe(atom, (result) => {
    if (result._tag === 'Success') seen.push(result.value)
  }, { immediate: true })
  const until = (predicate: (value: WhoReacted) => boolean, label: string) =>
    waitFor(() => {
      const result = engine.registry.get(atom)
      return result._tag === 'Success' && result.value !== null && predicate(result.value) ? result.value : undefined
    }, WAIT_MS, label)
  return { until, seen, close: () => { stop(); unmount() } }
}

const storedUsers = (engine: RunningEngine, ts: string, name: string) =>
  readDb(engine, 'cache.db', (db) => JSON.parse((db.prepare('SELECT user_ids_json FROM reactions WHERE channel = ? AND ts = ? AND name = ?').get('C0ENG', ts, name) as { user_ids_json: string }).user_ids_json) as Array<string>)

const reaction = (value: WhoReacted, name: string) => value.reactions.find((r) => r.name === name)

describe('who reacted: the full fetch', () => {
  it('shows the stored list at once, then everyone after one full fetch, with names, emoji and you first', async () => {
    const engine = await booted()
    const seed = await seeded(engine)
    expect(storedUsers(engine, seed.ts, '+1')).toHaveLength(REACTORS_LISTED)
    const dialog = who(engine, seed)
    const first = await dialog.until(() => true, 'a first value')
    expect(reaction(first, '+1')?.users).toHaveLength(REACTORS_LISTED)
    expect(first.loading).toBe(true)

    const full = await dialog.until((value) => !value.loading && reaction(value, '+1')?.users.length === 40, 'everyone')
    const expected = seed.reactions.find((r) => r.name === '+1')!.users
    expect(reaction(full, '+1')?.users).toEqual(['U0TUSHAR', ...expected.filter((id) => id !== 'U0TUSHAR')])
    expect(reaction(full, '+1')?.me).toBe(true)
    expect(reaction(full, 'tada')?.users).toHaveLength(28)
    expect(full.reactions.map((r) => r.name)).toEqual(seed.reactions.map((r) => r.name))
    expect(reaction(full, '+1')?.unicode).toBe('👍')
    expect(reaction(full, 'juno_party')?.url).toMatch(/juno_party\.svg$/)
    // An alias of a custom emoji shows its image.
    expect(reaction(full, 'hello_juno')?.url).toMatch(/juno_wave\.svg$/)
    expect(apiCalls(engine, 'reactions.get').map((call) => call.args['full'])).toEqual(['true'])

    // The new people were not in the store; they are named and arrive in a later value.
    const named = await dialog.until((value) => value.people.length === 40, 'everyone named')
    const person = named.people.find((p) => p.id === 'U0RX01')
    expect(person?.name).toBe(seed.names['U0RX01'])
    expect(person?.color).toBeDefined()
    dialog.close()

    // The topic window still names ten per chip.
    const rows = watch(engine, MAIN)
    const listed = await rows((list) => chip(list.find((row) => row.ts === seed.ts), '+1')?.users?.length === 10, 'ten in the chip')
    expect(chip(listed.find((row) => row.ts === seed.ts), '+1')?.users?.[0]).toBe('U0TUSHAR')
  })

})

describe('who reacted: the stored full list', () => {
  it('keeps a full list current through socket adds and removes without another fetch', async () => {
    const engine = await booted()
    const seed = await seeded(engine)
    const dialog = who(engine, seed)
    await dialog.until((value) => !value.loading && reaction(value, '+1')?.users.length === 40, 'everyone')
    engine.fake.resetCalls()
    engine.fake.addReaction({ channel: seed.channel, ts: seed.ts, name: '+1', user: 'U0MAYA' })
    const added = await dialog.until((value) => reaction(value, '+1')?.count === 41, 'new reactor')
    expect(reaction(added, '+1')?.users).toContain('U0MAYA')
    const removed = seed.reactions[0]!.users.at(-1)!
    engine.fake.removeReaction({ channel: seed.channel, ts: seed.ts, name: '+1', user: removed })
    const current = await dialog.until((value) => reaction(value, '+1')?.count === 40, 'reactor removed')
    expect(reaction(current, '+1')?.users).not.toContain(removed)
    expect(reaction(current, '+1')?.users).toContain('U0MAYA')
    await quiet(engine)
    expect(apiCalls(engine, 'reactions.get')).toHaveLength(0)
    dialog.close()
  })

  it('refetches after a truncated snapshot even when the count and listed users are unchanged', async () => {
    const engine = await booted()
    const seed = await seeded(engine)
    const dialog = who(engine, seed)
    await dialog.until((value) => !value.loading && reaction(value, '+1')?.users.length === 40, 'everyone')
    engine.fake.resetCalls()
    // A missed remove/add beyond the first 25 keeps both count and truncated list unchanged.
    const removed = seed.reactions[0]!.users.at(-1)!
    engine.fake.holdFrames({ types: ['reaction_added', 'reaction_removed'] })
    engine.fake.removeReaction({ channel: seed.channel, ts: seed.ts, name: '+1', user: removed })
    engine.fake.addReaction({ channel: seed.channel, ts: seed.ts, name: '+1', user: 'U0MAYA' })
    engine.fake.releaseFrames({ drop: true })
    engine.fake.editMessage({ channel: seed.channel, ts: seed.ts, text: 'Launch day, edited' })
    const fresh = await dialog.until((value) => !value.loading && reaction(value, '+1')?.users.includes('U0MAYA') === true, 'fresh full list')
    expect(reaction(fresh, '+1')?.users).toHaveLength(40)
    expect(reaction(fresh, '+1')?.users).not.toContain(removed)
    expect(apiCalls(engine, 'reactions.get')).toHaveLength(1)
    dialog.close()
    const again = who({ ...engine, registry: engine.openWindow() }, seed)
    await again.until((value) => !value.loading && reaction(value, '+1')?.users.length === 40, 'cached full list')
    await quiet(engine)
    expect(apiCalls(engine, 'reactions.get')).toHaveLength(1)
    again.close()
  })

})

describe('who reacted: concurrent fetches', () => {
  it('shares a held full fetch across renderer subscriptions', async () => {
    const engine = await booted()
    const seed = await seeded(engine)
    engine.fake.holdNext({ method: 'reactions.get' })
    const first = who(engine, seed)
    await first.until((value) => value.loading, 'first loading')
    await waitFor(() => engine.fake.heldCount() === 1 ? true : undefined, WAIT_MS, 'held full fetch')
    const second = who({ ...engine, registry: engine.openWindow() }, seed)
    await second.until((value) => value.loading, 'second loading')
    first.close()
    engine.fake.release()
    await second.until((value) => !value.loading && reaction(value, '+1')?.users.length === 40, 'second complete')
    expect(apiCalls(engine, 'reactions.get')).toHaveLength(1)
    second.close()
  })

  it('cancels when the last dialog closes so reopening starts a fresh read', async () => {
    const engine = await booted()
    const seed = await seeded(engine)
    engine.fake.holdNext({ method: 'reactions.get', times: 2 })
    const first = who(engine, seed)
    await waitFor(() => engine.fake.heldCount() === 1 ? true : undefined, WAIT_MS, 'first held')
    first.close()
    const second = who({ ...engine, registry: engine.openWindow() }, seed)
    // No 30-second topic idle TTL: the old request no longer owns the pending slot.
    await waitFor(() => engine.fake.heldCount() === 2 ? true : undefined, 5_000, 'fresh request after close')
    engine.fake.release()
    await second.until((value) => !value.loading && reaction(value, '+1')?.users.length === 40, 'reopened complete')
    second.close()
  })

  it('retries a full response superseded by a socket event without undoing the event', async () => {
    const engine = await booted()
    const seed = await seeded(engine)
    engine.fake.holdNext({ method: 'reactions.get' })
    const dialog = who(engine, seed)
    await waitFor(() => engine.fake.heldCount() === 1 ? true : undefined, WAIT_MS, 'old snapshot held')
    engine.fake.addReaction({ channel: seed.channel, ts: seed.ts, name: '+1', user: 'U0MAYA' })
    await dialog.until((value) => reaction(value, '+1')?.count === 41, 'event stored during fetch')
    engine.fake.release()
    const fresh = await dialog.until((value) => !value.loading && reaction(value, '+1')?.users.length === 41, 'fresh response')
    expect(reaction(fresh, '+1')?.users).toContain('U0MAYA')
    expect(apiCalls(engine, 'reactions.get')).toHaveLength(2)
    expect(dialog.seen.filter((value) => value !== null && reaction(value, '+1')?.users.length === 40)).toHaveLength(0)
    dialog.close()
  })

  it('keeps what is stored and stops loading when Slack refuses', async () => {
    const engine = await booted()
    const seed = await seeded(engine)
    // An answer the client does not retry.
    engine.fake.forceError({ method: 'reactions.get', error: 'message_not_found' })
    const dialog = who(engine, seed)
    const failed = await dialog.until((value) => !value.loading && dialog.seen.length > 1, 'the fetch over')
    expect(reaction(failed, '+1')?.users).toHaveLength(REACTORS_LISTED)
    expect(reaction(failed, '+1')?.count).toBe(40)
    expect(apiCalls(engine, 'reactions.get')).toHaveLength(1)
    dialog.close()
  })

})

describe('who reacted: what the store holds', () => {
  it('shows your own reaction before Slack has it, as the chip does', async () => {
    const engine = await booted()
    const seed = await seeded(engine)
    engine.fake.holdNext({ method: 'reactions.add', before: true })
    valueOf(await reactToMessage(engine.registry, { channelId: 'C0ENG', ts: seed.ts }, 'eyes', true))
    const dialog = who(engine, seed)
    const value = await dialog.until((v) => reaction(v, 'eyes')?.me === true, 'mine shown')
    expect(reaction(value, 'eyes')?.users[0]).toBe('U0TUSHAR')
    expect(reaction(value, 'eyes')?.count).toBe(6)
    engine.fake.release()
    await waitFor(() => (actionRows(engine).length === 0 ? true : undefined), WAIT_MS, 'sent')
    dialog.close()
  })

  it('answers null for a message the store does not have', async () => {
    const engine = await booted()
    const dialog = who(engine, { channel: 'C0ENG', ts: '1000000000.000100', text: '', reactions: [], names: {} })
    await waitFor(() => (dialog.seen.length > 0 ? true : undefined), WAIT_MS, 'a value')
    expect(dialog.seen[0]).toBeNull()
    await quiet(engine)
    expect(apiCalls(engine, 'reactions.get')).toHaveLength(0)
    dialog.close()
  })
})
