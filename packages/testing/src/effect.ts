/**
 * Effect tests on `bun test`: the body's effect runs scoped, and `itEffect`
 * gives it a `TestClock` and `TestConsole`, so time moves only when the test
 * adjusts it. `itLive` keeps real time.
 */
import { it } from 'bun:test'
import { Effect, Layer, type Scope } from 'effect'
import { TestClock, TestConsole } from 'effect/testing'

const testServices = Layer.mergeAll(TestConsole.layer, TestClock.layer())

type Body<R> = () => Effect.Effect<unknown, unknown, R>

export function itEffect(name: string, body: Body<Scope.Scope | TestClock.TestClock | TestConsole.TestConsole>, timeout?: number): void {
  it(name, () => Effect.runPromise(body().pipe(Effect.scoped, Effect.provide(testServices))), timeout)
}

export function itLive(name: string, body: Body<Scope.Scope>, timeout?: number): void {
  it(name, () => Effect.runPromise(body().pipe(Effect.scoped)), timeout)
}
