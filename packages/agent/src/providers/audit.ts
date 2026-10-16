/**
 * Sends the agent's model requests to the engine's AI activity log
 * (`host.ai.record`). The guard tells each request as it ends; a queue
 * keeps the request from waiting on the port, and a call the port loses
 * is dropped: the log is a record for the owner, not a ledger.
 */
import { Effect, Queue, Stream } from 'effect'
import type { HostAiCall } from '@juno/agent-contract'
import { AgentHost } from '../host/client'
import type { GuardCall, ProviderGuardApi } from './guard'

/** Calls held while the port is busy; more than this are dropped, oldest first. */
const QUEUE_CAPACITY = 200

/** The log's record of one request: what it was for, never what it said. */
export function aiCallOf(call: GuardCall): HostAiCall {
  const job = call.path === 'subagent' && call.sessionId?.startsWith('juno-job-') ? call.sessionId.slice('juno-job-'.length) : undefined
  const parts = call.outcome === 'ok'
    ? [`reply, ${call.outputChars} characters`, ...(call.toolCalls > 0 ? [`${call.toolCalls} tool ${call.toolCalls === 1 ? 'call' : 'calls'}`] : [])]
    : []
  return {
    at: call.at,
    feature: call.path,
    subjectKind: job === undefined ? 'chat' : 'job',
    subjectId: job ?? '',
    provider: call.provider,
    model: call.model,
    outcome: call.outcome,
    kind: call.kind,
    message: call.message,
    durationMs: call.durationMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    costUsd: call.costUsd,
    summary: parts.join(', '),
  }
}

/** Forwards the guard's requests to the host for as long as it runs. */
export const forwardAiCalls = (guard: ProviderGuardApi): Effect.Effect<void, never, AgentHost> =>
  Effect.gen(function* () {
    const client = yield* AgentHost
    const queue = yield* Queue.sliding<HostAiCall>(QUEUE_CAPACITY)
    yield* Effect.acquireRelease(
      Effect.sync(() => guard.onCall((call) => { Queue.offerUnsafe(queue, aiCallOf(call)) })),
      (stop) => Effect.sync(() => { stop() }),
    )
    yield* Stream.fromQueue(queue).pipe(Stream.runForEach((call) => client['host.ai.record']({ call }).pipe(Effect.ignore)))
  }).pipe(Effect.scoped)
