# M1 code review

Date: 2026-10-12. Scope: every package and app on `main` at `77e3263`, plus a light pass over the Slack client merged in `ab282da`. Reviewed for maintainability, package boundaries, Effect usage, tests, performance and docs. `docs/reviews/m1-design-review.md` covers the visual state of `ui`; this review covers code and APIs only.

How I checked: read all source, tests and docs. Ran `pnpm check-deps` and `oxlint` (both pass). Inspected the built renderer in `apps/desktop/out/` and minified it with the repo's esbuild to measure. Type-checked a decoded `@juno/slack` `Message` against `@juno/richtext`'s `MessageContent`. I did not run the test suites.

## Verdict

The foundations are sound. The port protocol, the store's invalidation, the fake and the domain rules are small, readable and mostly well tested. The problems are at the seams between packages that were built in parallel: two implementations of "re-run a query when data changes", three of Slack `ts`, two incompatible sets of Slack block types, and helper names that collide across packages. Fix those before M3, because M3 is the first milestone that wires all of them together. Two user-visible bugs (theme persistence) and one cheap 55% bundle cut are also here.

## Decisions this review makes

So the work packages below can run in parallel and agree on names.

| Concept | One owner | Change |
| --- | --- | --- |
| Slack wire shapes (blocks, messages, `Ts`) | New `@juno/slack-schema`, moved from `packages/slack/src/schemas/` | `richtext`, `domain`, `store`, `slack`, `fake-slack` import from it. `slack` drops `@juno/domain` from `allowedDeps`. |
| Slack `ts` | `slack-schema/src/ts.ts`: branded `Ts` (`^\d+\.\d{6}$`), `compareTs`, `maxTs`, `minTs`, `tsToMillis`, `millisToTs` | `domain/src/ids.ts` deletes its copies and re-exports. |
| Conversation kind | `domain` `ConversationKind` | `store/src/rows.ts` imports it. `ui` `ContextPill` takes a tint and label, not a kind. |
| Re-run on invalidation, debounce | `store` `liveQuery(keys, query)` | Engine `runs()` is deleted. |
| Deltas, `meta`, size budget | `engine/src/protocol/live.ts` | Renamed `serveLiveValue`, `serveLiveList`; take a stream of runs. |
| Route declarations | `contract/src/live.ts` | Renamed `liveValueRoute`, `liveListRoute`. `Window` becomes `ListRange`. |
| renderer ↔ main IPC map | `contract` | `Routes`, `RouteInput`, `RouteOutput` become `ShellRoutes`, `ShellInput`, `ShellOutput`. |
| Atoms | `state` `liveQuery(route)`, `command(route)` | Names stay; both become memoized per route. |
| Theme value | `contract` `Theme` / `ThemeSchema` | `state` and `main/launch.ts` import it. `ui` gets the one `applyTheme`. |
| Wire errors | `contract/src/errors.ts` | Engine maps `@juno/slack` errors to these. Contract `SlackRejected` becomes `Rejected`; `RateLimited.retryAfter` becomes `retryAfterMillis`. |

## Findings, ranked by impact

### 1. The renderer bundle is not minified

- **Where:** `apps/desktop/electron.vite.config.ts:65-78`. electron-vite 5 defaults the renderer to `build.minify: false` (`electron-vite/dist/chunks/lib-*.js`, renderer `defaultConfig`).
- **Problem:** `out/renderer/assets/index-*.js` is 1,097,265 bytes of readable code (28,250 lines). Minified with esbuild it is 485 KB, 146 KB gzipped.
- **Why it matters:** this is the whole "1,086 KB vs 1.0 MB budget" problem in `docs/development.md`. Parse and compile time on cold start scales with it.
- **Fix:** set `renderer.build.minify: 'esbuild'` (and `main`/`preload` too, harmless). Add `scripts/check-bundle-size.mjs` (architecture 13 and performance 7.3 already name it): sum the initial JS and CSS in `out/renderer/assets`, fail over 1.0 MB / 150 KB, run it at the end of `pnpm build`. Update performance.md section 1 ("856 KB") and development.md's bundle pitfall with the real numbers.

### 2. The saved theme is lost, and the renderer never reads it

- **Where:** `apps/desktop/src/main/index.ts:20,28,43`; `packages/state/src/shell.ts:23`.
- **Problem:** `launch` is read once. `setTheme` writes `{ ...launch, theme }` and window close writes `{ ...launch, bounds }`, so closing the window writes the startup theme back over the one the user chose. Separately, `themeAtom` always starts at `'light'`; nothing tells the renderer the saved theme.
- **Why it matters:** a dark-mode user gets a dark window background with a light page (the flash performance 2.1 forbids), or loses the setting on quit.
- **Fix:** keep one mutable `launch` in main and write the merged value from both places. Pass the theme to the page: `loadURL(\`${APP_URL}?theme=${launch.theme}\`)` and initialise `themeAtom` from `location.search` in `state/src/shell.ts` (update the `location.href` assertion in `e2e/engine.spec.ts:33`). Add `e2e/theme.spec.ts`: switch to dark, relaunch with the same user-data dir, expect a dark page and dark `backgroundColor`.

### 3. Two live-query engines with different rules

- **Where:** `packages/engine/src/protocol/live.ts:107-128` (`runs`) and `packages/store/src/invalidation.ts:143-186` (`Invalidation.liveQuery`).
- **Problem:** both implement "run now, re-run on change, leading edge plus 30 ms trailing". The engine's takes a raw `invalidations` stream; the store exposes a stream of results, not of invalidations. Wiring them in M3 gives either two debounce windows or glue code. Failure handling also disagrees: architecture 2.6 says a failed run is emitted with `meta.error` and the subscription continues; the engine fails the stream (`live.ts:125`), the store fails it too, and `LiveMeta.error` (`contract/src/live.ts:55`) is never set.
- **Why it matters:** every M3+ live query goes through this seam. Getting it wrong costs either the 50 ms write-to-pixels budget or silent dead subscriptions.
- **Fix:** delete `runs()`. `serveLiveValue(runs, …)` and `serveLiveList(runs, { encodeRow })` take a `Stream<Timed<A>>` and only stamp `meta` and diff. Export `timed(query)`. Feature handlers pass `liveQuery(keys, timed(query))` from the store; `status` passes a 5-line `rerunOn(signal, query)` with no debounce. In the serve helpers, a failed first run fails the stream; a later failure re-emits the last value with `meta.error` and keeps going. Add engine tests for both failure cases.

### 4. Slack wire types exist twice and do not fit together

- **Where:** `packages/richtext/src/slack-types.ts` vs `packages/slack/src/schemas/blocks.ts`; `richtext/src/from-blocks.ts:32-37`; `slack/src/schemas/common.ts:23-28`.
- **Problem:** a decoded `Message` from `@juno/slack` is not assignable to richtext's `MessageContent` (checked with `tsc`: the `unknown` and `image` variants are missing). Worse, at runtime `@juno/slack` decodes unknown inline elements to `{ type: 'unknown', raw }`, while richtext reads `text` and `fallback` from the top level, so the text of `file`, `canvas` and `message_mention` elements is lost. Architecture 9 says richtext should import slack's types "once the dependency direction allows", but with `slack → domain → richtext` it never will.
- **Why it matters:** M4 renders real messages through exactly this path; the engine would need casts and would drop text.
- **Fix:** move `packages/slack/src/schemas/` to a new `packages/slack-schema` (effect only, `allowedDeps: []`), then: richtext deletes `slack-types.ts` and uses `import type` from `@juno/slack-schema`; `inlineFromElement` reads `el.raw.text ?? el.raw.fallback` for `unknown`; `slack` and `fake-slack` switch 16 imports from `@juno/slack/schemas`; `slack` drops `@juno/domain` (it never used it). Add one richtext test that decodes a payload with `Schema.decodeUnknownSync(Message)` and renders it, including an unknown element.

### 5. Three implementations of Slack `ts`

- **Where:** `domain/src/ids.ts:17-18,73-95` (branded, 6 digits), `slack/src/schemas/ts.ts` (plain string, any fraction, throws), `slack/src/schemas/common.ts:15` (a second `Ts` pattern), plus string `<` in `store/src/queries.ts:116-117`.
- **Problem:** two `compareTs`, two millis converters with different names (`tsFromMillis`, `millisToTs`), two patterns. Ids that cross from slack to domain need a re-brand.
- **Fix:** see the decisions table. Domain re-exports `Ts`, `compareTs`, `maxTs`, `tsToMillis`, and keeps `tsFromMillis` as an alias only if callers need it (they are tests). Store keeps SQL `ORDER BY ts` (fine for 10-digit seconds) but uses `compareTs` in TypeScript.

### 6. State helpers are easy to misuse

- **Where:** `packages/state/src/atoms.ts:54-58, 65-93, 109-120`; `client.ts:17`.
- **Problems:**
  - `liveQuery(route)` builds a new `Atom.family` on every call, and `command(route)` a new `runtime.fn` atom on every call. Two modules (or a render) calling them get separate atoms: duplicate subscriptions, lost results.
  - `CommandAtom` error type is `ErrorOf<R> | unknown`, which is `unknown`. Live atoms are typed `AsyncResult<V, unknown>`. The contract's typed errors never reach containers.
  - `Stream.retry(Schedule.spaced('1 second'))` retries every failure, including `NotSignedIn`. The `Failure` branch in `containers/EngineStatus.tsx:39` can never show.
  - `registry` and the prefetch list are module globals, so tests share them (`engine/test/protocol.test.ts`).
- **Fix:** memoize both helpers in a `WeakMap` keyed by route. Type errors as `ErrorOf<R> | RpcClientError`. Retry only `RpcClientError` (transport loss), let route errors through. Make `configureConnection` and `prefetch` take the registry as a parameter; tests use `AtomRegistry.make()` per test. Add `runCommand(route, payload): Promise<Exit>` for menus and the undo stack, which have no component to mount an atom in.

### 7. Helper names collide across packages

- **Where:** `contract/src/live.ts:97,108` (`liveQuery`, `liveList` declare routes), `engine/src/protocol/live.ts:32,61` (`liveValue`, `liveList` serve them), `state/src/atoms.ts:65` (`liveQuery` makes atoms), `store/src/invalidation.ts:212` (`liveQuery` makes streams). `contract/src/live.ts:35` exports `Window`, which shadows the DOM `Window` in renderer code. `contract/src/index.ts:40` `Routes` (IPC) sits next to `AllRoutes`/`EngineRoutes` (RPC).
- **Why it matters:** a handler file imports `liveList` from both `@juno/contract` and `../protocol/live` (development.md "Adding a route" steps 1 and 2 show it). Agents will alias inconsistently.
- **Fix:** rename as in the decisions table. Also make `liveListRoute` add `range: ListRange` to the payload itself, so "the payload must include a window" is enforced by construction.

### 8. `engine.status` sends a message every second, forever

- **Where:** `engine/src/status/handlers.ts:12,21`; `contract/src/routes/engine.ts:23-30`; `e2e/engine.spec.ts:12-19`.
- **Problem:** `uptime` is on the wire, so the engine ticks the live query at 1 Hz for the life of the app: a port message, a decode and a React render every second, for a diagnostic.
- **Fix:** drop `uptime` from `EngineStatus`; invalidate only on phase changes. The container shows the phase. Replace the "uptime moves" e2e with "a phase change reaches the renderer" (or keep only the restart test, which already proves delivery).

### 9. `liveList` encodes every row twice

- **Where:** `engine/src/protocol/live.ts:83-85`.
- **Problem:** to measure `encodeMs` and bytes, each upserted row is encoded and `JSON.stringify`d, then `RpcServer` encodes it again. `length` counts UTF-16 units, not bytes.
- **Fix:** measure only when `EngineConfig.e2e` is set or in dev (pass a `measure` flag into the serve helpers); otherwise `encodeMs: 0`. Document that `meta.encodeMs` is a test and dev figure.

### 10. Supervisor queues ports forever after giving up

- **Where:** `apps/desktop/src/main/engine.ts:70-75, 95-99`.
- **Problem:** in state `failed`, `connect` still pushes to `pendingPorts`. The renderer retries every second after its 10 s timeout, so the queue grows without bound and every queued port is sent if the engine ever starts again.
- **Fix:** in `failed`, reject `engine.requestPort` with an error the renderer shows ("Engine failed"). Keep at most one pending port per `WebContents` (replace the older one).

### 11. `Text`'s `role` prop shadows ARIA `role`, and `Button` is growing escape hatches

- **Where:** `ui/src/Text.tsx:11`; the workaround in `apps/desktop/src/renderer/views/EngineStatusView.tsx:17-21`; `ui/src/Button.tsx:16-41`; combos in `ui/src/Button.fixtures.tsx:20-58`.
- **Problem:** `Text` cannot take `role="status"`, so views wrap it in extra `div`s. Meanwhile `OptionList` and `Popover` use `role` for ARIA, so the word means two things. `Button` has 17 props; the sidebar nav item is `variant="ghost" size="lg" radius="md-plus" iconSize={15} fullWidth align="start"`, the filter is `size="sm" radius="md-plus" text="ui" tone="muted" strong`. Every view will repeat those combos, and `radius`, `text` and `iconSize` let views drift off the design.
- **Fix:** rename `Text.role` to `variant` (about 50 call sites, mechanical) and `TextRole` to `TextVariant`. Add a `NavItem` primitive and a `variant="filter"` (or use `Segmented`) for the two repeated combos, then remove `radius`, `text` and `iconSize` from `ButtonProps`. Type `sx` as `stylex.StyleXStylesWithout<{ color: unknown; backgroundColor: unknown; font: unknown; fontSize: unknown }>` so "layout only" is enforced.

### 12. `check-deps` does not guard the boundaries that matter next

- **Where:** `scripts/check-deps.mjs:24-30`; root `package.json` `lint`.
- **Problem:** rules are per package only. Nothing stops `apps/desktop/src/renderer` from importing `@juno/engine` or `electron`, `src/main` from importing `@juno/state`, or the views in `apps/desktop/src/renderer/views` from importing `@juno/state` or `effect`. The unstable-module rule (`effect/reactivity/*`, `effect/rpc`, `effect/workers` only in `state`, `contract`, `engine`; `Reactivity` only in `store/src/invalidation.ts`) is prose. `ipcRenderer.sendSync` is "banned by lint" (performance 2.1) but no rule exists. Architecture 3 says engine feature folders are enforced with oxlint overrides; they are not. `check-deps` is not part of `pnpm lint`, so nothing runs it by default.
- **Fix:** add path rules (directory prefix → forbidden specifiers) for desktop `renderer`, `main`, `preload`, and treat any `views/` directory like `@juno/views`. Add the unstable-module allow-list and a `sendSync` text ban. Scan `test/` and `e2e/` for undeclared `@juno/*` imports. Append `node scripts/check-deps.mjs` to `pnpm lint`. Either add the engine feature-folder rule or delete that sentence from architecture 3.

### 13. Contract and Slack client errors overlap

- **Where:** `contract/src/errors.ts:12-20`; `slack/src/client/errors.ts:14-32`.
- **Problem:** both define tag `SlackRejected` with different fields; contract `RateLimited.retryAfter` is seconds, slack `SlackRateLimited.retryAfterMillis` is millis. If a handler lets the client error through, encoding against the route schema fails and the request dies as a defect.
- **Fix:** rename contract's to `Rejected { code }`, use millis everywhere. Add one paragraph to architecture 2.6: engine handlers map `@juno/slack` errors to contract errors and turn `StoreError` into defects (`Effect.orDie`), because a broken database is a bug, not a user-facing state.

### 14. `startEngine` fights Effect instead of using it

- **Where:** `engine/src/startEngine.ts:21-32`; `engine/src/protocol/runner.ts:49-51`.
- **Problem:** three `runPromise` calls; a layer build failure leaks the scope; `config` is accepted but not provided to any service; `Layer.provideMerge(Services, Layer.empty)` is a no-op. The runner's finalizer only unsubscribes from the transport; open ports are never closed when the engine stops.
- **Fix:** one `Effect.gen` that makes the scope, builds the layer with `Effect.onError(() => Scope.close(scope, Exit.void))`, and provides `EngineConfig` as a `Context.Service` built from the argument. In the runner, close every port in `ports` in the finalizer. Have `apps/desktop/src/engine/index.ts` own the single `parentPort` listener and hand `port` messages to the transport, instead of two listeners each parsing the same messages.

### 15. Views live inside the app, so the gallery cannot show them

- **Where:** `apps/desktop/src/renderer/views/`; `apps/desktop/package.json` (`exceptions: ["@juno/ui"]`); `apps/gallery/src/registry.ts:3-4`.
- **Problem:** architecture 3 puts views in `@juno/views` with fixtures; the first view is in the app, has no fixture, and the app depends on `ui` outside the graph. `App.tsx` still renders M0 demo buttons ("Primary action", "Disabled").
- **Fix:** create `packages/views` (`allowedDeps: ui, tokens, contract`), move `EngineStatusView` with a fixture, register `@juno/views/fixtures` in the gallery, remove the desktop `ui` exception once the shell is a view. Delete the demo buttons.

### 16. Composer autosize forces layout on every keystroke

- **Where:** `ui/src/Textarea.tsx:24-29`.
- **Problem:** `height = 'auto'`, read `scrollHeight`, write height, on each input: a forced synchronous layout in the one interaction with a 16 ms budget (performance rule 13).
- **Fix:** Chromium 152 supports `field-sizing: content`. Use `fieldSizing: 'content'` with the existing `maxHeight` styles and delete `fit`.

### 17. Main and engine load the whole `effect` barrel at startup

- **Where:** `apps/desktop/electron.vite.config.ts:44`; `out/main/index.js` and `out/main/chunks/protocol-*.js` do `require("effect")`.
- **Problem:** `effect` is externalised, so main loads every module behind the root barrel before it creates the window, just to decode `launch.json` and IPC payloads.
- **Fix:** measure time to window creation, then add `effect` to `externalizeDepsPlugin({ exclude })` so Rollup tree-shakes it into main and the engine. Keep whichever is faster.

## Tests

Good: domain, store, fake-slack and the new Slack client tests read as behaviour. The engine protocol test exercises the real client and server over a `MessageChannel`.

Fix:

- `packages/engine/test/list.test.ts` tests `@juno/state`'s `applyListDelta`. Move it to `packages/state/test/` (add `vitest` and a `test` script to state).
- `packages/domain/test/commands.test.ts:27,33,44,50-52,67,87,90` and `checks.test.ts:44,57` assert exact confidence numbers (0.95, 0.75, 0.88, 0.74) that are tuning constants. Assert the behaviour instead: ambiguous below unambiguous, full name above first name, within 0..1.
- `packages/domain/test/fixtures.ts:30` declares an `id` option that `topic()` ignores; `status.test.ts:92` passes it. Remove it or honour it.
- `packages/engine/test/protocol.test.ts` shares the global registry across tests (see finding 6).
- `e2e/engine.spec.ts:12-19` tests the 1 Hz uptime tick (see finding 8).

Missing, in order of value:

1. Theme survives a relaunch (finding 2).
2. Engine serve helpers: a burst collapses into two runs; a failed run keeps the subscription with `meta.error` (finding 3).
3. A defect in one handler fails only that request and the port stays usable (`disableFatalDefects`, ADR 0009). Claimed in docs, not tested.
4. Decode with `@juno/slack-schema`, render with richtext (finding 4).
5. Mouse-down activation in `ui`: `pointerdown` activates, ctrl-click and secondary button do not, a press on a nested button does not, keyboard Enter does. A Playwright spec against the gallery fits the "behaviour, not implementation" rule.

## Docs

Inaccurate:

- `docs/development.md:96` and `.claude/skills/stylex/SKILL.md:57`: `applyTheme()` is in `src/renderer/theme.ts`, not `src/renderer/state/theme.ts`.
- `.claude/skills/effect/SKILL.md:49`: "planned; M0 still imports Atom in renderer/state" is stale; the helpers exist. `SKILL.md:153` and `reference.md:63-68`: `@effect/vitest` is installed (store, slack).
- `docs/architecture.md:104`: engine feature-folder oxlint rules do not exist. `:412`: e2e runs one worker, not four. `:430,461`: there is no `AGENTS.md`; `CLAUDE.md` plays that role, so drop the line. Section 9: `MessageBody` has no `date` or `file` nodes, and richtext does not read `attachments` or `files` yet; say so. Section 3 graph: remove `slack --> domain`, add `slack-schema` (finding 4).
- `docs/performance.md:137` describes a `data-activated` flag; `ui/src/internal/activate.ts` ignores real clicks (`detail !== 0`) instead. Describe what the code does.
- `docs/architecture.md` 7 and performance 7.1 say `window.__juno.perf` exists only in dev and e2e; `renderer/main.tsx:18` sets it always.

Gaps a new agent hits:

- No end-to-end recipe. Replace development.md "Adding a route" with "Adding a feature": route in contract → handler in engine (with the store `liveQuery`) → atoms in `state/src/<feature>.ts` declared once at module level → container → view with fixture → e2e file.
- No README for `contract`, `engine`, `state` or `store`. Each needs ten lines: what it owns, its public API, where tests live.
- Error mapping between slack, store and contract is undocumented (finding 13).

Verbosity: development.md's 20 pitfalls mix pnpm, Electron, StyleX and Effect. Move the five Effect ones (clients die with `Effect.provide`, defects fatal, result atoms need a mount, one request per port, test clock) into `.claude/skills/effect/SKILL.md`, where agents writing Effect will see them, and leave a one-line pointer.

## Smaller items

- `contract/src/index.ts:28-35`: the `_AppInfoMatches` type check exists because `channels.ts` hand-writes `AppInfo`, `Theme` and `Platform`. Use `import type` from the schemas instead (type imports are erased, so the preload stays small) and delete the check.
- `Theme` is written five times: `contract/src/channels.ts:29`, `contract/src/index.ts:38`, `state/src/shell.ts:20`, `main/launch.ts:12`, `gallery/src/theme.ts:4`.
- `applyTheme` exists twice and has diverged: `renderer/theme.ts` has no accent and no `data-theme-switching` suppression (performance 2.4); `gallery/src/theme.ts` has both. Move the gallery version to `ui/src/theme.ts` and use it in both apps. Drop the unused `dark` class toggle.
- Fonts: `renderer/main.tsx:1-2` imports `@fontsource` files directly and misses the italic; the gallery uses `@juno/tokens/fonts.css`. Use the tokens file in both.
- `ui/src/ContextPill.tsx:7,21-26` duplicates `domain/src/channel.ts:45-73` (kinds and the "Public channel" copy). Make `ContextPill` take `tint`, `icon` and `label`.
- `ui/src/internal/interactive.ts:68-74`: `disabled` and `dimmed` are the same style.
- `ui/src/OptionList.tsx:93-94`: rows are `role="option"` even inside `role="menu"` (should be `menuitem`), and `aria-selected` is set for the keyboard highlight as well as the real selection.
- Raw values: `ListRow.tsx:119-120` (48px, 52px), `OptionList.tsx:299,304` (`fontWeight: 400`), `Segmented.tsx:79`, `Textarea.tsx:89,95`, `TextField.tsx:109-110`, `CodeBlock.tsx:25`. Use tokens or named constants (stylex skill rule 1).
- `domain/src/sidebar.ts:93` repeats the default quiet days instead of calling `quietDaysOf(ctx)`; `:70` spreads `ctx` for no reason. `firstName` is defined twice (`channel.ts:20`, `commands.ts:50`).
- `richtext` defines `BroadcastRange` twice (`model.ts:16`, `slack-types.ts:17`); goes away with finding 4.
- `store/src/queries.ts:61-67`: `prefs` and `sync_state` values are `JSON.parse(...) as A`. Give each key a schema when M5 adds real prefs.
- `state/tsconfig.json` includes the DOM lib, so DOM use in `state` only fails in the engine's typecheck. Remove it from state's config so the error shows where it is made.
- Dead: `CommonError` (`contract/src/errors.ts:40`), `PortHandoff` (`contract/src/protocol.ts:38`, the page checks the tag by hand), `type Handlers` (`engine/src/protocol/server.ts:15`), `plainTextBlocks` (`slack/src/schemas/blocks.ts:178`).
- Desktop containers import `@effect/atom-react` directly. Re-export the four hooks and `RegistryContext` from `@juno/state/react`, so the unstable package is reached through one module (effect skill rule).
- `effect/sql` is unstable but `store` exports `SqlClient` as its service type, so every engine feature will use it directly. That is a reasonable trade; record it in the effect skill's wrapper list so it is a decision, not an accident.
- `docs/architecture.md` lists `engine.ping` only as a diagnostic; the shell renders a "Ping engine" button. Keep the route for tests and remove the button with the demo buttons (finding 15), or show it only under `JUNO_E2E`.

## Work packages

Four packages with disjoint files. Each ends with `pnpm typecheck`, `pnpm lint`, `pnpm check-deps`, the touched packages' tests and `pnpm test:e2e`.

### A. Engine, state and contract wiring

Owns: `packages/contract/**`, `packages/engine/**`, `packages/state/**`, `apps/desktop/src/main/**`, `apps/desktop/src/preload/**`, `apps/desktop/src/engine/**`, `apps/desktop/src/renderer/containers/**`, `apps/desktop/e2e/engine.spec.ts`, `apps/desktop/e2e/fixtures.ts`, new `apps/desktop/e2e/theme.spec.ts`.

Items: findings 2, 3, 6, 7, 8, 9, 10, 13, 14; the `contract` dead code and `_AppInfoMatches`; `Theme` owned by contract (keep `export type Theme` in `state/src/shell.ts` as a re-export so `renderer/theme.ts` keeps compiling); `@juno/state/react`; move `list.test.ts` to state; remove DOM lib from state; tests 1 to 3 in "Missing".

### B. UI layer and build

Owns: `packages/ui/**`, `packages/tokens/**`, new `packages/views/**`, `apps/gallery/**`, `apps/desktop/src/renderer/{App.tsx,main.tsx,theme.ts,global.css,index.html,views/**}`, `apps/desktop/e2e/app.spec.ts`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/package.json`, new `scripts/check-bundle-size.mjs`.

Items: findings 1, 11, 15, 16, 17; one `applyTheme` in ui; fonts via tokens; `ContextPill` props; `interactive` dedupe; `OptionRow` roles; raw values; demo buttons; the activation Playwright spec (test 5). Fold in the design review's eight must-fix items, since they touch the same `ui` files. Move `EngineStatusView` into `packages/views` last and update the one import in `containers/EngineStatus.tsx` in coordination with package A (the only shared line).

### C. Shared Slack vocabulary

Owns: new `packages/slack-schema/**` (moved from `packages/slack/src/schemas/`), `packages/slack/package.json` and the import lines in `packages/slack/src/**` and `packages/slack/test/**`, `packages/richtext/**`, `packages/domain/**`, `packages/fake-slack/**`, `packages/store/src/rows.ts`, `packages/store/src/queries.ts`, `packages/store/package.json`, `pnpm-lock.yaml`.

Items: findings 4 and 5; `ConversationKind` in store from domain; domain small items (`quietDaysOf`, `firstName`, fixture `id`); confidence assertions; test 4. Note: package A's `contract` will import `Ts` from `@juno/slack-schema` later, not in this round.

### D. Guardrails and docs

Owns: `scripts/check-deps.mjs`, `scripts/check-no-pointer-cursor.mjs`, root `package.json`, `.oxlintrc.json`, `docs/architecture.md`, `docs/development.md`, `docs/performance.md`, `.claude/skills/**`, new package READMEs for contract, engine, state and store.

Items: finding 12; every item under "Docs"; the error-mapping paragraph (finding 13); the `effect/sql` decision. Write names as in "Decisions this review makes"; the code lands in A, B and C at the same time. Run `check-deps` last, after A, B and C merge, since its new path rules will flag anything they missed.
