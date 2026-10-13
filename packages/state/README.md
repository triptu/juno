# @juno/state

The renderer's bridge to the engine: the port client and every atom. The only package that imports `effect/reactivity` Atom and `@effect/atom-react`, and the only place the renderer touches `effect/rpc` and `effect/workers`. See `docs/architecture.md` section 7.

## Public API

- `liveQuery(route)(payload)`: an atom for a stream route. A `liveValueRoute` gives the latest value; a `liveListRoute` gives a `ListWindow` kept by `applyListDelta`, with `orderAtom` and `rowAtom` for per-row subscriptions. Memoized per route.
- `command(route)`: a writable atom that runs the command and exposes its `AsyncResult`. `runCommand(registry, route, payload)` runs one without a component.
- `prefetch(atom)`: warms a query through the registry.
- `registry`, `makeRegistry()`, `configureConnection(registry, { acquire })`, `connectionStateAtom`, `acquireRendererPort`: the client and its connection. Tests make their own registry.
- Feature atoms, declared once at module level in `src/<feature>.ts`: `engineStatusAtom`, `pingCommand`, `appInfoAtom`, `themeAtom`, `persistTheme`, `sessionStatusAtom` and `signedInAtom` (the last ready session, held while the engine restarts so the shell stays up), `topicListAtom(filter)`, `topicCountsAtom(scope)`.
- Sidebar UI state in `src/sidebar.ts`, none of it persisted: `sidebarFilterAtom` (kind, unread, scope), `selectedTopicAtom` and `topicSelectedAtom(id)` (only the rows whose answer changes re-render), `nowAtom` (a half-minute clock the row owners format times against), `sidebarSectionsAtom(list)` (the window's order split into Pinned and Recent, equal splits do not notify).
- `@juno/state/react`: `useAtomValue`, `useAtom`, `useAtomSet`, `useAtomRefresh`, `RegistryContext`. Containers import hooks only from here.
- `@juno/state/perf`: the fixed performance marks and `observeFrames()`.

Transport errors are retried every second and never reach an atom. Route errors reach it typed.

## Must not

- Contain JSX or import React components. Only the hooks module touches React.
- Use the DOM lib. It must typecheck without it because the engine's tests import it; reach browser globals through `globalThis` with local types.
- Import `@juno/engine` or `@juno/views`. It depends on `@juno/contract` only.
- Be bypassed: nothing outside the allow-list imports Atom, `effect/rpc` or `effect/workers` (`check-deps` enforces it).

## Testing

`pnpm --filter @juno/state test` covers `applyListDelta` (identity of unchanged rows, order, removal). The client and helpers are tested end to end in `packages/engine/test/protocol.test.ts`, which uses a registry per test and a Node `MessageChannel` in place of the renderer's port.
