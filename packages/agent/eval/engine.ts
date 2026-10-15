/**
 * Runs one case on the real turn engine: the store, journal, router, request
 * builder, prompt, tools and guard the app runs, in a fresh agent directory,
 * with the invented Slack behind the read port. Only the provider differs:
 * the scripted fake in CI, OpenRouter in live runs.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BubbleId, Ending } from '@juno/agent-contract'
import { openTurns, sourceTable, type ModelRef, type ProviderGuardApi, type TurnEvent, type Turns } from '../src/index'
import type { Store } from '../src/store/store'
import { fromArchive, handleTable, unique, type StepTrace, type Trace } from './trace'
import { fakeActionHost } from '@juno/agent-testing'
import { recordingHost } from './world'

/** One owner action. `react` reacts to Juno's latest bubble. */
export type Step = { readonly send: string } | { readonly react: string }

/** What the engine runs on for one case. */
export interface Backend {
  /** The chat model. */
  readonly model: ModelRef
  /** The helper model for `delegate`. No compactor runs: cases are short. */
  readonly helper: ModelRef
  readonly provider: (store: Store) => ProviderGuardApi
}

export class StepTimeout extends Error {}

export async function runSteps(steps: ReadonlyArray<Step>, backend: Backend, timeoutMs: number): Promise<Trace> {
  const dir = await mkdtemp(join(tmpdir(), 'juno-eval-'))
  const { host, read } = recordingHost()
  const errors: unknown[] = []
  // Cards need the host's actions to look up a message's place. Nothing is clicked, so nothing is sent.
  const actions = { host: fakeActionHost().host }
  const opened = await openTurns({ agentDir: dir, provider: backend.provider, model: backend.model, subagent: backend.helper, host, actions, onReport: (e) => errors.push(e) })
  if (opened._tag !== 'running') throw new Error('a fresh engine did not open')
  const turns: Turns = opened
  const events: TurnEvent[] = []
  const off = turns.subscribe((event) => events.push(event))
  const traces: StepTrace[] = []
  try {
    for (const [i, step] of steps.entries()) {
      const firstEvent = events.length
      const firstRead = read().length
      const firstRow = nextRow(turns)
      const opId = `eval-${i + 1}`
      let input: string
      if ('send' in step) {
        input = `Owner: ${step.send}`
        turns.accept({ opId, kind: 'send', text: step.send })
      } else {
        const last = events.findLast((e): e is Extract<TurnEvent, { _tag: 'bubble' }> => e._tag === 'bubble')
        if (last === undefined) throw new Error(`step ${i + 1} reacts, but Juno has said nothing`)
        input = `Owner reacted ${step.react} to Juno's bubble: "${last.text}"`
        turns.accept({ opId, kind: 'react', target: { _tag: 'bubble', id: last.id as BubbleId }, emoji: step.react })
      }
      await within(turns.idle(), timeoutMs)
      await settle(turns)
      const stepEvents = events.slice(firstEvent)
      const stepRead = unique(read().slice(firstRead))
      traces.push({
        input,
        ...fromArchive(turns.messages(firstRow, 10_000)),
        read: stepRead,
        handles: handleTable(stepEvents.flatMap((e) => (e._tag === 'started' ? [sourceTable(turns.store, e.runId)] : [])), read()),
        endings: stepEvents.flatMap((e): Ending[] => (e._tag === 'ended' ? [e.ending] : [])),
        remembered: stepEvents.flatMap((e) => (e._tag === 'remembered' ? [e.text] : [])),
      })
    }
  } finally {
    off()
    await turns.close()
    await rm(dir, { recursive: true, force: true })
  }
  return { steps: traces }
}

const nextRow = (turns: Turns) => (turns.store.db.prepare('SELECT coalesce(max(id) + 1, 0) AS id FROM messages').get() as { id: number }).id

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new StepTimeout(`no answer within ${ms / 1000} s`)), ms)))
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The projection tails the journal after each commit, so the archive can be
 * a moment behind when the run settles. Waits until it has caught up with
 * the journal, or has not grown for 200 ms (the last commits may add no
 * entries, and then the cursor stays behind).
 */
async function settle(turns: Turns): Promise<void> {
  let rows = -1
  let still = 0
  while (still < 8) {
    const { incarnation, seq } = await turns.position()
    const cursor = (turns.store.db.prepare('SELECT cursor FROM incarnations WHERE id = ?').get(incarnation) as { cursor: number } | undefined)?.cursor
    if (cursor === seq) return
    const now = nextRow(turns)
    still = now === rows ? still + 1 : 0
    rows = now
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
