/**
 * Single-attempt dispatch (plan v3 §6.3): the host side of an authorization
 * the agent already consumed. The rules:
 *
 * - The attempt is recorded before the Slack call. A send whose
 *   authorization is recorded is answered from the record and never calls
 *   Slack again, whether the first call is still running, finished, or was
 *   cut off by an agent or engine restart.
 * - The call runs in the dispatcher's scope, not the request's, so an agent
 *   that dies mid-send does not interrupt it; the next request with the same
 *   authorization gets its result.
 * - A record left `submitted` by an engine that stopped is `unknown`: the
 *   call may or may not have reached Slack.
 * - Only positive evidence settles an unknown send: a message in Slack with
 *   the send's `client_msg_id`, from the owner, with the recorded text and
 *   place. Slack stores text with `&`, `<` and `>` escaped, so both texts
 *   are escaped the same way before they are compared. A missing match
 *   stays unknown.
 */
import { Deferred, Effect } from 'effect'
import { AgentHostError, type HostDispatchResult } from '@juno/agent-contract'
import { JunoHost, type Attempt, type AttemptRecord, type AttemptState, type Dispatch, type Message, type PostOutcome } from './host'

type Result = typeof HostDispatchResult.Type
type CancelResult = Result | { readonly _tag: 'cancel-requested' } | { readonly _tag: 'cancelled' }

/** The executable tool a Slack send carries. `args` is `{ channelId, text, threadTs? }` and `destination_ids` is `[channelId]`. */
export const SLACK_SEND_TOOL = 'slack_send'

const rejected = (message: string) => new AgentHostError({ reason: 'rejected', message })

/** The Slack send a dispatch payload names, or why it is not one. */
export function parseSend(dispatch: Dispatch): Attempt | AgentHostError {
  const { payload } = dispatch
  if (payload.tool !== SLACK_SEND_TOOL) return rejected(`not a Slack send: ${payload.tool}`)
  const args = payload.args
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return rejected('args must be an object')
  const { channelId, text, threadTs } = args as Record<string, unknown>
  if (typeof channelId !== 'string' || channelId === '') return rejected('args.channelId must be a channel id')
  if (typeof text !== 'string' || text.trim() === '') return rejected('args.text must not be empty')
  if (threadTs !== undefined && typeof threadTs !== 'string') return rejected('args.threadTs must be a ts')
  if (payload.destination_ids.length !== 1 || payload.destination_ids[0] !== channelId) return rejected('destination_ids must be [args.channelId]')
  return {
    authorizationId: dispatch.authorizationId,
    attemptId: dispatch.attemptId,
    actionId: dispatch.actionId,
    channelId,
    text,
    ...(threadTs === undefined ? {} : { threadTs }),
  }
}

/**
 * Text as Slack stores it: `&`, `<` and `>` escaped. An `&` that already
 * starts one of the three entities is left alone, so Slack's copy, which is
 * escaped already, comes out unchanged.
 */
export const slackEscaped = (text: string): string =>
  text.replace(/&(?!amp;|lt;|gt;)/g, '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Whether `message` proves `attempt` landed: Slack's copy of exactly this send, from the owner. */
export const proves = (attempt: Attempt, userId: string, message: Message): boolean =>
  message.clientMessageId === attempt.actionId &&
  message.senderId === userId &&
  message.channelId === attempt.channelId &&
  slackEscaped(message.text) === slackEscaped(attempt.text) &&
  (message.threadTs ?? undefined) === attempt.threadTs

const resultOf = (attemptId: Dispatch['attemptId'], state: Exclude<AttemptState, { _tag: 'submitted' }>): Result => {
  switch (state._tag) {
    case 'done':
      return { _tag: 'done', attemptId, receipt: state.receipt }
    case 'failed':
      return { _tag: 'failed', attemptId, reason: state.reason }
    case 'cancelled':
      return { _tag: 'failed', attemptId, reason: 'cancelled' }
    case 'unknown':
      return { _tag: 'unknown', attemptId }
  }
}

type Settled = Exclude<AttemptState, { _tag: 'submitted' | 'cancelled' }>

const settledBy = (attempt: Attempt, outcome: PostOutcome): Settled => {
  switch (outcome._tag) {
    case 'posted':
      return { _tag: 'done', receipt: { channelId: attempt.channelId, ts: outcome.ts } }
    case 'refused':
      return { _tag: 'failed', reason: outcome.reason }
    case 'lost':
      return { _tag: 'unknown' }
  }
}

export const makeDispatcher = Effect.gen(function* () {
  const host = yield* JunoHost
  const scope = yield* Effect.scope
  // Sends in flight in this engine, by authorization. Set before the record is written, so a
  // concurrent repeat waits for this call, and a `submitted` record not in here is an orphan.
  const inFlight = new Map<string, Deferred.Deferred<Result, AgentHostError>>()

  /** A `submitted` record no call in this engine owns: the engine stopped mid-call. */
  const orphaned = (record: AttemptRecord) =>
    host.attempts.settle(record.authorizationId, { _tag: 'unknown' }).pipe(Effect.as<Result>({ _tag: 'unknown', attemptId: record.attemptId }))

  const answer = (record: AttemptRecord): Effect.Effect<Result, AgentHostError> =>
    record.state._tag === 'submitted' ? orphaned(record) : Effect.succeed(resultOf(record.attemptId, record.state))

  const run = (attempt: Attempt, done: Deferred.Deferred<Result, AgentHostError>) =>
    Effect.gen(function* () {
      const prior = yield* host.attempts.claim(attempt)
      if (prior !== undefined) return yield* answer(prior)
      const state = settledBy(attempt, yield* host.post(attempt))
      // The call happened, so its outcome is the answer even if the record cannot be written now
      // (signed out meanwhile); the row then stays `submitted` and reads as unknown later.
      yield* host.attempts.settle(attempt.authorizationId, state).pipe(Effect.ignore)
      return resultOf(attempt.attemptId, state)
    }).pipe(
      Effect.exit,
      Effect.flatMap((exit) => Deferred.done(done, exit)),
      Effect.ensuring(Effect.sync(() => inFlight.delete(attempt.authorizationId))),
    )

  const send = (attempt: Attempt): Effect.Effect<Result, AgentHostError> =>
    Effect.suspend(() => {
      const running = inFlight.get(attempt.authorizationId)
      if (running !== undefined) return Deferred.await(running)
      const done = Deferred.makeUnsafe<Result, AgentHostError>()
      inFlight.set(attempt.authorizationId, done)
      return Effect.forkIn(run(attempt, done), scope).pipe(Effect.andThen(Deferred.await(done)))
    })

  /** A call already made cannot be taken back: in flight it is `cancel-requested`, settled it keeps its result. */
  const cancel = (authorizationId: Dispatch['authorizationId'], attemptId: Dispatch['attemptId']): Effect.Effect<CancelResult, AgentHostError> =>
    Effect.gen(function* () {
      if (inFlight.has(authorizationId)) return { _tag: 'cancel-requested' as const }
      const prior = yield* host.attempts.cancel(authorizationId, attemptId)
      if (prior === undefined || prior.state._tag === 'cancelled') return { _tag: 'cancelled' as const }
      if (prior.state._tag === 'submitted' && inFlight.has(authorizationId)) return { _tag: 'cancel-requested' as const }
      return yield* answer(prior)
    })

  /** Looks for the send in Slack. Settles an unknown record on positive evidence; never on a miss. */
  const reconcile = (attemptId: Dispatch['attemptId'], channelId: string, actionId: Dispatch['actionId'], userId: string) =>
    Effect.gen(function* () {
      const record = yield* host.attempts.byAttempt(attemptId)
      if (record === undefined || record.actionId !== actionId || record.channelId !== channelId) return { _tag: 'unknown' as const }
      const found = (yield* host.sent(channelId, record.threadTs, actionId)).find((message) => proves(record, userId, message))
      if (found === undefined) return { _tag: 'unknown' as const }
      const open = record.state._tag === 'unknown' || (record.state._tag === 'submitted' && !inFlight.has(record.authorizationId))
      if (open) yield* host.attempts.settle(record.authorizationId, { _tag: 'done', receipt: { channelId, ts: found.ts } })
      return { _tag: 'found' as const, message: found }
    })

  return { send, cancel, reconcile }
})
