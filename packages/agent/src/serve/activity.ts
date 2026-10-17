/**
 * The Activity page (SPEC 13.9): one row per finished run, newest first,
 * saying what started it, what it read, what it did and what the owner
 * decided, with its model and cost. Built from the run log
 * (`router/steps.ts`), the run's sources and cards, and the inbox op that
 * started it. A window of runs is read with the index, never the whole log.
 */
import {
  ACTIVITY_STEPS_MAX,
  type ActivityPage,
  type ActivityRun,
  type ActivityStep,
  type ActivityTrigger,
  type Ending,
  type RunId,
  type RunOutcome,
} from '@juno/agent-contract'
import { activityActions } from '../actions/activity'
import { activityScripts } from '../scripts'
import { SCRIPT_TOOL } from '../runtime/codemode'
import type { Origin } from '../router/events'
import { parseOutput } from '../router/output'
import { clip } from '../router/steps'
import type { Store } from '../store/store'
import type { PageWindow } from './pages'

/** A trigger's words, cut for one line. */
const TRIGGER_MAX = 120
/** A step's input or result, cut for one line of the expanded row. */
const STEP_MAX = 160

const outcomeOf = (ending: Ending, quiet: boolean): RunOutcome => {
  switch (ending._tag) {
    case 'complete':
      return quiet ? 'stayedQuiet' : 'replied'
    case 'interrupted':
      return 'interrupted'
    case 'blocked':
      return 'blocked'
    case 'failed':
      return 'failed'
  }
}

type RunRow = { id: string; opId: string; origin: Origin; clean: number; at: number; ending: string }
type InboxRow = { kind: string; text: string; data: string | null }
type StepRow = { tool: string; args: string; outcome: 'running' | 'done' | 'failed'; detail: string | null }

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
const record = (value: unknown): Readonly<Record<string, unknown>> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The model names a connection by its id or a slug of its label (`mcp/manager.ts`). */
const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)

/** An argument as one line shows it: a string as itself, anything else as JSON. */
const shownValue = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

/** The page's queries, prepared once per build. */
function queries(store: Store) {
  const has = (table: string) => store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined
  const connections = has('mcp_connections')
    ? (store.db.prepare("SELECT id, json_extract(config, '$.label') AS label FROM mcp_connections").all() as Array<{ id: string; label: string | null }>)
    : []
  const labels = new Map<string, string>()
  for (const row of connections) {
    const label = row.label ?? row.id
    labels.set(row.id, label)
    labels.set(slug(label), label)
  }
  return {
    said: store.db.prepare("SELECT text FROM messages WHERE kind = 'juno' AND origin_op = ? ORDER BY id"),
    inbox: store.db.prepare('SELECT kind, text, data FROM inbox WHERE op_id = ?'),
    steps: store.db.prepare('SELECT tool, args, outcome, detail FROM run_steps WHERE run_id = ? ORDER BY seq'),
    places: store.db.prepare('SELECT channel_id AS channel, place FROM sources WHERE run_id = ? ORDER BY rowid'),
    usage: store.db.prepare('SELECT name, cost FROM run_usage WHERE run_id = ? ORDER BY rowid'),
    job: store.db.prepare('SELECT title FROM jobs WHERE id = ?'),
    schedule: has('schedules') ? store.db.prepare("SELECT json_extract(definition, '$.what') AS what FROM schedules WHERE id = ?") : undefined,
    question: store.db.prepare("SELECT payload FROM card_revisions WHERE card_id = ? ORDER BY revision DESC LIMIT 1"),
    steered: store.db.prepare("SELECT inbox.kind, inbox.text, inbox.data, inbox.op_id AS opId FROM run_inputs JOIN inbox ON inbox.op_id = run_inputs.op_id WHERE run_inputs.run_id = ? AND run_inputs.steer = 1"),
    connection: (name: unknown) => (typeof name === 'string' ? (labels.get(name) ?? labels.get(slug(name)) ?? name) : 'a connection'),
  }
}
type Queries = ReturnType<typeof queries>

/** "Daily catch-up", "Fix the sidebar flake": a job's title from a report op, `report:<job>:<seq>:<event>`. */
const jobTitle = (q: Queries, opId: string): string | undefined => (q.job.get(opId.split(':')[1] ?? '') as { title: string } | undefined)?.title

function triggerOf(q: Queries, run: RunRow): ActivityTrigger {
  const op = q.inbox.get(run.opId) as InboxRow | undefined
  const data = record(parse(op?.data ?? 'null'))
  switch (run.origin) {
    case 'wake': {
      const id = text(data['scheduleId'])
      const what = id === undefined ? undefined : (q.schedule?.get(id) as { what: string | null } | undefined)?.what
      return { _tag: 'schedule', name: what ?? 'A schedule' }
    }
    case 'report':
      return { _tag: 'job', name: jobTitle(q, run.opId) ?? 'A job' }
    case 'click': {
      // `<card-answer card="…">`: the Question card the owner answered.
      const card = /card="([^"]+)"/.exec(op?.text ?? '')?.[1]
      const payload = card === undefined ? undefined : record(parse((q.question.get(card) as { payload: string } | undefined)?.payload ?? 'null'))
      return { _tag: 'answer', question: clip(text(payload?.['prompt']) ?? 'A question', TRIGGER_MAX) }
    }
    case 'owner': {
      if (op?.kind === 'react') return { _tag: 'reaction', emoji: text(data['emoji']) ?? op.text }
      const files = Array.isArray(data['files']) ? data['files'].length : 0
      return { _tag: 'message', words: clip(op?.text ?? '', TRIGGER_MAX), files }
    }
  }
}

/** What the step's tool did, in words, and the arguments worth showing beside it. */
function describe(q: Queries, step: StepRow, place: (channel: unknown) => string | undefined): { readonly label: string; readonly input?: string } {
  const args = record(parse(step.args))
  const rest = (...hidden: ReadonlyArray<string>): string | undefined => {
    const shown = Object.entries(args).filter(([key, value]) => !hidden.includes(key) && value !== undefined && value !== '')
    if (shown.length === 0) return step.args === '' || step.args === '{}' || parse(step.args) !== undefined ? undefined : step.args
    return shown.length === 1 ? shownValue(shown[0]![1]) : shown.map(([key, v]) => `${key}: ${shownValue(v)}`).join(', ')
  }
  switch (step.tool) {
    case 'slack_search':
      return { label: 'Searched Slack', ...opt(rest()) }
    case 'slack_history':
      return { label: `Read ${place(args['channel']) ?? 'a conversation'}` }
    case 'slack_replies':
      return { label: `Read a thread in ${place(args['channel']) ?? 'a conversation'}` }
    case 'slack_topics':
      return { label: 'Listed your topics' }
    case 'slack_person':
      return { label: 'Looked up a person' }
    case 'slack_channels':
      return { label: 'Found channels', ...opt(rest()) }
    case 'find_tools':
      return { label: args['server'] === undefined ? 'Looked up connections' : `Looked up ${q.connection(args['server'])} tools`, ...opt(rest('server')) }
    case 'call_tool':
      return { label: `Used ${q.connection(args['server'])}: ${text(args['tool']) ?? 'a tool'}`, ...opt(args['args'] === undefined ? undefined : JSON.stringify(args['args'])) }
    case 'send_message':
      return { label: 'Drafted a message' }
    case 'topics_resolve':
      return { label: 'Proposed resolving topics' }
    case 'delegate':
      return { label: 'Started a task', ...opt(text(args['title'])) }
    case 't3_start':
      return { label: 'Proposed a T3 Code session', ...opt(text(args['title'])) }
    case 't3_send':
      return { label: 'Sent task instructions' }
    case 't3_stop':
      return { label: 'Stopped a task' }
    case 'schedule_create':
      return { label: 'Set a schedule', ...opt(text(args['what'])) }
    case 'schedule_change':
      return { label: 'Changed a schedule', ...opt(text(args['action'])) }
    case 'remember':
      return { label: 'Remembered a line' }
    case 'remove_messages':
      return { label: 'Proposed a removal' }
    case 'juno_views':
      return { label: 'Changed sidebar views' }
    case 'juno_harnessTurn':
      return { label: 'Asked Codex' }
    case 'juno_answer':
      return { label: 'Asked you a question' }
    case 'spend_raise':
      return { label: 'Asked for more budget' }
    default:
      return step.tool === SCRIPT_TOOL ? { label: 'Ran a script' } : { label: step.tool, ...opt(rest()) }
  }
}

const opt = (input: string | undefined): { readonly input?: string } => (input === undefined || input === '' ? {} : { input: clip(input, STEP_MAX) })

/** What came back: the tool's count, an error's text, or the first line of Juno's own text. */
const resultOf = (step: StepRow): string | undefined => (step.detail === null || step.detail === '' ? undefined : clip(step.detail, STEP_MAX))

/**
 * What the run read from outside Juno, by name, in the order it first read
 * it: what came with the input (the topic beside the chat, attached files,
 * a job's report), the channels its reads returned messages from, and the
 * connections it used.
 */
function sourcesOf(q: Queries, run: RunRow, steps: ReadonlyArray<StepRow>, places: ReadonlyArray<{ channel: string; place: string | null }>, scriptServers: ReadonlyArray<unknown>): ReadonlyArray<string> {
  const names: Array<string> = []
  const add = (name: string | undefined) => {
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  const inputs = [{ ...(q.inbox.get(run.opId) as InboxRow | undefined), opId: run.opId }, ...(q.steered.all(run.id) as Array<InboxRow & { opId: string }>)]
  for (const input of inputs) {
    if (input.kind === undefined) continue
    const data = record(parse(input.data ?? 'null'))
    const context = record(data['context'])
    if (context['_tag'] === 'topic') add(text(context['title']) ?? 'the topic beside the chat')
    const files = Array.isArray(data['files']) ? data['files'].length : 0
    if (files > 0) add(plural(files, 'attached file'))
    if (input.kind === 'report') add(`the report from ${jobTitle(q, input.opId) ?? 'a job'}`)
  }
  for (const row of places) add(row.place ?? 'Slack')
  // A Slack read that returned no named channel still read Slack.
  if (places.length === 0 && steps.some((step) => step.tool.startsWith('slack_') && step.tool !== 'slack_channels')) add('Slack')
  for (const step of steps) {
    if (step.tool === 'find_tools' || step.tool === 'call_tool') {
      const server = record(parse(step.args))['server']
      if (server !== undefined) add(q.connection(server))
    }
  }
  for (const server of scriptServers) add(q.connection(server))
  return names
}

function runOf(store: Store, q: Queries, run: RunRow): ActivityRun {
  const said = (q.said.all(run.opId) as Array<{ text: string }>).map((row) => row.text).join('\n\n')
  const steps = q.steps.all(run.id) as Array<StepRow>
  const places = q.places.all(run.id) as Array<{ channel: string; place: string | null }>
  const placeOf = new Map(places.flatMap((row) => (row.place === null ? [] : [[row.channel, row.place] as const])))
  const place = (channel: unknown) => (typeof channel === 'string' ? placeOf.get(channel) : undefined)
  const scripts = activityScripts(store, run.id)
  const scriptServers = (scripts.scriptCalls ?? []).flatMap((call) => (call.tool === 'connection_read' ? [record(parse(call.args))['server']] : []))
  const usage = q.usage.all(run.id) as Array<{ name: string; cost: number | null }>
  const shown: ReadonlyArray<ActivityStep> = steps.slice(0, ACTIVITY_STEPS_MAX).map((step) => {
    const result = resultOf(step)
    return { ...describe(q, step, place), ...(result === undefined ? {} : { result }), outcome: step.outcome === 'running' ? 'unfinished' : step.outcome }
  })
  const cost = usage.length === 0 || usage.some((row) => row.cost === null) ? undefined : usage.reduce((sum, row) => sum + (row.cost ?? 0), 0)
  return {
    id: run.id as RunId,
    trigger: triggerOf(q, run),
    at: run.at,
    outcome: outcomeOf(JSON.parse(run.ending) as Ending, parseOutput(said).bubbles.length === 0),
    actions: activityActions(store, run.id),
    sources: sourcesOf(q, run, steps, places, scriptServers),
    ...scripts,
    steps: shown,
    ...(steps.length > shown.length ? { moreSteps: steps.length - shown.length } : {}),
    tainted: run.clean === 0,
    ...(usage.length === 0 ? {} : { model: usage.map((row) => row.name).join(', ') }),
    ...(cost === undefined ? {} : { costUsd: cost }),
  }
}

/** Runs that have ended, newest first; the live run shows in the chat. `cursor` is the oldest run already shown. */
export function activityPage(store: Store, window: PageWindow): ActivityPage {
  const before = window.cursor === undefined ? undefined : (store.db.prepare('SELECT started_at AS at, id FROM runs WHERE id = ?').get(window.cursor) as { at: number; id: string } | undefined)
  const rows = store.db
    .prepare(
      `SELECT id, op_id AS opId, origin, clean, started_at AS at, ending FROM runs
       WHERE ended_at IS NOT NULL AND (? IS NULL OR (started_at, id) < (?, ?))
       ORDER BY started_at DESC, id DESC LIMIT ?`,
    )
    .all(before?.at ?? null, before?.at ?? 0, before?.id ?? '', window.limit + 1) as Array<RunRow>
  const q = queries(store)
  return { runs: rows.slice(0, window.limit).map((run) => runOf(store, q, run)), moreAbove: rows.length > window.limit }
}
