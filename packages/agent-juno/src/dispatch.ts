/**
 * Dispatch of an approved Slack send (plan v3 §6.3): the host side of an
 * authorization the agent already consumed. The rules:
 *
 * - The payload must hash to the dispatch's digest, and the engine must
 *   hold an unused click on that action and digest. Without both nothing
 *   is recorded or sent (`claim`).
 * - The send goes through the composer's outbox: the attempt is recorded
 *   and the post queued in one transaction, and `PostWorker` sends it with
 *   the composer's rules. It shows in the topic at once, waits out a lost
 *   connection, and is posted at most once (specs/outbox.qnt).
 * - A send whose authorization is recorded is answered from the record and
 *   never queued again, whether its post is still waiting, settled, or was
 *   cut off by an agent or engine restart. A waiting post is followed to
 *   its end.
 * - The wait runs in the dispatcher's scope, not the request's, so an agent
 *   that dies mid-send does not interrupt it; the next request with the same
 *   authorization gets its result.
 * - Only positive evidence settles an unknown send: a message in Slack with
 *   the send's `client_msg_id`, from the owner, with the recorded text and
 *   place. Slack stores text with `&`, `<` and `>` escaped, so both texts
 *   are escaped the same way before they are compared. A missing match
 *   stays unknown.
 */
import { Deferred, Effect } from 'effect'
import { actionDigest, AgentHostError, type HostDispatchResult } from '@juno/agent-contract'
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
  if (!digestMatches(dispatch)) return rejected('The payload differs from its digest.')
  return {
    authorizationId: dispatch.authorizationId,
    attemptId: dispatch.attemptId,
    actionId: dispatch.actionId,
    channelId,
    text,
    ...(threadTs === undefined ? {} : { threadTs }),
  }
}

/** Whether the payload is the one the digest names. A click approves the digest, so this binds the payload to the click. */
export const digestMatches = (dispatch: Dispatch): boolean => {
  try {
    return actionDigest(dispatch.payload) === dispatch.digest
  } catch {
    return false
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
  // Sends this engine is following, by authorization. Set before the record is written, so a
  // concurrent repeat waits for this one.
  const inFlight = new Map<string, Deferred.Deferred<Result, AgentHostError>>()

  /** Waits for the post to settle and records how. */
  const follow = (attempt: Attempt) =>
    Effect.gen(function* () {
      const state = settledBy(attempt, yield* host.posted(attempt))
      // The outcome is the answer even if the record cannot be written now (signed out meanwhile);
      // the row then stays `submitted`, and the next request follows the post again.
      yield* host.attempts.settle(attempt.authorizationId, state).pipe(Effect.ignore)
      return resultOf(attempt.attemptId, state)
    })

  const answer = (record: AttemptRecord): Effect.Effect<Result, AgentHostError> =>
    record.state._tag === 'submitted' ? follow(record) : Effect.succeed(resultOf(record.attemptId, record.state))

  /** Runs `work` once per authorization in the dispatcher's scope; a concurrent request for it waits for the same result. */
  const once = (authorizationId: string, work: Effect.Effect<Result, AgentHostError>): Effect.Effect<Result, AgentHostError> =>
    Effect.suspend(() => {
      const running = inFlight.get(authorizationId)
      if (running !== undefined) return Deferred.await(running)
      const done = Deferred.makeUnsafe<Result, AgentHostError>()
      inFlight.set(authorizationId, done)
      const run = work.pipe(
        Effect.exit,
        Effect.flatMap((exit) => Deferred.done(done, exit)),
        Effect.ensuring(Effect.sync(() => inFlight.delete(authorizationId))),
      )
      return Effect.forkIn(run, scope).pipe(Effect.andThen(Deferred.await(done)))
    })

  const send = (attempt: Attempt, digest: string): Effect.Effect<Result, AgentHostError> =>
    once(
      attempt.authorizationId,
      Effect.gen(function* () {
        const prior = yield* host.attempts.claim(attempt, digest)
        return yield* prior === undefined ? follow(attempt) : answer(prior)
      }),
    )

  /** A queued post cannot be taken back: waiting it is `cancel-requested`, settled it keeps its result. */
  const cancel = (authorizationId: Dispatch['authorizationId'], attemptId: Dispatch['attemptId']): Effect.Effect<CancelResult, AgentHostError> =>
    Effect.gen(function* () {
      if (inFlight.has(authorizationId)) return { _tag: 'cancel-requested' as const }
      const prior = yield* host.attempts.cancel(authorizationId, attemptId)
      if (prior === undefined || prior.state._tag === 'cancelled') return { _tag: 'cancelled' as const }
      if (prior.state._tag === 'submitted') return { _tag: 'cancel-requested' as const }
      return yield* answer(prior)
    })

  /**
   * Looks for the send in Slack. A post still waiting is followed to its
   * end first. Settles an unknown record on positive evidence; never on a miss.
   */
  const reconcile = (attemptId: Dispatch['attemptId'], channelId: string, actionId: Dispatch['actionId'], userId: string) =>
    Effect.gen(function* () {
      const first = yield* host.attempts.byAttempt(attemptId)
      if (first === undefined || first.actionId !== actionId || first.channelId !== channelId) return { _tag: 'unknown' as const }
      if (first.state._tag === 'submitted') yield* once(first.authorizationId, answer(first))
      const record = (yield* host.attempts.byAttempt(attemptId)) ?? first
      const found = (yield* host.sent(channelId, record.threadTs, actionId)).find((message) => proves(record, userId, message))
      if (found === undefined) return { _tag: 'unknown' as const }
      if (record.state._tag === 'unknown') yield* host.attempts.settle(record.authorizationId, { _tag: 'done', receipt: { channelId, ts: found.ts } })
      return { _tag: 'found' as const, message: found }
    })

  return { send, cancel, reconcile }
})
