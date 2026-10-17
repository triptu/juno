/**
 * Executors: what runs one authorized child action, by its tool (plan v3
 * §6.3). The dispatcher consumes the authorization and records the attempt
 * before it calls `run`, and records what `run` says after. An executor
 * never retries: one call is one attempt, and anything it cannot confirm is
 * `unknown`. `reconcile` looks for positive evidence of an unknown attempt;
 * it never makes a second one.
 *
 * Each folder that owns a destination registers its executors with
 * `openTurns({ actions: { executors } })`: Slack and resolve through the
 * host here, MCP writes in `mcp/` (WP17), T3 in `t3/` (WP18), schedules in
 * `schedule/` (WP19), removal in `redaction/` (WP16). A card whose tool has
 * no executor fails on its click and nothing is sent.
 */
import type { ExecutableIdentity } from '@juno/agent-cards'
import type { Schema } from 'effect'
import type { Invalid } from '../policy/policy'

export interface ExecutorCall {
  /** The child action id: a Slack send's `client_msg_id`, a T3 tag `juno:<id>`. */
  readonly actionId: string
  readonly authorizationId: string
  readonly attemptId: string
  /** The executable digest the owner approved. */
  readonly digest: string
  /** Exactly the approved payload. */
  readonly payload: ExecutableIdentity
  readonly cardId: string
  /** The click's op id: the authority's op, a grant's `source_op`, a spend raise's key. */
  readonly opId: string
}

/**
 * What a destination gave back, for a connection call: `model` is what the model reads with the
 * card's outcome, `line` the card's one result line (a result, or the server's error), and
 * `shown` the result as a person reads it, behind "Show result".
 */
export interface ExecutorOutput {
  readonly model?: string
  readonly line?: string
  readonly shown?: string
}

export type ExecutorResult =
  /** The destination did it. `receipt` is the evidence kept; `open` is where "Open" goes. */
  | { readonly _tag: 'done'; readonly receipt: Schema.Json; readonly output?: ExecutorOutput }
  /** A definite rejection: nothing happened. `detail` is for Activity only. */
  | { readonly _tag: 'failed'; readonly detail: string; readonly output?: ExecutorOutput }
  /** It may have happened. */
  | { readonly _tag: 'unknown'; readonly detail: string; readonly output?: ExecutorOutput }

export interface Executor {
  readonly tool: string
  /** Tier 1, 2 or 3 (§9). Tier 4 has no executor. */
  readonly tier: 1 | 2 | 3
  /** The destination keeps the action id and does a repeat once (§6.3 table). Only then may a child be authorized twice. */
  readonly deduped: boolean
  /**
   * Whether the approved identity still holds now: account, connection, tool
   * schema, preconditions (§6.2). `wait` when it cannot tell yet (no account
   * known before the first presence, or signed out): the click waits, as it
   * does while paused, and runs once it can tell.
   */
  readonly check?: (payload: ExecutableIdentity) => Promise<'valid' | 'wait' | Invalid>
  readonly run: (call: ExecutorCall) => Promise<ExecutorResult>
  /** Positive evidence for an unknown attempt, or `unknown` again. Never a second attempt. */
  readonly reconcile?: (call: ExecutorCall) => Promise<{ readonly _tag: 'found'; readonly receipt: Schema.Json } | { readonly _tag: 'unknown' }>
}
