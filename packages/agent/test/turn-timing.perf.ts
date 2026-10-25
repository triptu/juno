// The agent's own time in a Juno turn, a budget checked only by bun run perf --unit on the Mac: on the fake model, which answers at
// once, every millisecond between the owner's send and Juno's first bubble is the agent's. A chat with
// history (twenty earlier runs, summarised by the compactor) and memory docs with an outline, then:
//
// - a normal message: send → the model request → the first bubble;
// - a connection call the owner approves on its card: click → the click run starts → its model request
//   → its first bubble, the run that carries the call's result (`carryOutcomes`).
//
// It prints each request's size (system text, messages and tools), so a prompt that grows shows here too.
import { afterEach, expect, it } from 'bun:test'
import { reply } from '@juno/agent-testing'
import { ActionId, ConnectionId, AccountId, Digest, Revision, SourceGeneration, type CardPayload } from '@juno/agent-cards'
import type { Executor, TurnEvent } from '../src/index'
import { HAIKU, say, turnsHarness } from './turns-harness'
import { perfBudget } from '@juno/testing/perf-budget'

type Models = Parameters<NonNullable<Parameters<typeof turnsHarness>[0]>['transport'] & {}>[0]['models']
type Sent = { readonly at: number; readonly chars: number }
type Harness = Awaited<ReturnType<typeof turnsHarness>>

let h: Harness | undefined
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

/** When the first bubble of the run `runOf` names is emitted. */
const firstBubble = (harness: Harness, runOf: () => string | undefined) =>
  new Promise<number>((resolve) => {
    const off = harness.turns.subscribe((event: TurnEvent) => {
      if (event._tag === 'bubble' && event.runId === runOf()) {
        off()
        resolve(performance.now())
      }
    })
  })

/** Twenty earlier runs, four of them writing to memory, as a chat used for a while has. */
async function history(harness: Harness) {
  for (let n = 1; n <= 20; n++) {
    harness.fake.script(n % 5 === 0 ? [write(`w${n}`, n % 10 === 0 ? 'people' : 'you', `Fact ${n}: ${earlier(n).slice(0, 120)}`), reply(say(`Noted part ${n}.`))] : [reply(say(`Noted part ${n}.`))])
    await step(harness.ended(harness.send(earlier(n))), `history ${n}`)
    await harness.turns.compaction.idle()
  }
}

/** Fifteen normal messages: send to the model request and to the first bubble, and the request's size. */
async function messages(harness: Harness, sent: Sent[]) {
  const times = { toRequest: [] as number[], toBubble: [] as number[], chars: [] as number[] }
  for (let n = 0; n < 15; n++) {
    harness.fake.script([reply(say(`Answer ${n}: Maya posted the migration plan and asked for a reviewer.`))])
    const before = sent.length
    let runId: string | undefined
    const off = harness.turns.subscribe((event) => {
      if (event._tag === 'started' && runId === undefined) runId = event.runId
    })
    const bubble = firstBubble(harness, () => runId)
    const started = performance.now()
    const op = harness.send(`what is new in #eng, ${n}?`)
    const bubbled = await step(bubble, `message ${n}: first bubble`)
    off()
    await step(harness.ended(op), `message ${n}: run end`)
    await harness.turns.compaction.idle()
    const request = sent[before]!
    times.toRequest.push(request.at - started)
    times.toBubble.push(bubbled - started)
    times.chars.push(request.chars)
  }
  return times
}

/** A connection call the `fake_write` executor runs, as a Change card. */
const changeCard = (n: number) =>
  ({
    _tag: 'change', server: 'Notion', target: 'Roadmap',
    action: {
      id: ActionId.make(`0199f0a0-0000-7000-8000-${String(n + 1).padStart(12, '0')}`), rev: Revision.make(1), tier: 3, deduped: false, source: SourceGeneration.make(0),
      payload: {
        connection_id: ConnectionId.make('notion'), account_id: AccountId.make('acct'), destination_ids: [], tool: 'fake_write',
        schema_hash: Digest.make('0'.repeat(64)), args: { title: `Q${n}` }, preconditions: {}, ops: [],
      },
    },
  }) as CardPayload

/** Ten connection calls approved on their cards: click to the click run that goes on with the result, its request and its first bubble. */
async function approvedCards(harness: Harness, sent: Sent[]) {
  const times = { toStart: [] as number[], toRequest: [] as number[], toBubble: [] as number[], chars: [] as number[] }
  for (let n = 0; n < 10; n++) {
    harness.turns.actions.propose({ runId: `run-c${n}`, callId: `c-${n}`, payload: changeCard(n) })
    const view = harness.turns.actions.views().find((v) => v.card._tag === 'change' && 'status' in v.card && v.card.status._tag === 'open')!
    harness.fake.script([reply(say(`Done: the roadmap now says Q${n}.`))])
    const before = sent.length
    let run: { readonly runId: string; readonly opId: string; readonly at: number } | undefined
    const off = harness.turns.subscribe((event) => {
      if (event._tag === 'started' && event.origin === 'click' && run === undefined) run = { runId: event.runId, opId: event.opId, at: performance.now() }
    })
    const bubble = firstBubble(harness, () => run?.runId)
    const clicked = performance.now()
    expect(harness.turns.actions.approve(`click-${n}`, view.binding!.identity, view.binding!.children)).toEqual({ _tag: 'accepted' })
    const bubbled = await step(bubble, `card ${n}: click run's first bubble`)
    off()
    // The next card's outcome would steer this run if it were still going.
    await step(harness.ended(run!.opId), `card ${n}: click run end`)
    await harness.turns.actions.idle()
    await harness.turns.compaction.idle()
    const request = sent[before]!
    times.toStart.push(run!.at - clicked)
    times.toRequest.push(request.at - clicked)
    times.toBubble.push(bubbled - clicked)
    times.chars.push(request.chars)
  }
  return times
}

it('a normal message and the run after an approved card: the agent\'s time to the model and to the first bubble', async () => {
  const sent: Sent[] = []
  const calls: unknown[] = []
  const fakeWrite: Executor = {
    tool: 'fake_write', tier: 3, deduped: false,
    run: async (c) => (calls.push(c.payload.args), { _tag: 'done', receipt: {} }),
  }
  h = await turnsHarness({ transport: (fake) => timed(fake.models, sent), actions: { executors: [fakeWrite] } })
  await history(h)
  const message = await messages(h, sent)
  const resume = await approvedCards(h, sent)
  expect(calls).toHaveLength(10)

  const report = {
    message: { toRequest: summary(message.toRequest), toBubble: summary(message.toBubble), promptChars: summary(message.chars) },
    resume: { toStart: summary(resume.toStart), toRequest: summary(resume.toRequest), toBubble: summary(resume.toBubble), promptChars: summary(resume.chars) },
  }
  console.log(`turn-timing ${JSON.stringify(report)}`)

  // A regression ceiling for the agent's share of the 2.5 s first-bubble budget (docs/performance.md), with room for a
  // shared machine: the rest of the budget is the model's.
  perfBudget('turn timing: message to first bubble p95', report.message.toBubble.p95, 100)
  perfBudget('turn timing: run after an approved card to first bubble p95', report.resume.toBubble.p95, 100)
}, 300_000)
