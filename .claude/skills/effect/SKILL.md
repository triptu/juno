---
name: effect
description: Using Effect 4 in Juno. Use when writing or reviewing any code that imports from `effect` or `@effect/*` (services, layers, errors, Schema, Stream, retries, running effects, tests, atoms). Effect 4.0.3 renamed many Effect 3 APIs, so names from memory are often wrong.
---

# Using Effect 4 in Juno

Juno pins `effect@4.0.3`. Most training data and blog posts describe Effect 3 or the 4.0 betas.
Names like `Context.Tag`, `Effect.Service`, `Effect.catchAll`, `Effect.fork`, `Layer.scoped` and
`Schema.decodeUnknown` do not exist in 4.0.3. Do not write an Effect API from memory.

## Principles

- **Check before you write.** The truth is the installed package, for example
  `packages/contract/node_modules/effect/dist/Effect.d.ts`. Its `ai-docs/src/` folder has small,
  current examples (services, errors, schedules, streams, tests). Grep these first; web docs are
  usually Effect 3.
- **Almost everything is in `effect`.** There is no `@effect/platform`, `@effect/schema` or
  `@effect/rpc`; use subpaths such as `effect/http`, `effect/sql`, `effect/rpc`,
  `effect/reactivity/Atom`, `effect/testing`. `@effect/platform-node`, `@effect/sql-sqlite-node`
  and `@effect/atom-react` are separate and share the version `4.0.3`.
- **Services are classes with a static `layer`.** One service per small module. The layer lists its
  own dependencies; the app composes layers in one place with `Layer.provide` / `Layer.provideMerge`.
- **Errors are typed values.** Define them with `Schema.TaggedError` so they can cross the IPC
  boundary, and handle them by tag. Use defects (`Effect.die`, `orDie`) only for bugs.
- **Views never import `effect`** (`docs/architecture.md`). Non-Effect code runs effects through a
  `ManagedRuntime`.
- **Prefer `Effect.gen`, and `Effect.fn("Name")` for service methods** (adds a span).
  `Effect.fnUntraced` for hot paths.

## Unstable modules: wrap them

Modules tagged `@stability unstable` can change in a minor release. Juno rule: never use them
directly across the codebase; reach them through one small local module so a change stays local.
Stable: `Effect`, `Layer`, `Context`, `Stream`, `Schedule`, `Scope`, `Queue`, `Ref`, `Fiber*`,
`ManagedRuntime`, `Cause`, `Exit`, `Result`, `Option`, `Duration`, `Schema` (core), `effect/testing`
`TestClock`. Unstable (checked in the `.d.ts` headers):

- Whole subpaths: `effect/rpc`, `effect/sql`, `effect/reactivity` (`Atom`, `Reactivity`, `AtomRpc`),
  `effect/http`, `effect/http-api`, `effect/socket`, `effect/workers`, `effect/persistence`,
  `effect/cli`, `effect/ai`, `effect/cluster`, `effect/workflow`, `effect/observability`,
  `effect/process`, `effect/devtools`, `effect/eventlog`.
- Root modules: `FileSystem`, `Path`, `Terminal`, `Stdio`, `Newtype`, `LayerMap`, `Graph`,
  `ExecutionPlan`, `ErrorReporter`, `Arbitrary`, `Crypto`.
- A few members of stable modules: `Effect.withExecutionPlan`, `Effect.withErrorReporting`,
  `Stream.withExecutionPlan`, `Stream.limitBytes`, the `ByteSize`/`MacAddress` schemas.

Juno wrappers: atoms go through `liveQuery(route)` and `command(route)` in `@juno/state`
(planned; M0 still imports `effect/reactivity/Atom` in `renderer/state/`), and `Reactivity` sits
behind `Invalidation` in `@juno/store`. Check the tag in the `.d.ts` before using other modules.

## Effect 3 name to Effect 4 name

| Effect 3 | Effect 4.0.3 |
| --- | --- |
| `Context.Tag`, `Effect.Service`, `Effect.Tag` | `class X extends Context.Service<X, Shape>()("id") {}` |
| `FiberRef`, services with defaults | `Context.Reference<T>("id", { defaultValue })` |
| `Layer.scoped(Tag, eff)` | `Layer.effect(Tag, eff)` (a `Scope` in the effect is closed with the layer) |
| `Effect.catchAll` | `Effect.catch` |
| `Effect.catchSome`, `Effect.orElse(b)` | `Effect.catchIf` / `Effect.catchFilter`, `Effect.catch(() => b)` |
| `Effect.either` / `Either` | `Effect.result` / `Result` (`Success`, `Failure`; `.success`, `.failure`) |
| `Effect.async` | `Effect.callback` |
| `Effect.fork`, `forkDaemon` | `Effect.forkChild`, `Effect.forkDetach` (`forkScoped`, `forkIn` unchanged) |
| `Schema.decodeUnknown` / `encodeUnknown` | `Schema.decodeUnknownEffect` / `encodeUnknownEffect` |
| `Schema.filter(pred)` | `schema.check(Schema.isMinLength(1))` and other `Schema.is*` checks |
| `Schema.Union(A, B)`, `Schema.Literal("a", "b")` | `Schema.Union([A, B])`, `Schema.Literals(["a", "b"])` |
| `Schema.optionalWith(S, { default })` | `S.pipe(Schema.withDecodingDefaultKey(Effect.succeed(x)))`; plain optional is `Schema.optionalKey(S)` |
| `Stream.async`, `asyncScoped` | `Stream.callback` |
| `Schedule.intersect` / `union` | `Schedule.max([...])` / `Schedule.min([...])` |

`reference.md` has more renames and a list of names confirmed missing in 4.0.3.

## Snippets (all type-checked and run against 4.0.3)

Service, error, layer:

```ts
import { Context, Effect, Layer, Schema } from 'effect'

export class SlackError extends Schema.TaggedError<SlackError>()('SlackError', {
  status: Schema.Int,
  message: Schema.String,
}) {}

export class Slack extends Context.Service<Slack, {
  postMessage(channel: string, text: string): Effect.Effect<string, SlackError>
}>()('juno/slack/Slack') {
  static readonly layer = Layer.effect(Slack, Effect.gen(function* () {
    const postMessage = Effect.fn('Slack.postMessage')(function* (channel: string, text: string) {
      if (text === '') return yield* new SlackError({ status: 400, message: 'empty' })
      return `${channel}:${text}`
    })
    return Slack.of({ postMessage })
  }))
}
// Use with `yield* Slack` inside Effect.gen, or `Slack.use((s) => s.postMessage(...))`.
```

Errors: tagged errors are yieldable, so `return yield* new E(...)` fails the effect.

```ts
program.pipe(
  Effect.catchTag('SlackError', (e) => Effect.succeed(`failed ${e.status}`)), // or an array of tags
  Effect.catch((e) => Effect.succeed(String(e))),                            // everything left
)
// Also: Effect.catchTags({ A: ..., B: ... }), Effect.catchCause (defects), Effect.result.
```

Schema: classes, decode, encode.

```ts
class Message extends Schema.Class<Message>('Message')({
  ts: Schema.String.pipe(Schema.brand('Ts')),
  threadTs: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(['message', 'reply']),
  count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}
const m = Schema.decodeUnknownSync(Message)(raw)      // throws SchemaError; m is a Message
const eff = Schema.decodeUnknownEffect(Message)(raw)  // Effect<Message, SchemaError>
const wire = Schema.encodeSync(Message)(m)
```

Resources, streams, retry:

```ts
const events = Stream.callback<string>(Effect.fn(function* (queue) {
  yield* Effect.acquireRelease(
    Effect.sync(() => { Queue.offerUnsafe(queue, 'hello') }), // open the socket, push into the queue
    () => Effect.log('closed'),                               // runs when the stream ends
  )
}))
flaky.pipe(Effect.retry({
  schedule: Schedule.exponential('250 millis').pipe(Schedule.jittered),
  times: 5,
  while: (e) => e.status >= 500,
}))
```

Running and testing:

```ts
const runtime = ManagedRuntime.make(Slack.layer)      // for IPC handlers and other non-Effect code
await runtime.runPromise(Slack.use((s) => s.postMessage('C1', 'hi')))
await runtime.dispose()
// Also Effect.runFork / runPromise / runPromiseExit, and Layer.launch for long-running programs.

import { TestClock } from 'effect/testing'            // virtual time, inside Effect.gen
const f = yield* Effect.forkChild(Effect.sleep(60_000))
yield* TestClock.adjust(60_000)
yield* Fiber.join(f)
```

Tests: `@effect/vitest` (`it.effect`, `it.live`) is the documented runner but is not installed yet;
outside it, provide `TestClock.layer()` yourself. Juno prefers end-to-end tests, so test a service
through its public layer.
