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
  `effect/http`, `effect/http-api`, `effect/socket`, `effect/net`, `effect/workers`, `effect/persistence`,
  `effect/cli`, `effect/ai`, `effect/cluster`, `effect/workflow`, `effect/observability`,
  `effect/process`, `effect/devtools`, `effect/eventlog`.
- Root modules: `FileSystem`, `Path`, `Terminal`, `Stdio`, `Newtype`, `LayerMap`, `Graph`,
  `ExecutionPlan`, `ErrorReporter`, `Arbitrary`, `Crypto`.
- A few members of stable modules: `Effect.withExecutionPlan`, `Effect.withErrorReporting`,
  `Stream.withExecutionPlan`, `Stream.limitBytes`, the `ByteSize`/`MacAddress` schemas.

Juno wrappers (`scripts/check-deps.mjs` fails `bun run lint` on an import from anywhere else):

| Unstable module | Wrapper, and the only files that import it |
| --- | --- |
| `effect/reactivity` (`Atom`, `AtomRegistry`, `AtomRpc`, `AsyncResult`) | `liveQuery(route)` and `command(route)` in `@juno/state`; `packages/state/src` only |
| `@effect/atom-react` | `@juno/state/react` (`useAtomValue`, `useAtom`, `useAtomSet`, `useAtomRefresh`, `RegistryContext`); containers import the hooks from there |
| `effect/reactivity/Reactivity` | `Invalidation` in `packages/store/src/invalidation.ts` |
| `effect/rpc/RpcMiddleware` | `packages/engine/src/protocol/server.ts` only: marks command writes for live-query motion provenance; no client middleware |
| `effect/rpc` | route declarations in `packages/contract/src` and `packages/agent-contract/src/{rpc,host}` (the renderer groups and the AgentHost group), the servers in `packages/engine/src/protocol` (the renderer routes and the AgentHost group) and `packages/agent/src/serve` (the agent's renderer groups), the clients in `packages/state/src` (the engine and the agent, with the deferred agent codecs in `agent/rpc.ts`) and `packages/agent/src/host`, and two tests that call raw routes: `packages/engine/test/agent-host.test.ts` (the AgentHost group) and `packages/agent/test/serve-harness.ts` (the agent's renderer groups, for `serve.test.ts` and `settings.test.ts`), and `apps/desktop/web/host/agent.ts` (type-only worker envelopes to flush the restore reply before restarting the browser host's agent) |
| `effect/workers` | the port transports: `packages/state/src/transport.ts`, `packages/engine/src/protocol/runner.ts`, `packages/agent/src/host/port.ts` (the agent's client side of the AgentHost port, ADR 0012), `packages/agent/src/serve/runner.ts` (the agent's server side of the renderer ports) |
| `effect/socket`, `effect/net` | the web shell's engine socket (`docs/development.md`, "Web shell"): the client in `packages/state/src/socket.ts` (`@juno/state/socket`, imported only by the web page) and the server in `packages/engine/src/protocol/socket.ts` (`socketTransport`; `effect/net` only for the server's address) |
| `effect/sql`, `@effect/sql-sqlite-node` | `@juno/store` only. See below. |
| `Arbitrary` | `packages/agent-contract/test/wire.test.ts` only: generates values for the wire round trips of every exported schema and route; no wrapper, since it is test-only |
| everything else listed above | nowhere yet. Add a wrapper module and an entry in `check-deps.mjs` first. |

**`effect/sql` is a decision, not an accident.** The store exports `SqlClient` (as a type) from
`@juno/store` as the type of its writer and reader, so every engine feature writes its queries
against it. That is accepted: the engine reaches it through `@juno/store`, never `effect/sql`, and a
breaking change in `effect/sql` is fixed in the store and in those queries.

Check the tag in the `.d.ts` before using any other unstable module.

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

Tests run on `bun test`. `itEffect(name, () => effect)` from `@juno/testing/effect` runs the effect
scoped with a `TestClock` (time moves only on `TestClock.adjust`); `itLive` runs it scoped in real
time. Add `@juno/testing` as a devDependency and to `juno.testDeps`. Juno prefers end-to-end tests,
so test a service through its public layer.

## Pitfalls met in this repo

- **Clients die with `Effect.provide`.** An `RpcClient` made inside `Effect.provide(protocolLayer)` is
  interrupted when that call returns. Keep the client in a scope that outlives its users: the state
  client lives in `AtomRpc.Service` / `Atom.runtime`.
- **Defects are fatal by default.** `RpcServer.layer` without `disableFatalDefects: true` ends the
  whole client when one handler dies. The engine sets it, so a defect is the `Exit` of that one
  request and the port stays usable.
- **Result atoms need a mount.** Writing to a `command(route)` atom that nothing has mounted does
  nothing visible. `useAtomSet` mounts it in React; in tests call `registry.mount(atom)` first, or use
  `runCommand(registry, route, payload)`. Tests make their own registry with `makeRegistry()`.
- **One request per port.** `RpcClient.layerProtocolWorker` is a worker pool and a pool item's default
  `concurrency` is 1, so the first live query blocked every later command.
  `packages/state/src/transport.ts` sets it high: one port carries everything.
- **The test clock stops time.** Under `it.effect`, sleeps and debounce windows never end on their own.
  Store tests call `TestClock.adjust(DEFAULT_LIVE_QUERY_DEBOUNCE)`; Slack client tests that make
  several background calls in a row set `backgroundMinIntervalMillis: 0` (background starts share total and per-method spacing)
  or use `it.live`.
- **Two servers in one build need `Layer.fresh`.** Layers are shared by reference within one build, so
  serving a second `RpcGroup` with `RpcServer.layerProtocolWorkerRunner` on another transport reuses
  the first server's protocol unless the second wraps it in `Layer.fresh`
  (`packages/engine/src/protocol/agentHost.ts`).
- **Errors are mapped at the engine edge.** `@juno/slack` and `@juno/store` errors never reach a route
  as they are: handlers map Slack errors to `@juno/contract` errors, and a command turns `StoreError`
  into a defect (`Effect.orDie`). A live query does not: a failed run is a value (`meta.error`), and a
  route with no error of its own retries a failed first run (`retryFirstRun`). See
  `docs/architecture.md` section 2.6.
