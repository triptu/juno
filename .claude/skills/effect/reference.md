# Effect 4.0.3 reference: more renames and names that do not exist

Everything here was checked against `effect@4.0.3` (by importing the module and by `tsc`). Read
`SKILL.md` first.

## More renames

| Effect 3 | Effect 4.0.3 |
| --- | --- |
| `Effect.catchAllCause`, `Effect.catchAllDefect` | `Effect.catchCause`, `Effect.catchDefect` |
| `Effect.zipRight`, `Effect.zipLeft` | `Effect.andThen`, `Effect.tap` |
| `Effect.tapBoth` | `Effect.tapError` plus `Effect.tap` |
| `Effect.makeSemaphore`, `Effect.makeLatch` | `Semaphore.make` (`effect/Semaphore`), `Latch` |
| `Effect.runtime` | `Effect.runForkWith`, `runPromiseWith`, or a `ManagedRuntime` |
| `Fiber.poll` | none; use `Fiber.await` or `Fiber.join` |
| `Schema.transform`, `transformOrFail` | `Schema.decodeTo` (with `SchemaTransformation` / `SchemaGetter`) |
| `Schema.parseJson(S)` | `Schema.fromJsonString(S)` |
| `Schema.Either` | `Schema.Result` |
| `Schema.Map`, `Schema.Set` | `Schema.ReadonlyMap`, `Schema.ReadonlySet`, `Schema.HashSet` |
| `Schema.minLength(n)`, `maxLength`, `pattern`, `between` | `schema.check(Schema.isMinLength(n))`, `isMaxLength`, `isPattern`, `isBetween` |
| `Schema.Schema<A, I, R>` | `Schema.Schema<T>` (type only) or `Schema.Codec<T, E, RD, RE>`; `S.Type` and `S.Encoded` still work |
| `Stream.catchAll` | `Stream.catch` |
| `Stream.async`, `asyncPush`, `asyncScoped` | `Stream.callback` (`Queue.offerUnsafe` inside) |
| `Stream.provideLayer` | `Stream.provide` |
| `Schedule.whileInput` | `Schedule.while(({ input }) => ...)` |
| `Schedule.andThen` | `Schedule.concat` |
| `Schedule.linear`, `Schedule.compose`, `Schedule.driver` | none; use `exponential`, `fibonacci`, `modifyDelay`, `fromStep` |
| `Mailbox` | `Queue` (`Queue.make`, `offer`, `take`, `end`, `fail`) |
| `Cause.isFailType`, `Cause.failures` | `Cause.hasFails`, `Cause.findError`, `Cause.squash`, `Cause.prettyErrors` |
| `Either` module | `Result` module |

## Unchanged names worth knowing

`Effect.gen`, `Effect.fn`, `Effect.fnUntraced`, `Effect.tryPromise`, `Effect.acquireRelease`,
`Effect.acquireUseRelease`, `Effect.addFinalizer`, `Effect.scoped`, `Effect.forkScoped`,
`Effect.forkIn`, `Effect.retry`, `Effect.repeat`, `Effect.timeout`, `Effect.all`,
`Effect.forEach`, `Effect.orDie`, `Effect.exit`, `Effect.ignore`, `Layer.effect`, `Layer.succeed`,
`Layer.provide`, `Layer.provideMerge`, `Layer.mergeAll`, `Layer.launch`, `Layer.unwrap`,
`Layer.effectDiscard`, `Scope.make` / `Scope.close`, `Schema.Struct`, `Schema.Class`,
`Schema.TaggedClass`, `Schema.TaggedStruct`, `Schema.TaggedError`, `Schema.brand`,
`Schema.decodeUnknownSync`, `Schema.encodeSync`, `Schema.Defect()`.

Differences that still matter: `Schema.Defect()` is a function call; `Schema.Void` is a value;
`Schema.optional(S)` allows `undefined` as well as a missing key, `Schema.optionalKey(S)` allows
only a missing key. `Layer.effect` handles `Scope` itself (verified: a layer using
`Effect.acquireRelease` has type `Layer<Service>` with no `Scope` requirement).

## Confirmed missing in 4.0.3 (importing these gives a type error or `undefined`)

`Context.Tag`, `Context.GenericTag`, `Effect.Service`, `Effect.Tag`, `Effect.catchAll`,
`Effect.catchAllCause`, `Effect.catchSome`, `Effect.orElse`, `Effect.either`, `Effect.async`,
`Effect.fork`, `Effect.forkDaemon`, `Effect.zipRight`, `Effect.zipLeft`, `Effect.runtime`,
`Effect.makeSemaphore`, `Layer.scoped`, `Layer.scopedDiscard`, `Layer.unwrapEffect`,
`Layer.unwrapScoped`, `Schema.decodeUnknown`, `Schema.encodeUnknown`, `Schema.filter`,
`Schema.transform`, `Schema.optionalWith`, `Schema.parseJson`, `Schema.TaggedErrorClass`,
`Stream.async`, `Stream.catchAll`, `Schedule.intersect`, `Schedule.union`, `Schedule.both`,
`Schedule.either`, `Schedule.andThen`, `Schedule.linear`, `Effect.catchAllDefect`, `Effect.tapBoth`, `Either`, `Mailbox`, `FiberRef`.

`Schedule.max([a, b])` stops when any schedule stops and uses the slower delay (the old
`intersect`). `Schedule.min([a, b])` runs while any schedule continues and uses the faster delay
(the old `union`). `Schedule.concat(a, b)` runs `a` then `b` (the old `andThen`).

## Not in this repo yet

- `@effect/vitest` is not installed. When added, use `it.effect` and `it.live`; `TestClock` comes
  from `effect/testing`.
- Atoms: `effect/reactivity/Atom` and `@effect/atom-react` hooks (`useAtomValue`, `useAtom`,
  `useAtomSet`). They are unstable, so only the planned state helpers should import them.
