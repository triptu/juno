# Development

How to build and run Juno, and how the repo is put together.

## Prerequisites

- Node 24 or newer (Node 26 is what this was built with).
- pnpm 12. Node 25+ has no Corepack, so install it directly: `npm i -g pnpm@12`.
- macOS for the window chrome and e2e tests. Nothing else is platform-specific yet.
- Google Chrome, for the gallery tests and screenshots.

No Playwright browser download is needed for the desktop e2e tests. Electron is the browser. The
gallery projects use the installed Google Chrome (`channel: 'chrome'`); set
`GALLERY_BROWSER=chromium` after `npx playwright install chromium` to use Playwright's own build.

## Commands

Run these from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs everything. Electron downloads its binary in a postinstall. |
| `pnpm dev` | Starts electron-vite with HMR for the renderer and reload for main and preload. |
| `pnpm build` | Builds main, preload and renderer into `apps/desktop/out/`, then checks the renderer bundle size. |
| `pnpm typecheck` | Runs `tsc` in every package. |
| `pnpm lint` | Runs oxlint, the `cursor: pointer` check, then `check-deps`. |
| `pnpm check-deps` | The package graph and the import rules in `docs/architecture.md` section 3. Part of `pnpm lint`; run it alone for a quicker loop. |
| `pnpm test` | Runs every package's vitest suite (`packages/*/test`). |
| `pnpm test:e2e` | Builds, runs the Playwright tests against the built app, then the gallery behaviour tests. |
| `pnpm test:gallery` | Builds the gallery and runs only its behaviour tests (mouse-down activation, cursor rule, state switcher, layout-shift guard). |
| `pnpm gallery` | Starts the fixture gallery at http://localhost:4174 (browser only, no Electron). |
| `pnpm gallery:shots` | Builds the gallery and screenshots every state in light and dark into `apps/gallery/shots/<Component>/<group>/<state>-<theme>.png`. |
| `pnpm --filter @juno/engine test` | Runs one package's suite (here the engine's: the port protocol over an in-memory MessageChannel, live query serving). |
| `node scripts/build-icons.mjs` | Rebuilds `apps/desktop/build/icon.icns` and `icon.png` from `assets/icon.svg`. See "App icon". |
| `pnpm package` | Builds a DMG and zip with electron-builder into `apps/desktop/release/`. Not run in CI yet. |
| `JUNO_LIVE=1 pnpm smoke:live` | The read-only live smoke against your real workspace (see "Sign-in and the live smoke"). `pnpm smoke:live -- --fake` runs the same script against an in-process fake. |
| `JUNO_LIVE=1 pnpm sync:live` | The read-only sync dry run: the real `@juno/sync` cold boot against your workspace into a temporary directory, numbers only (see "The live sync dry run"). `pnpm sync:live -- --fake` runs it against an in-process fake. |
| `pnpm ai:eval` | Runs every AI task on invented examples with the fake provider and prints the outputs. `JUNO_AI=live pnpm ai:eval` uses OpenRouter through pi-ai with `OPENROUTER_API_KEY` (environment or `.env`) and prints outputs, latency and cost; without a key it says so and exits. `pnpm ai:eval routeCheck` runs one task. See `packages/ai/README.md`. |

Before calling work done: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:e2e` for anything the app or gallery shows.

Copy `.env.example` to `.env` for local secrets. `.env` is ignored by git.

## Layout

```
apps/gallery            Vite + React gallery: a page per component, an address and a screenshot per state, plus behaviour tests.
apps/desktop            The Electron app. Thin wiring only.
  src/main              Window factory, IPC handlers, engine supervisor, juno:// scheme, launch.json.
  src/engine            Entry of the engine utility process: parentPort in, startEngine().
  src/preload           contextBridge. Exposes window.juno and forwards the engine port.
  src/renderer          React root, global.css, containers (wire atoms to views).
  e2e                   Playwright tests and the Electron launch fixture.
  electron.vite.config.ts
  electron-builder.yml
packages/tokens         @juno/tokens. The only place design values live.
packages/ui             @juno/ui. Primitives, StyleX only, each with *.fixtures.tsx. Owns applyTheme.
packages/views          @juno/views. Feature views (props in, callbacks out) with fixtures.
packages/testing        @juno/testing. Shared Playwright helpers (the layout-shift guard). Test code only.
packages/contract       @juno/contract. Routes (effect/rpc groups), live-query schemas, errors,
                        parentPort and port-handoff messages, main IPC routes.
packages/store          @juno/store. cache.db and user.db per workspace, migrations,
                        writer and reader clients, invalidation and live queries.
packages/engine         @juno/engine. The engine: protocol server, feature handlers, startEngine().
packages/sync           @juno/sync. Slack into the store: boot, discovery, merge rules, events, reindexTopics.
packages/ai             @juno/ai. The AiProvider service (pi-ai over OpenRouter, and a fake), the task table with prompts.
packages/state          @juno/state. The renderer's engine client and every atom.
packages/domain         @juno/domain. Pure product rules: ids, topic status, titles, sorting, notifications, checks.
packages/richtext       @juno/richtext. Slack blocks and mrkdwn to a message view model, and back.
packages/slack-schema   @juno/slack-schema. Effect Schemas for Slack payloads and the branded Ts.
packages/slack          @juno/slack. The Slack client as Effect services (SlackApi,
                        RequestQueue, SlackEdge, SlackSocket).
packages/fake-slack     @juno/fake-slack. In-process fake Slack with a control API.
scripts                 Repo scripts used by package.json (check-deps, bundle size, cursor rule, build-icons).
docs                    Research, design handoff, architecture, this file.
```

Every package has a README with its public API and rules. Read the one for the package you are about to change.

Workspace packages ship TypeScript source. Their `exports` point at `src/*.ts` and
the app's Vite build compiles them. There is no per-package build step.

Each package has its own `tsconfig.json` that extends `tsconfig.base.json` (strict,
`moduleResolution: bundler`, `verbatimModuleSyntax`). The desktop app has three:
`tsconfig.node.json` for main and preload, `tsconfig.web.json` for the renderer and
`tsconfig.e2e.json` for tests, because they need different `lib` and `types`.

## App icon

The source is `assets/icon.svg` (the laptop-two app icon; `assets/icon-dark.svg` and
`assets/mark.svg` sit next to it). `node scripts/build-icons.mjs` renders every iconset size
(16 to 1024, with @2x pairs) from the SVG in Chrome through Playwright, runs `iconutil`, and
writes two files that are committed:

- `apps/desktop/build/icon.icns`, used by electron-builder (`mac.icon` in `electron-builder.yml`).
- `apps/desktop/build/icon.png` (1024px), set as the Dock icon in development
  (`app.dock.setIcon` in `src/main/index.ts`), so `pnpm dev` does not show Electron's icon.

Rerun the script after editing `assets/icon.svg`. It needs macOS (`iconutil`) and Google Chrome
or Playwright's Chromium. The favicon is `src/renderer/public/favicon.svg` (and the same file in
`apps/gallery/public/`); it switches to a light mark in dark mode.

## How tokens flow into StyleX

1. `packages/tokens/src/tokens.stylex.ts` calls `stylex.defineVars` for colours,
   accent, tints, hues, shadows, radii, spacing, fonts, type roles, motion, layout,
   sizes, z layers and opacity. Every key starts with `--`, so StyleX emits a CSS
   variable with that exact name, for example `--background` or `--text-ui-size`.
   Values come from `docs/design/tokens.md`; `packages/tokens/README.md` explains
   the naming.
2. `packages/tokens/src/themes.stylex.ts` calls `stylex.createTheme` with the dark
   values. `dark` is the set of classes (colours, shadows, swatches) to apply. Each
   accent has a light and a dark theme on the `accent` group only, so they combine
   with `dark`; `applyTheme(theme, accent)` picks the pair.
3. Components import tokens through the subpath, never a barrel:
   `import { colors } from '@juno/tokens/tokens.stylex'`, then use
   `colors['--background']` inside `stylex.create`.
4. `@stylexjs/unplugin` in `electron.vite.config.ts` compiles every `stylex.create`
   and `defineVars` call into one CSS file during the renderer build. In dev it
   injects a virtual stylesheet into `index.html` itself.
5. Because the variable names are stable, plain CSS can use them too.
   `packages/tokens/src/global.css` (imported by the renderer's `global.css` and by
   the gallery) sets the body font, background, scrollbars and selection with
   `var(--font-sans)`, `var(--background)` and friends, and the e2e test reads the
   same variables to check computed colours.
6. The theme is switched by `applyTheme()` in `packages/ui/src/theme.ts`, which
   puts the dark and accent classes on `<html>` so portals attached to `<body>` are
   covered. The desktop app imports it from `@juno/views`, the gallery from `@juno/ui`.

Rules that come from the design spec and are enforced in `@juno/ui`:

- Default arrow cursor, never `cursor: pointer`. `pnpm lint` fails on it.
- Buttons scale to 0.96 on press, never when disabled.
- Hover styles only inside `@media (hover: hover)`.
- 2px focus ring in `--focus-ring` on `:focus-visible` only.
- Rows, tabs and option rows navigate on `pointerdown` (see `packages/ui/README.md`).
- Fonts are bundled by Vite from `@juno/tokens/fonts.css` (Figtree, Instrument Serif,
  JetBrains Mono), which both apps import. Never load fonts from a URL. Instrument
  Serif has one weight (400).

The `stylex` skill (`.claude/skills/stylex/SKILL.md`) has the full rules and the StyleX pitfalls.

## Processes

Three processes talk to each other (`docs/architecture.md` section 2):

- **main** forks the **engine** as an Electron utility process (`src/main/engine.ts`,
  built from `src/engine/index.ts` to `out/main/engine.js`) with the `persist:slack`
  partition and `serviceName: 'juno-engine'`, restarts it with backoff when it exits,
  and serves the renderer from `juno://app/` (`src/main/scheme.ts`).
- The **renderer** talks to the engine over one `MessagePort`. It asks main for a port
  (`window.juno.engine.requestPort()`), main creates a `MessageChannelMain`, posts one
  end to the engine and the other to the renderer, and the preload forwards it to the
  page with `window.postMessage`. When the engine dies the port fires `close`; the
  renderer asks for a new one and every live query re-subscribes.
- Everything on the port is `effect/rpc` (ADR 0009). Routes are declared once in
  `packages/contract/src/routes/<feature>.ts`, served by `packages/engine`, and
  called through `liveQuery(route)` and `command(route)` from `packages/state`.

`startEngine(transport, config, { host, httpTransport })` in `@juno/engine` runs
under plain Node too: the vitest suite in `packages/engine/test` connects the real
state client to it over a `worker_threads` `MessageChannel`, with `memoryHost()` in
place of main and Node `fetch` in place of `net.fetch`. Under `JUNO_E2E=1` main
exposes `globalThis.junoTest` (engine pid and supervisor state) for Playwright.

## Sign-in and the live smoke

Two ways in, both ending in a session the engine verifies with `auth.test`
(`docs/architecture.md` section 14):

- **Sign in to Slack** opens Slack's own sign-in page in a window on the
  `persist:slack` partition. The token is read from the page's `localConfig_v2`
  once it reaches `/client/<team>`; the cookie is already in the session.
- **Use the Slack app's session** reads copies of the installed Slack app's
  `Local Storage/leveldb` and `Cookies`. macOS asks once for access to the
  "Slack Safe Storage" keychain item (the `security` tool makes the request;
  choose "Allow", not "Always allow", if you prefer to be asked each time).
  The copies are deleted afterwards and the password is never stored.

Secrets go to `<userData>/secrets.bin`, encrypted with `safeStorage`. Under
`JUNO_E2E=1` the file is plain JSON and the three test seams are read from the
environment: `JUNO_FAKE_SLACK_URL` (the fake the sign-in window and the socket
allow-list point at), `JUNO_SLACK_APP_DIR` (a fixture Slack-app directory) and
`JUNO_SLACK_SAFE_STORAGE_PASSWORD` (stands in for the keychain). The e2e fixtures
in `apps/desktop/e2e/fixtures.ts` set all three; `juno.signIn()` and
`juno.importFromSlackApp()` in `apps/desktop/e2e/driver/juno.ts` are the verbs.

`JUNO_LIVE=1 pnpm smoke:live` (`scripts/smoke-live.ts`) is the manual, read-only
check against your real workspace. It imports the session the same way (keychain
prompt), prints its call list, calls `auth.test`, `client.userBoot`,
`client.counts`, `subscriptions.thread.getView` and one `conversations.history`
on a channel you are a member of, connects the socket and reads 30 s of events
(`--seconds N` for longer), decodes everything through `@juno/slack-schema` and
reports failures by path only. Redacted shapes land in
`packages/slack-schema/test/fixtures/recorded/` (one file per method, one per
socket frame type), `packages/slack-schema/test/recorded.test.ts` decodes them,
and `pnpm lint` runs `scripts/check-fixtures-redacted.mjs` over them so no id,
URL, email, timestamp or free text can be committed. The smoke refuses any
method outside its allow-list. `pnpm smoke:live -- --fake` runs it against an
in-process fake, which is how it is checked in development.

Skipping the keychain prompt on later runs: `JUNO_LIVE=1 pnpm smoke:live --
--cache-session` imports the session once (the Slack prompt appears) and keeps
the token, `d` cookie and team URL in a generic password of your login keychain
named `juno-dev-slack-session` (`security add-generic-password`, value passed on
stdin). Every later run finds it with `security find-generic-password` without a
prompt, because `security` itself created the item. `pnpm smoke:live --
--forget-session` deletes it. Delete it when the session stops working
(`auth.test: SlackAuthRequired`) and cache again, or before handing the machine
to someone else. The desktop app never reads this item.

## The live sync dry run

`JUNO_LIVE=1 pnpm sync:live` (`scripts/sync-live-dry-run.ts`) runs the real `@juno/sync`
cold boot (`runSync`, with the default `SyncConfig`) against your real workspace into a
temporary data directory, waits until boot and discovery finish (`live`) or `--seconds N`
(default 900) pass, prints aggregate numbers and deletes the directory. It reuses the
session the smoke cached (`juno-dev-slack-session`; run the smoke with `--cache-session`
first), so there is no keychain prompt and no import from the Slack app.

Read-only by construction: `SlackApi.call` is wrapped so any method outside its allow-list
(`auth.test`, `client.userBoot`, `users.prefs.get`, `client.counts`, `client.getWebSocketURL`,
`api.getFlannelHttpUrl`, `subscriptions.thread.getView`, `conversations.history`,
`conversations.replies`, `conversations.info`, `search.modules.messages`, edge `users/info`) dies before a request
is made, and `HttpTransport` checks the URL of every request the same way. Only the sync runs:
no outbox, no mark, no command handler. The output is counts and milliseconds: calls by
method and total time, conversations by kind and membership, topics by kind and how many the
sidebar shows under the quiet rule, unread and mention counts, decode issues by path, rate-limit
hits, the `topics.list` query time and snapshot size. Titles, names, message text and ids are
never printed; the Effect logger is replaced by one that prints messages and enum-like fields
only. `-- --until-quiet` keeps it running after `live` until no call has been made for 30 s, so the
background pass over the followed threads of the window is counted too (raise `--seconds` for it). `pnpm sync:live -- --fake` runs the same script against an in-process fake, which is how
it is checked in development.

Both live scripts run under plain Node (type stripping). `@juno/sync`, `@juno/store` and
`@juno/engine` use bundler-style relative imports (`./sync` for `./sync.ts`), which Node does
not resolve on its own, so `pnpm sync:live` starts Node with
`--import ./scripts/ts-resolve-hooks.mjs`, a small `module.registerHooks` resolver that tries
`.ts`, `.tsx` and `/index.ts`.

## IPC with main

`packages/contract/src/shell.ts` defines `ShellRoutes`: a channel name (from
`channels.ts`), an input schema and an output schema each. Main registers handlers
through `handle()` in `src/main/ipc.ts`, which checks the sender is the main frame
of one of our windows showing `juno://app/` (or the Vite dev URL), decodes the
input and encodes the output. The preload turns each route into one function on
`window.juno`. The renderer decodes the answer again (see `packages/state/src/shell.ts`)
and exposes it as an atom.

`packages/contract/src/channels.ts` has no runtime imports. The preload bundles only
that file so it stays under a kilobyte. Schemas live in `shell.ts`.

## Adding a feature

The path of one feature, from the wire to a test. `engine.status` is the worked example at every step.
Names are explained in `docs/architecture.md` sections 2.6 and 7.

1. **Route.** `packages/contract/src/routes/<feature>.ts`: `liveValueRoute('feature.thing', { value, payload? })`
   streams one value; `liveListRoute('feature.rows', { row, payload? })` streams a windowed list as
   deltas (rows need `id` and `rev`; the route adds `range: ListRange` to the payload itself);
   `Rpc.make('feature.do', { payload, success, error })` is a command. Errors come from `errors.ts`.
   Export the group as `<Feature>Routes`. The integration task adds it to `routes/index.ts`.
2. **Handler.** `packages/engine/src/<feature>/handlers.ts`: `<Feature>Routes.toLayer(...)`. For a
   store-backed query, pass `liveQuery(keys, timed(query))` from `@juno/store` to `serveLiveValue` or
   `serveLiveList` from `protocol/live.ts`; they stamp `meta` and diff rows by `rev`. Map `@juno/slack`
   errors to contract errors and turn `StoreError` into a defect (`Effect.orDie`); see architecture 2.6.
   The integration task adds the layer to `engine/src/layer.ts`. A feature folder imports nothing from
   another feature folder (`check-deps`).
3. **Atoms.** `packages/state/src/<feature>.ts`: declare each atom once, at module level, with
   `liveQuery(route)(payload)` or `command(route)`, and export it from `index.ts`. Both helpers are
   memoized per route, but one declaration keeps the names in one place.
4. **Container.** `apps/desktop/src/renderer/containers/<Feature>.tsx`: reads atoms with `useAtomValue`
   and `useAtomSet` from `@juno/state/react`, maps results to view props, binds callbacks to commands.
5. **View.** `packages/views/src/<Feature>View.tsx` with `<Feature>View.fixtures.tsx`, registered in
   `src/fixtures.ts` and exported from `index.ts`. Check it in `pnpm gallery`, one state at a time. Props in, callbacks out;
   no state, Effect or `window.juno`.
6. **Test.** `apps/desktop/e2e/<feature>.spec.ts` follows the user flow against the built app (and the
   fake Slack server once sign-in exists). Add engine or domain unit tests only for pure rules.

## Tests

| Kind | Where | Run |
| --- | --- | --- |
| Pure rules, store, Slack client, Slack-app import, merge rules, engine protocol, session, sync and the AI provider (fake, and pi-ai's scripted faux provider) | `packages/<name>/test/` (vitest) | `pnpm test` |
| The sidebar query and boot on the large seed (report only) | `packages/engine/test/bench/` | `JUNO_BENCH=1 pnpm --filter @juno/engine exec vitest run test/bench` |
| User flows in the built app | `apps/desktop/e2e/` (Playwright, one worker) | `pnpm test:e2e` |
| Mouse-down activation, cursor rule, state switcher, in a real browser | `apps/gallery/behaviour.spec.ts` | `pnpm test:gallery` |
| No layout shift on hover, press or focus, in every state | `apps/gallery/shift.spec.ts` (helper: `packages/testing`) | `pnpm test:gallery` |
| Screenshots of every state | `apps/gallery/shots.spec.ts` | `pnpm gallery:shots` |

Tests that need the Effect test clock use `@effect/vitest`; see the effect skill.

## The gallery

`pnpm gallery` serves every primitive and view at http://localhost:4174. A component page shows one state at a time, with the states listed beside it under group headings (a select above the frame in a narrow window). The list is plain system styling on purpose, so it is never mistaken for product UI.

- **Addresses.** `#/Button?__state=variant/primary&theme=dark&accent=claret`. `__state` is `<group>/<state>` (just `<state>` for a state declared without a group); no `__state` opens the first state. `theme` and `accent` are left out when they are the defaults. `#/` is the index, which lists each component with its groups and states. The old `#/Button/primary` still opens the first state with that key.
- **Keys.** `j` / `k` or the down / up arrows move between states; `[` and `]` switch components (wrapping). Keys are ignored while typing in a field, and the arrows are left to the component while focus is inside the frame.
- **Declaring states.** Group them under headings in product words (`Data`, `Session`, `Failure`, `Interaction`, `Overview`). See `packages/ui/README.md`. List only states the component's code can reach, add no branch to a component to make a state possible, and keep pending states still: nothing resolves on a timer. An unreachable fixture is removed, not kept for show.
- **Screenshots.** `pnpm gallery:shots` writes `apps/gallery/shots/<Component>/<group>/<state>-<theme>.png`.

### The layout-shift guard

Nothing may move when the pointer or the keyboard touches it. `expectNoLayoutShift(page, action)` from `@juno/testing/layout-shift` (`packages/testing`) runs `action` and fails with a report (the node, the old and new box, the delta) if anything shifted. It starts a `PerformanceObserver` for `layout-shift` entries just before the action, waits two frames plus the longest transition or animation declared under the frame, and counts every entry with a value above 0, including those Chromium marks `hadRecentInput` (every hover-driven shift is within 500 ms of input). As a fallback it compares the layout box of every element in the frame (`offsetLeft`, `offsetTop`, `offsetWidth`, `offsetHeight`, relative to the frame) before and after. Those ignore transforms, so the press scale is not a shift but a change of size, border or position is, and nothing has to be excluded.

`apps/gallery/shift.spec.ts` hovers, leaves, presses, releases, focuses from the keyboard and blurs every interactive element of every state, with motion on, and checks that an Avatar photo arriving late or failing moves nothing (the `photo/pending` state points at `/__fixture/pending.png`, which the gallery server never answers; the test answers it). The desktop e2e can import the same helper for sidebar hover, tab switches, live messages and image loads.

## Pitfalls met while setting this up

- **`ELECTRON_RUN_AS_NODE=1` in the shell.** Editors built on Electron export it to
  child shells. With it set, Electron starts as plain Node and never opens a window.
  `scripts/without-run-as-node.mjs` strips it for `dev`, `start` and `test:e2e`, and
  `playwright.config.ts` deletes it again.
- **pnpm 12 blocks install scripts.** `pnpm-workspace.yaml` must list `electron` and
  `esbuild` under `allowBuilds` (the old `onlyBuiltDependencies` key is ignored). If
  `apps/desktop/node_modules/electron/dist` is missing after install, run
  `node install.js` inside that directory once.
- **pnpm 12 minimum release age.** It refused `effect@4.0.3` as too new and wrote an
  exclusion into `pnpm-workspace.yaml`. Expect the same for other day-old releases
  (it did it again for `vitest@5.0.4`).
- **`node:sqlite` and Node versions.** Electron 44 runs Node 24.21; the system Node is
  26. `@effect/sql-sqlite-node` uses `isTransaction`, `columns()`, `setReturnArrays`
  and `backup`, and the store uses FTS5; all were checked in Electron's own Node. To
  run a package's tests under that Node:
  `ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/.pnpm/node_modules/vitest/vitest.mjs run`
  from the package directory. Node 24 prints an ExperimentalWarning for `node:sqlite`;
  it is harmless.
- **Workspace packages and `effect` in main and preload.** `externalizeDepsPlugin`
  externalises every dependency, and workspace packages ship TypeScript, so
  `electron.vite.config.ts` excludes `@juno/contract`, `@juno/engine`, `@juno/state`
  and `effect` to bundle them. Bundling `effect` cut the launch to first window from
  416 ms to 314 ms. Add a workspace package that main or the engine imports to that list.
- **`app.getVersion()` in tests.** Launching Electron with the script path makes it
  report Electron's own version. The fixture launches the package directory, like
  `electron .`, and `package.json` has `productName: "Juno"`.
- **No `getLastWebPreferences` in Electron 44.** The e2e test checks isolation from
  the page side (`require` and `process` are undefined, only `window.juno` exists).
- **`.browserslistrc`** targets Chromium 152 so lightningcss does not rewrite
  `light-dark()` into a no-op polyfill.
- **The preload has no `window` type.** `tsconfig.node.json` has no DOM lib, so
  `src/preload/index.ts` starts with `/// <reference lib="dom" />`.
- **`@juno/state` must typecheck without the DOM lib** because the engine's tests
  import it. Browser globals are reached through `globalThis` with local types
  (`perf.ts`, `port.ts`), never through the DOM lib's names.
- **Node and DOM `MessagePort`s** have the same `addEventListener` surface at runtime
  but different typings; tests cast Node ports to `PortLike` / `MessagePortLike`.
- **Renderer bundle size.** The budget is 1.0 MB of initial JS and 150 KB of CSS
  (`docs/performance.md`); `pnpm build` runs `scripts/check-bundle-size.mjs` and fails
  over it. The M1 shell is 426.1 KB of JS (138.6 KB gzip) and 68.7 KB of CSS, minified.
  electron-vite does not minify by default, so the config sets `minify: 'esbuild'` for
  all three targets; without it the same code was 1,097 KB.

Effect and StyleX pitfalls are in their skills: `.claude/skills/effect/SKILL.md` ("Pitfalls") and
`.claude/skills/stylex/SKILL.md`.

## Heavy jobs share one queue

Tests, e2e runs, gallery shots, benchmarks and spec checks spawn many processes. Several agents often work in separate worktrees on the same machine, so the root scripts (`pnpm test`, `pnpm test:e2e`, `pnpm test:gallery`, `pnpm gallery:shots`, `pnpm specs:check`) run through `scripts/heavy.mjs`. It takes a machine-wide lock in the system temp folder, shared by every worktree, and waits for a free slot. `JUNO_HEAVY_SLOTS` raises the number of slots (default 1). Running a package's tests directly bypasses the queue, so prefer the root scripts.

