/**
 * Reading an `AsyncResult` or a command's `Exit` without Effect in the
 * renderer: containers get the typed route error of a failed command, or
 * undefined.
 */
import { Cause, Option, type Exit } from 'effect'
import type * as AsyncResult from 'effect/reactivity/AsyncResult'

/** The route error of a failed result. Transport failures and defects give undefined. */
export function errorOf<A, E>(result: AsyncResult.AsyncResult<A, E> | Exit.Exit<A, E>): E | undefined {
  if (result._tag !== 'Failure') return undefined
  return Option.getOrUndefined(Cause.findErrorOption(result.cause))
}
