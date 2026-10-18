// The agent's own time in a Juno turn, alone in the timing project: on the fake model, which answers at
// once, every millisecond between the owner's send and Juno's first bubble is the agent's. A chat with
// history (twenty earlier runs, summarised by the compactor) and memory docs with an outline, then:
//
// - a normal message: send → the model request → the first bubble;
// - a connection call the owner approves on its card: click → the click run starts → its model request
//   → its first bubble, the run that carries the call's result (`carryOutcomes`).
//
// It prints each request's size (system text, messages and tools), so a prompt that grows shows here too;
// `memory-cache.test.ts` measures the cached prefix. The numbers for the report: `pnpm remote test --passWithNoTests test/turn-timing.bench.test.ts`.
import { afterEach, expect, it } from 'vitest'
import { reply } from '@juno/agent-testing'
import { ActionId, ConnectionId, AccountId, Digest, Revision, SourceGeneration, type CardPayload } from '@juno/agent-cards'
import type { Executor, TurnEvent } from '../src/index'
import { HAIKU, say, turnsHarness } from './turns-harness'

type Models = Parameters<NonNullable<Parameters<typeof turnsHarness>[0]>['transport'] & {}>[0]['models']
type Sent = { readonly at: number; readonly chars: number }

let h: Awaited<ReturnType<typeof turnsHarness>> | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

/** The fake's models, timing each chat request and keeping its size. */
function timed(models: Models, sent: Sent[]): Models {
  return new Proxy(models, {
    get(target, key, receiver) {
      if (key !== 'streamSimple') return Reflect.get(target, key, receiver) as unknown
      return (model: { readonly id: string }, context: { readonly systemPrompt?: string; readonly messages: unknown; readonly tools?: unknown }, options: unknown) => {
        const at = performance.now()
        if (model.id !== HAIKU.modelId) sent.push({ at, chars: (context.systemPrompt ?? '').length + JSON.stringify(context.messages).length + JSON.stringify(context.tools ?? []).length })
        return (target.streamSimple as (...args: unknown[]) => unknown)(model, context, options)
      }
    },
  })
}

const earlier = (n: number) => `Notes from planning, part ${n}: ${'we agreed the sidebar ships first, then search, and the migration backfill runs in 200-row batches. '.repeat(6)}`
const write = (id: string, doc: string, text: string) => reply({ type: 'toolCall', id, name: 'memory_write', arguments: { doc, text } })

const percentile = (values: ReadonlyArray<number>, p: number) => {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
}
/** `promise`, or a failure naming the step that did not finish. */
const step = <A>(promise: Promise<A>, label: string, ms = 10_000): Promise<A> =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} did not finish in ${ms} ms`)), ms))])
const summary = (values: ReadonlyArray<number>) => ({ median: Math.round(percentile(values, 50) * 10) / 10, p95: Math.round(percentile(values, 95) * 10) / 10 })

it('a normal message and the run after an approved card: the agent\'s time to the model and to the first bubble', async () => {
  const sent: Sent[] = []
  const calls: unknown[] = []
  const fakeWrite: Executor = {
    tool: 'fake_write', tier: 3, deduped: false,
    run: async (c) => (calls.push(c.payload.args), { _tag: 'done', receipt: {} }),
  }
  h = await turnsHarness({ transport: (fake) => timed(fake.models, sent), actions: { executors: [fakeWrite] } })
  const harness = h
  const firstBubble = (runOf: () => string | undefined) =>
    new Promise<number>((resolve) => {
      const off = harness.turns.subscribe((event: TurnEvent) => {
        if (event._tag === 'bubble' && event.runId === runOf()) {
          off()
          resolve(performance.now())
        }
      })
    })

  // History and memory, as a chat used for a while has.
  for (let n = 1; n <= 20; n++) {
    h.fake.script(n % 5 === 0 ? [write(`w${n}`, n % 10 === 0 ? 'people' : 'you', `Fact ${n}: ${earlier(n).slice(0, 120)}`), reply(say(`Noted part ${n}.`))] : [reply(say(`Noted part ${n}.`))])
    await step(h.ended(h.send(earlier(n))), `history ${n}`)
    await h.turns.compaction.idle()
  }

  // Normal messages.
  const toRequest: number[] = []
  const toBubble: number[] = []
  const sizes: number[] = []
  for (let n = 0; n < 15; n++) {
    h.fake.script([reply(say(`Answer ${n}: Maya posted the migration plan and asked for a reviewer.`))])
    const before = sent.length
    let runId: string | undefined
    const off = h.turns.subscribe((event) => {
      if (event._tag === 'started' && runId === undefined) runId = event.runId
    })
    const bubble = firstBubble(() => runId)
    const started = performance.now()
    const op = h.send(`what is new in #eng, ${n}?`)
    const bubbled = await step(bubble, `message ${n}: first bubble`)
    off()
    await step(h.ended(op), `message ${n}: run end`)
    await h.turns.compaction.idle()
    const request = sent[before]!
    toRequest.push(request.at - started)
    toBubble.push(bubbled - started)
    sizes.push(request.chars)
  }

  // A connection call, approved on its card: the click run that goes on with its result.
  const resume = { toStart: [] as number[], toRequest: [] as number[], toBubble: [] as number[], chars: [] as number[] }
  for (let n = 0; n < 10; n++) {
    const payload = {
      _tag: 'change', server: 'Notion', target: 'Roadmap',
      action: {
        id: ActionId.make(`0199f0a0-0000-7000-8000-${String(n + 1).padStart(12, '0')}`), rev: Revision.make(1), tier: 3, deduped: false, source: SourceGeneration.make(0),
        payload: {
          connection_id: ConnectionId.make('notion'), account_id: AccountId.make('acct'), destination_ids: [], tool: 'fake_write',
          schema_hash: Digest.make('0'.repeat(64)), args: { title: `Q${n}` }, preconditions: {}, ops: [],
        },
      },
    } as CardPayload
    h.turns.actions.propose({ runId: `run-c${n}`, callId: `c-${n}`, payload })
    const view = h.turns.actions.views().find((v) => v.card._tag === 'change' && 'status' in v.card && v.card.status._tag === 'open')!
    h.fake.script([reply(say(`Done: the roadmap now says Q${n}.`))])
    const before = sent.length
    let runId: string | undefined
    let opId = ''
    let startedAt = 0
    const off = h.turns.subscribe((event) => {
      if (event._tag === 'started' && event.origin === 'click' && runId === undefined) {
        runId = event.runId
        opId = event.opId
        startedAt = performance.now()
      }
    })
    const bubble = firstBubble(() => runId)
    const clicked = performance.now()
    expect(h.turns.actions.approve(`click-${n}`, view.binding!.identity, view.binding!.children)).toEqual({ _tag: 'accepted' })
    const bubbled = await step(bubble, `card ${n}: click run's first bubble`)
    off()
    // The next card's outcome would steer this run if it were still going.
    await step(h.ended(opId), `card ${n}: click run end`)
    await h.turns.actions.idle()
    await h.turns.compaction.idle()
    const request = sent[before]!
    resume.toStart.push(startedAt - clicked)
    resume.toRequest.push(request.at - clicked)
    resume.toBubble.push(bubbled - clicked)
    resume.chars.push(request.chars)
  }
  expect(calls).toHaveLength(10)

  const report = {
    message: { toRequest: summary(toRequest), toBubble: summary(toBubble), promptChars: summary(sizes) },
    resume: { toStart: summary(resume.toStart), toRequest: summary(resume.toRequest), toBubble: summary(resume.toBubble), promptChars: summary(resume.chars) },
  }
  console.log(`turn-timing ${JSON.stringify(report)}`)

  // A regression ceiling for the agent's share of the 2.5 s first-bubble budget (docs/performance.md), with room for a
  // shared machine: the rest of the budget is the model's.
  expect(report.message.toBubble.p95).toBeLessThan(100)
  expect(report.resume.toBubble.p95).toBeLessThan(100)
})
