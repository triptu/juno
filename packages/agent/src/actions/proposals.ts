/**
 * Proposals and the local executors (plan v3 §9, §12; SPEC 13.3, 13.4).
 *
 * The model never writes a card payload. A tool call names what it wants in
 * plain arguments; the trusted side looks up the places, mints the ids, and
 * builds the exact payload the card renders and a click approves. Every
 * child action id is a fresh UUIDv7, and the payload records the memory
 * generation it was proposed in.
 *
 * Built here:
 * - `send_message`: a Send message card, Tier 3, every time (§9).
 * - The Proposed task card a `delegate` call becomes in a run that read
 *   untrusted content (§6.4), and its Start: the click mints the job's grant.
 * - The Budget card after a run blocked by the daily cap (§5.4), and its
 *   "Allow $1 more today".
 * - A Juno question's answer, which goes to the model as a click.
 */
import { Schema } from 'effect'
import {
  AccountId,
  ActionId,
  CardPayload,
  ConnectionId,
  DestinationId,
  Revision,
  SourceGeneration,
  digestJson,
  type ChildAction,
  type ExecutableIdentity,
} from '@juno/agent-cards'
import { DOLLAR, spendDay, type SpendLedger } from '../spend'
import { defineTool, type JunoTool, type ToolRun } from '../request/tool'
import { toolDecision } from '../policy/policy'
import { mintGrant } from '../grants/grants'
import type { Jobs } from '../jobs/jobs'
import { uuidv7, type Store } from '../store/store'
import { memoryGen, type Proposal } from './cards'
import type { Executor } from './executor'
import { RESOLVE_SCHEMA, RESOLVE_TOOL, SLACK_CONNECTION, SLACK_SEND_SCHEMA, type ActionHost } from './host'
import type { TopicLink } from '@juno/agent-contract'

/** Juno's own destinations: no account beyond the owner's agent. */
const JUNO = { connection: ConnectionId.make('juno'), account: AccountId.make('owner') }

export const DELEGATE_TOOL = 'delegate'
export const SPEND_RAISE_TOOL = 'spend_raise'
export const ANSWER_TOOL = 'juno_answer'
const schemaOf = (tool: string, args: Record<string, string>) => digestJson({ tool, args })
export const DELEGATE_SCHEMA = schemaOf(DELEGATE_TOOL, { title: 'string', task: 'string' })
export const SPEND_RAISE_SCHEMA = schemaOf(SPEND_RAISE_TOOL, { day: 'string' })
export const ANSWER_SCHEMA = schemaOf(ANSWER_TOOL, { prompt: 'string' })

const decode = Schema.decodeUnknownSync(CardPayload)
const encodeChild = (child: ChildAction): unknown => JSON.parse(JSON.stringify(child))

function localChild(store: Store, tool: string, schema: string, args: Schema.Json, tier: 1 | 2 | 3): ChildAction {
  const payload: ExecutableIdentity = {
    connection_id: JUNO.connection, account_id: JUNO.account, destination_ids: [], tool,
    schema_hash: schema as ExecutableIdentity['schema_hash'], args, preconditions: {}, ops: [],
  }
  // Local destinations keep the click's op or the action id as their key, so they deduplicate.
  return { id: ActionId.make(uuidv7(store.now())), rev: Revision.make(1), payload, tier, deduped: true, source: SourceGeneration.make(memoryGen(store)) }
}

/** The Proposed task a `delegate` call becomes when Juno may not start it on its own. */
export function proposedTask(store: Store, input: { readonly title: string; readonly task: string; readonly place: string; readonly because?: string }): CardPayload {
  return decode({
    _tag: 'proposedTask', kind: 'subagent', title: input.title, where: input.place,
    ...(input.because ? { because: input.because } : {}),
    action: encodeChild(localChild(store, DELEGATE_TOOL, DELEGATE_SCHEMA, { title: input.title, task: input.task }, 2)),
  })
}

const usd = (nanodollars: number) => Math.round((nanodollars / DOLLAR) * 100) / 100

/** The Budget card for today (§5.4): today's spend and cap. */
export function budgetCard(store: Store, spend: SpendLedger): CardPayload {
  const snapshot = spend.snapshot()
  return decode({
    _tag: 'budget',
    spentTodayUsd: usd(snapshot.actual + snapshot.reserved + snapshot.unknown),
    capUsd: usd(snapshot.cap + snapshot.raises),
    action: encodeChild(localChild(store, SPEND_RAISE_TOOL, SPEND_RAISE_SCHEMA, { day: snapshot.day }, 3)),
  })
}

/** A question Juno asks the owner, with two to four options and maybe a reply field. */
export function question(store: Store, input: { readonly prompt: string; readonly options: ReadonlyArray<string>; readonly freeText: boolean }): CardPayload {
  return decode({
    _tag: 'question', asks: { _tag: 'juno' }, prompt: input.prompt, freeText: input.freeText,
    options: input.options.map((label, i) => ({ id: `o${i + 1}`, label })),
    action: encodeChild(localChild(store, ANSWER_TOOL, ANSWER_SCHEMA, { prompt: input.prompt }, 3)),
  })
}


/** The local executors: a job's Start, a spend raise, a question's answer. */
export function localExecutors(options: {
  readonly store: Store
  readonly jobs: Jobs | undefined
  readonly spend: SpendLedger
  /** Where a started task runs: the subagent model's name. */
  readonly place: string
  /** The router's accept: an answer is inbox input. */
  readonly accept: (input: { readonly opId: string; readonly kind: 'click'; readonly text: string }) => unknown
  readonly cardRun: (cardId: string) => string
}): ReadonlyArray<Executor> {
  const { store } = options
  return [
    {
      tool: DELEGATE_TOOL,
      tier: 2,
      // The job is keyed by the action id: a second start finds the first job.
      deduped: true,
      check: async (payload) => (payload.schema_hash === DELEGATE_SCHEMA ? 'valid' : 'schemaChanged'),
      run: async (call) => {
        if (options.jobs === undefined) return { _tag: 'failed', detail: 'No helper model is set.' }
        const { title, task } = call.payload.args as { title: string; task: string }
        const job = options.jobs.start({
          kind: 'subagent', runId: options.cardRun(call.cardId), originOp: call.opId, callId: call.actionId, title, place: options.place, task,
        })
        // The Start click is owner authority over this job (G6).
        mintGrant(store, { opClass: 'job', target: job.id, authority: { _tag: 'click', current: true }, sourceOp: call.opId })
        return { _tag: 'done', receipt: { jobId: job.id } }
      },
    },
    {
      tool: SPEND_RAISE_TOOL,
      tier: 3,
      // `allowDollar` is keyed by the click: the same click raises once (spec `oneRaisePerClick`).
      deduped: true,
      check: async (payload) => (payload.schema_hash !== SPEND_RAISE_SCHEMA ? 'schemaChanged' : (payload.args as { day: string }).day === spendDay(store.now()) ? 'valid' : 'expired'),
      run: async (call) => {
        options.spend.allowDollar(call.opId)
        return { _tag: 'done', receipt: { day: (call.payload.args as { day: string }).day } }
      },
    },
    {
      tool: ANSWER_TOOL,
      tier: 3,
      deduped: true,
      check: async (payload) => (payload.schema_hash === ANSWER_SCHEMA ? 'valid' : 'schemaChanged'),
      run: async (call) => {
        const args = call.payload.args as { prompt: string; choice?: { answer?: { _tag: 'option'; optionId: string } | { _tag: 'text'; text: string } } }
        const answer = args.choice?.answer
        if (answer === undefined) return { _tag: 'failed', detail: 'The card has no answer.' }
        const text = answer._tag === 'text' ? answer.text : answer.optionId
        options.accept({ opId: `answer:${call.actionId}`, kind: 'click', text: `<card-answer card="${call.cardId}" ${answer._tag === 'text' ? 'reply' : 'option'}="true">${text}</card-answer>` })
        return { _tag: 'done', receipt: { opId: `answer:${call.actionId}` } }
      },
    },
  ]
}

/** A Resolve card for the signed-in account's topics. */
export function resolveCard(store: Store, input: { readonly account: string; readonly topics: ReadonlyArray<TopicLink> }): CardPayload {
  const payload: ExecutableIdentity = {
    connection_id: ConnectionId.make(SLACK_CONNECTION), account_id: AccountId.make(input.account),
    destination_ids: input.topics.map((t) => DestinationId.make(t.topicId)), tool: RESOLVE_TOOL,
    schema_hash: RESOLVE_SCHEMA, args: { topicIds: input.topics.map((t) => t.topicId) }, preconditions: {}, ops: [],
  }
  const action: ChildAction = { id: ActionId.make(uuidv7(store.now())), rev: Revision.make(1), payload, tier: 3, deduped: false, source: SourceGeneration.make(memoryGen(store)) }
  return decode({ _tag: 'resolve', topics: input.topics, action: encodeChild(action) })
}

const string = (description: string) => ({ type: 'string', description })

/** Splits a topic id: `m:<channel>` is a channel's Main, `t:<channel>:<thread ts>` a thread. */
function topicPlace(topicId: string): { readonly channelId: string; readonly threadTs?: string } | undefined {
  const main = /^m:([^:]+)$/.exec(topicId)
  if (main) return { channelId: main[1]! }
  const thread = /^t:([^:]+):([^:]+)$/.exec(topicId)
  return thread ? { channelId: thread[1]!, threadTs: thread[2]! } : undefined
}

export interface ProposeContext {
  readonly store: Store
  readonly current: () => Promise<ToolRun | undefined>
  readonly propose: (proposal: Proposal) => string
}

/**
 * `send_message`: proposes a Send message card with one to five messages.
 * Sending to Slack is Tier 3: always a card, sent once on the owner's click.
 */
export function sendMessageTool(context: ProposeContext & { readonly host: ActionHost }): JunoTool {
  return defineTool<{ readonly messages: ReadonlyArray<{ readonly topic: string; readonly text: string }> }>({
    name: 'send_message',
    description:
      'Propose messages to send to Slack as the owner. The owner sees a card with each message and sends it with one click; nothing is sent until then. ' +
      'Use only when the owner asked you to send or reply. Each message names its topic: m:<channel id> posts to a channel or DM, t:<channel id>:<thread ts> replies in a thread.',
    parameters: {
      type: 'object',
      properties: {
        messages: {
          type: 'array', minItems: 1, maxItems: 5,
          items: {
            type: 'object',
            properties: { topic: string('Where it goes: m:<channel id>, or t:<channel id>:<thread ts>'), text: string('The message, in the owner\'s voice') },
            required: ['topic', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['messages'],
      additionalProperties: false,
    },
    replay: 'safe',
    status: () => 'Writing a message',
    run: async ({ messages }, call) => {
      const run = await context.current()
      if (run === undefined) return { text: 'No card was proposed.', isError: true }
      // Tier 3: a card in every run, clean or not.
      if (toolDecision('outward', run)._tag !== 'card') return { text: 'No card was proposed.', isError: true }
      const account = context.host.account()
      if (account === undefined) return { text: 'Juno is signed out of Slack, so no message can be proposed.', isError: true }
      if (messages.length < 1 || messages.length > 5) return { text: 'Propose one to five messages.', isError: true }
      const rows = []
      for (const message of messages) {
        const place = topicPlace(message.topic)
        if (place === undefined) return { text: `${message.topic} is not a topic id.`, isError: true }
        if (message.text.trim() === '') return { text: 'A message is empty.', isError: true }
        let found
        try {
          found = await context.host.topic(message.topic)
        } catch {
          return { text: `Juno could not find ${message.topic}.`, isError: true }
        }
        rows.push({
          id: uuidv7(context.store.now()), actionId: uuidv7(context.store.now()), rev: 1, source: memoryGen(context.store),
          connectionId: SLACK_CONNECTION, accountId: account, schemaHash: SLACK_SEND_SCHEMA,
          target: found.place,
          ...(place.threadTs === undefined ? {} : { inTopic: found.topic, threadTs: place.threadTs }),
          text: message.text, preconditions: {},
        })
      }
      const id = context.propose({ runId: run.runId, callId: call.callId, payload: decode({ _tag: 'sendMessage', messages: rows }) })
      const where = rows.map((row) => row.target.name).join(', ')
      return { text: `Proposed card ${id}: send to ${where}. Nothing is sent until the owner clicks Send.` }
    },
  })
}
