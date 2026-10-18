// What the outline of Juno's memory of the owner costs the prompt cache, measured with the fake
// model's own usage: pi-ai's faux core reports as cached the part of a request it shares with the
// session's previous one (characters / 4, the system text and tools included). A chat with some
// history (twenty earlier runs, summarised by the compactor), then six measured runs with memory
// writes in the second and the fourth, sent three ways:
//
// - none: the requests with the outline taken out, as before this change.
// - outline: as built: after the summary and before the recent messages, read once per run.
// - top: the outline read fresh for every request and put first in the memory message, the naive place.
//
// Person files (SPEC 13.8) are measured the same way: a DM with Maya, whose file Juno updates before
// three of the six measured runs, sent three ways:
//
// - strip: the requests with her file taken out, as before person files.
// - after: as built: her file in <people-now> after the recent messages, read once per run.
// - first: her file read fresh for every request and put first in the memory message, the naive place.
import { afterEach, expect, it } from 'vitest'
import { reply } from '@juno/agent-testing'
import type { SendContext } from '@juno/agent-contract'
import { peopleContext } from '@juno/agent-memory'
import { fileOf, person } from '../src/memory-docs/people'
import { entries, outlineNow, writeEntry } from '../src/memory-docs/store'
import type { Store } from '../src/store/store'
import { HAIKU, say, turnsHarness } from './turns-harness'

type Variant = 'none' | 'outline' | 'top' | 'strip' | 'after' | 'first'
type Usage = { readonly input: number; readonly cacheRead: number; readonly cacheWrite: number }
type Models = Parameters<NonNullable<Parameters<typeof turnsHarness>[0]>['transport'] & {}>[0]['models']

let h: Awaited<ReturnType<typeof turnsHarness>> | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const ABOUT = /<about-owner rev="\d+">[\s\S]*?<\/about-owner>\n/
const PEOPLE = /\n<people-now>[\s\S]*?<\/people-now>/

/** The memory message's text with the outline taken out, or moved first and read fresh; or the person files moved before the recent messages. */
function rewrite(text: string, variant: Variant, store: Store | undefined): string {
  if (!text.startsWith('<remembered>')) return text
  if (variant === 'strip' || variant === 'first') {
    const without = text.replace(PEOPLE, '')
    return variant === 'strip' || store === undefined ? without : `${peopleContext([fileOf(person(store, 'U0MAYA')!, entries(store))])}\n${without}`
  }
  if (variant === 'outline' || variant === 'after') return text
  const without = text.replace(ABOUT, '')
  return variant === 'none' || store === undefined ? without : `${outlineNow(store)}\n${without}`
}

/** The fake's models, with each chat request rewritten for `variant` and its reported usage kept. */
function measured(models: Models, variant: Variant, store: () => Store | undefined, usage: Usage[]): Models {
  return new Proxy(models, {
    get(target, key, receiver) {
      if (key !== 'streamSimple') return Reflect.get(target, key, receiver) as unknown
      return (model: { readonly id: string }, context: { readonly messages: ReadonlyArray<{ readonly role: string; readonly content: unknown }> }, options: unknown) => {
        const chat = model.id !== HAIKU.modelId
        const sent = chat
          ? { ...context, messages: context.messages.map((m) => (m.role === 'user' && typeof m.content === 'string' ? { ...m, content: rewrite(m.content, variant, store()) } : m)) }
          : context
        const stream = (target.streamSimple as (...args: unknown[]) => { result: () => Promise<{ usage: Usage }> })(model, sent, options)
        if (chat) void stream.result().then((message) => usage.push(message.usage))
        return stream
      }
    },
  })
}

const write = (id: string, doc: string, text: string) => reply({ type: 'toolCall', id, name: 'memory_write', arguments: { doc, text } })

const earlier = (n: number) => `Notes from planning, part ${n}: ${'we agreed the sidebar ships first, then search, and the migration backfill runs in 200-row batches. '.repeat(6)}`

/** Twenty earlier runs, then six measured ones; the second and the fourth write to memory. */
async function conversation(variant: Variant) {
  const usage: Usage[] = []
  h = await turnsHarness({ transport: (fake) => measured(fake.models, variant, () => h?.turns.store, usage) })
  for (let n = 1; n <= 20; n++) {
    h.fake.script([reply(say(`Noted part ${n}.`))])
    await h.ended(h.send(earlier(n)))
    await h.turns.compaction.idle()
  }
  usage.length = 0
  const runs: ReadonlyArray<ReadonlyArray<ReturnType<typeof reply>>> = [
    [reply(say('Morning. Two meetings today, the first at 10.'))],
    [write('w1', 'you', 'Leads the sync team; owns the Postgres 16 migration'), reply(say('Noted.'))],
    [reply(say('Maya posted the migration plan and asked for a reviewer.'))],
    [write('w2', 'people', 'Maya Chen: owns the migration plan, reviews backfill PRs'), reply(say('Noted that too.'))],
    [reply(say('The flake on the sidebar test is back; Leo has a fix in a branch.'))],
    [reply(say('Nothing else needs you today.'))],
  ]
  const asks = ['what is on today?', 'I lead the sync team and own the migration', 'what is new in #eng?', 'Maya owns the plan', 'anything else?', 'and later?']
  for (const [n, steps] of runs.entries()) {
    h.fake.script(steps)
    await h.ended(h.send(asks[n]!))
    await h.turns.compaction.idle()
  }
  const total = usage.reduce((sum, u) => ({ input: sum.input + u.input, cacheRead: sum.cacheRead + u.cacheRead, cacheWrite: sum.cacheWrite + u.cacheWrite }), { input: 0, cacheRead: 0, cacheWrite: 0 })
  const sent = total.input + total.cacheRead
  await h.close()
  h = undefined
  return { requests: usage.length, ...total, sent, hit: Math.round((total.cacheRead / sent) * 1000) / 1000 }
}

it('the outline keeps the cached prefix: it costs only its own bytes, and a write busts nothing before the recent messages', async () => {
  const none = await conversation('none')
  const outline = await conversation('outline')
  const top = await conversation('top')
  // The numbers for the report: `pnpm remote test --passWithNoTests test/memory-cache.test.ts`.
  console.log(`memory-cache ${JSON.stringify({ none, outline, top })}`)

  expect(outline.requests).toBe(none.requests)
  // Within two points of the conversation without an outline.
  expect(outline.hit).toBeGreaterThan(none.hit - 0.02)
  // The naive place loses the cached summary and recent messages on every write.
  expect(top.hit).toBeLessThan(outline.hit - 0.05)
})

const DM: SendContext = { _tag: 'topic', topicId: 'm:D0MAYA', title: 'Maya Chen · Main', kind: 'main', place: { channelId: 'D0MAYA', name: 'Maya Chen', kindLabel: 'Direct message', tint: 'dm' }, person: 'U0MAYA' }

/** Twenty earlier runs, then six measured runs in the DM with Maya; her file changes before the second, fourth and sixth. */
async function dm(variant: 'strip' | 'after' | 'first') {
  const usage: Usage[] = []
  h = await turnsHarness({ transport: (fake) => measured(fake.models, variant, () => h?.turns.store, usage) })
  const store = h.turns.store
  const note = (id: string, section: 'talk' | 'work' | 'notes', text: string) =>
    writeEntry(store, { id, runId: null, by: 'juno', person: 'U0MAYA', section, text, source: 'slack', tainted: true, create: { name: 'Maya Chen', reason: 'interaction' } })
  note('f1', 'talk', 'Short and lowercase; skips greetings; replies within minutes')
  note('f2', 'work', 'Owns the Postgres 16 migration plan and the planning offsite')
  for (let n = 1; n <= 20; n++) {
    h.fake.script([reply(say(`Noted part ${n}.`))])
    await h.ended(h.send(earlier(n)))
    await h.turns.compaction.idle()
  }
  usage.length = 0
  const updates: Record<number, () => void> = {
    1: () => note('f3', 'notes', 'Works Pacific time; mornings are best for her'),
    3: () => note('f4', 'work', 'Reviews the backfill PRs'),
    5: () => note('f5', 'talk', 'Uses "sgtm" and one emoji at most'),
  }
  const asks = ['what did maya ask?', 'draft a yes', 'when is the offsite?', 'draft a reply about the backfill', 'anything else from her?', 'draft a thanks']
  for (const [n, ask] of asks.entries()) {
    updates[n]?.()
    h.fake.script([reply(say(`Draft ${n}.`))])
    await h.ended(h.send(ask, { context: DM }))
    await h.turns.compaction.idle()
  }
  const total = usage.reduce((sum, u) => ({ input: sum.input + u.input, cacheRead: sum.cacheRead + u.cacheRead, cacheWrite: sum.cacheWrite + u.cacheWrite }), { input: 0, cacheRead: 0, cacheWrite: 0 })
  const sent = total.input + total.cacheRead
  await h.close()
  h = undefined
  return { requests: usage.length, ...total, sent, hit: Math.round((total.cacheRead / sent) * 1000) / 1000 }
}

it('a person\'s file after the recent messages costs only its own bytes, and a change to it busts nothing before them', async () => {
  const strip = await dm('strip')
  const after = await dm('after')
  const first = await dm('first')
  // The numbers for the report: `pnpm remote test --passWithNoTests test/memory-cache.test.ts`.
  console.log(`memory-cache people ${JSON.stringify({ strip, after, first })}`)
  expect(after.requests).toBe(strip.requests)
  // Within three points of the same conversation without the file: what it costs is its own bytes.
  expect(after.hit).toBeGreaterThan(strip.hit - 0.03)
  // The naive place loses the cached summary on every change to the file.
  expect(first.hit).toBeLessThan(after.hit - 0.02)
})
