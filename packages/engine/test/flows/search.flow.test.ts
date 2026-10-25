// ⌘K and New chat against the fake Slack: local search ranks places, titles
// and better message matches, leaves out ignored channels and channels the
// user left, follows edits and deletes, falls back to Slack's search for
// what the store lacks, reads palette commands only with AI assist on, and
// New chat finds people, channels and group DMs by member.
import { afterEach, expect, it } from 'bun:test'
import { channelsIgnore, newChatConversations, prefsSet, searchCommand, searchQuery, searchSlack, type PickConversation, type PickConversations, type SearchResult } from '@juno/contract'
import { SELF_ID, TEAM, type FakeSlack } from '@juno/fake-slack'
import { liveQuery, paletteConversationsAtom, runCommand } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { valueOf } from '../scenario'
import { step } from '../step'
import { bootedEngine } from '../scenario'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

/** The first value of a live query that `predicate` accepts. */
async function liveUntil<A>(engine: RunningEngine, atom: Parameters<RunningEngine['registry']['mount']>[0], predicate: (value: A) => boolean, label: string): Promise<A> {
  const unmount = engine.registry.mount(atom)
  try {
    return await waitFor(() => {
      const result = engine.registry.get(atom) as { _tag: string; value?: A }
      return result._tag === 'Success' && predicate(result.value as A) ? { value: result.value as A } : undefined
    }, WAIT_MS, label).then((found) => found.value)
  } finally {
    unmount()
  }
}

const search = (engine: RunningEngine, query: string, predicate: (results: ReadonlyArray<SearchResult>) => boolean = () => true) =>
  liveUntil<ReadonlyArray<SearchResult>>(engine, liveQuery(searchQuery)({ query, limit: 50 }), predicate, `search "${query}"`)

const pickers = (engine: RunningEngine, query: string) =>
  liveUntil<PickConversations>(engine, liveQuery(newChatConversations)({ query }), () => true, `New chat "${query}"`)

const channelOf = (result: SearchResult): string => (result.kind === 'channel' ? result.id : result.kind === 'person' ? '' : result.place.id)

/**
 * Three channels named rollout that the user joins, each with the same thread
 * and Main messages, a channel that ties with #rollout on one word, and a
 * mention with characters Slack escapes.
 */
function joinRolloutChannels(fake: FakeSlack): void {
  const channels = [['C0TIE', 'tie'], ['C0SEARCH', 'rollout'], ['C0IGNORE', 'rollout-alerts'], ['C0OUTSIDE', 'rollout-public']] as const
  for (const [id, name] of channels) {
    fake.workspace.addConversation({ id, name, kind: 'public', members: new Set(['U0MAYA']), created: fake.now() - 60_000, topic: '', purpose: '', isOpen: true, archived: false })
    fake.joinChannel({ channel: id })
  }
  // Equal ranks, stored with #tie first.
  fake.injectMessage({ channel: 'C0TIE', text: 'equalrank' })
  fake.injectMessage({ channel: 'C0SEARCH', text: 'equalrank' })
  fake.injectMessage({ channel: 'C0SEARCH', text: 'equalrank' })
  for (const [id] of channels.slice(1)) {
    const root = fake.injectMessage({ channel: id, text: 'Rollout checklist' })
    fake.injectMessage({ channel: id, text: 'Rollout checklist rollout checklist' })
    fake.injectMessage({ channel: id, text: 'Ready for review', threadTs: root.ts })
  }
  // Slack stores it as `<@U0MAYA> canary -&gt; prod`.
  const canary = fake.injectMessage({ channel: 'C0SEARCH', text: '<@U0MAYA> canary -> prod' })
  fake.injectMessage({ channel: 'C0SEARCH', text: 'Done', threadTs: canary.ts })
}

it('finds what the store holds, leaves out ignored and left channels, asks Slack for the rest, and fills the New chat pickers', async () => {
  const engine = await syncedEngine(engines)
  const { fake, registry } = engine

  await step('New chat lists recent conversations, then people never messaged, DMs, channels and group DMs by any member', async () => {
    const recent = await pickers(engine, '')
    expect(recent.recent.length).toBeGreaterThan(0)
    expect(recent.recent.length).toBeLessThanOrEqual(8)
    expect(recent.people).toEqual([])
    const jonas = await pickers(engine, 'jon')
    const never = jonas.people.find((row) => row.key === 'u:U0JONAS')
    expect(never).toMatchObject({ kind: 'im', empty: true })
    expect(never!.channelId).toBeUndefined()
    const maya = await pickers(engine, 'maya')
    expect(maya.people).toContainEqual(expect.objectContaining({ key: 'D0MAYA', channelId: 'D0MAYA', empty: false }))
    expect((await pickers(engine, 'eng')).channels).toContainEqual(expect.objectContaining({ key: 'C0ENG', kind: 'public' }))
    for (const member of ['maya', 'leo']) {
      expect((await pickers(engine, member)).channels).toContainEqual(expect.objectContaining({ key: 'G0MAYALEO', kind: 'mpim', name: 'Maya, Leo' }))
    }
  })

  await step('joins the rollout channels, then ignores one and leaves another once their messages are stored', async () => {
    joinRolloutChannels(fake)
    await search(engine, 'checklist', (results) => ['C0SEARCH', 'C0IGNORE', 'C0OUTSIDE'].every((id) => results.some((result) => result.kind === 'message' && channelOf(result) === id)))
    await search(engine, 'equalrank', (results) => results.length === 3)
    valueOf(await runCommand(registry, channelsIgnore, { channel: 'C0IGNORE' }))
    // Its messages stay in the cache after leaving.
    fake.leaveChannel({ channel: 'C0OUTSIDE' })
    await search(engine, 'checklist', (results) => results.every((result) => channelOf(result) !== 'C0IGNORE' && channelOf(result) !== 'C0OUTSIDE'))
  })

  await step('ranks the channel, then the thread title, then the better message match, for a word and a prefix', async () => {
    for (const query of ['rollout', 'rollo']) {
      const results = await search(engine, query)
      expect(results.filter((result) => result.kind !== 'person').every((result) => channelOf(result) === 'C0SEARCH')).toBe(true)
      expect(results[0]).toMatchObject({ kind: 'channel', id: 'C0SEARCH', mainId: 'm:C0SEARCH' })
      expect(results[1]).toMatchObject({ kind: 'topic', title: 'Rollout checklist', place: { id: 'C0SEARCH' } })
      const messages = results.filter((result) => result.kind === 'message')
      expect(messages.map((result) => [result.text, result.stored])).toEqual([
        ['Rollout checklist rollout checklist', true],
        ['Rollout checklist', true],
      ])
      expect(messages.map((result) => result.kind === 'message' && result.topicId)).toEqual(['m:C0SEARCH', expect.stringMatching(/^t:C0SEARCH:/)])
    }
    expect(await search(engine, 'May')).toContainEqual(expect.objectContaining({ kind: 'person', id: 'U0MAYA' }))
  })

  await step('breaks equal message ranks by channel, then time', async () => {
    const ties = (await search(engine, 'equalrank')).map((result) => result.id.split(':')[0])
    expect(ties).toEqual(['C0SEARCH', 'C0SEARCH', 'C0TIE'])
    const [first, second] = (await search(engine, 'equalrank')).map((result) => (result.kind === 'message' ? Number(result.ts) : 0))
    expect(first).toBeLessThan(second!)
  })

  await step('names the people a title mentions and decodes Slack escaping', async () => {
    const results = await search(engine, 'canary')
    expect(results).toContainEqual(expect.objectContaining({ kind: 'topic', title: '@Maya canary -> prod' }))
    expect(results).toContainEqual(expect.objectContaining({ kind: 'message', text: '@Maya canary -> prod' }))
  })

  await step('an empty query lists recent topics, none from an ignored or left channel', async () => {
    const results = await search(engine, '   ')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((result) => result.kind === 'topic')).toBe(true)
    expect(results.map((result) => result.id)).toContain('m:C0SEARCH')
    expect(results.some((result) => ['C0IGNORE', 'C0OUTSIDE'].includes(channelOf(result)))).toBe(false)
  })

  await step('indexes attachment and section text, and drops a message Slack deletes', async () => {
    const message = fake.workspace.post({ channel: 'C0SEARCH', user: 'U0MAYA', text: 'Integration updated', attachments: [{ title: 'Cache invalidation', text: 'Unique attachment detail' }], blocks: [{ type: 'section', fields: [{ type: 'plain_text', text: 'Unique section detail' }] }] })
    const isIt = (result: SearchResult) => result.kind === 'message' && result.ts === message.ts
    await search(engine, 'invalidation', (results) => results.some(isIt))
    expect(await search(engine, 'section')).toContainEqual(expect.objectContaining({ kind: 'message', text: expect.stringContaining('Unique section detail') }))
    fake.deleteMessage({ channel: 'C0SEARCH', ts: message.ts })
    await search(engine, 'invalidation', (results) => !results.some(isIt))
  })

  await step("Slack's search finds a reply the store lacks, in its thread, and drops ignored and left channels", async () => {
    const at = fake.now()
    const root = fake.workspace.post({ channel: 'C0SEARCH', user: 'U0MAYA', text: 'Quarterly budget review', at: at - 2_000, silent: true })
    fake.workspace.post({ channel: 'C0SEARCH', user: 'U0MAYA', text: 'The budget spreadsheet is final', threadTs: root.ts, at: at - 1_000, silent: true })
    fake.workspace.post({ channel: 'C0IGNORE', user: 'U0MAYA', text: 'budget spreadsheet', at: at - 1_000, silent: true })
    fake.workspace.post({ channel: 'C0OUTSIDE', user: 'U0MAYA', text: 'spreadsheet for the public rollout', at: at - 1_000, silent: true })
    const found = valueOf(await runCommand(registry, searchSlack, { query: 'spreadsheet' }))
    expect(found).toEqual([expect.objectContaining({ kind: 'message', text: 'The budget spreadsheet is final', topicId: `t:C0SEARCH:${root.ts}`, stored: false })])
  })

  await step('reads "tell maya …" and "post in rollout …" as commands, a search as none, and nothing while AI assist is off', async () => {
    const command = async (text: string) => valueOf(await runCommand(registry, searchCommand, { text }))
    expect(await command('tell maya the slot works')).toMatchObject({ kind: 'send-dm', userId: 'U0MAYA', text: 'the slot works' })
    expect(await command('post in rollout ship it')).toMatchObject({ kind: 'post', channelId: 'C0SEARCH' })
    expect(await command('rollout')).toBeNull()
    valueOf(await runCommand(registry, prefsSet, { key: 'aiAssist', value: false }))
    expect(await command('tell maya the slot works')).toBeNull()
  })
})

// The palette's Conversations by words (spec section 10): the words can match the label's names in any order,
// across its comma, each as a prefix.
it('"dmitriy wi" ranks the group DM with Dmitriy and wience first, with both words marked in its label', async () => {
  const DAY = 86_400_000
  const engine = await bootedEngine(engines, {
    initial: (fake) => {
      for (const [id, name, display, real] of [['U0DMITRIY', 'dvasilyuk', 'Dmitriy', 'Dmitriy Vasilyuk'], ['U0WIENCE', 'wience', 'wience', 'Wience Ortega']] as const) {
        fake.workspace.addUser({ id, team_id: TEAM.id, name, real_name: real, profile: { display_name: display, real_name: real } })
      }
      fake.workspace.addConversation({ id: 'G0DMITRIY', name: 'mpdm-tushar--dvasilyuk--wience-1', kind: 'mpim', members: new Set([SELF_ID, 'U0DMITRIY', 'U0WIENCE']), created: fake.now() - 10 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
      const last = fake.workspace.post({ channel: 'G0DMITRIY', user: 'U0WIENCE', text: 'Shipping the build tonight', at: fake.now() - DAY, silent: true })
      fake.workspace.reads.set('G0DMITRIY', last.ts)
      return fake.signIn()
    },
  })
  const rows = await liveUntil<ReadonlyArray<PickConversation>>(engine, paletteConversationsAtom('dmitriy wi'), (list) => list.length > 0, 'the palette rows')
  const [first] = rows
  expect(first).toMatchObject({ key: 'G0DMITRIY', channelId: 'G0DMITRIY', name: 'Dmitriy, wience' })
  expect(first!.highlight!.map(([start, end]) => first!.name.slice(start, end))).toEqual(['Dmitriy', 'wi'])
})
