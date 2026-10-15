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
| `pnpm typecheck` | Typechecks every tsc project (each package's configs and `scripts/tsconfig.json`), skipping the ones whose inputs passed before; see "Typecheck". |
| `pnpm lint` | Runs oxlint, the `cursor: pointer` check, then `check-deps`. |
| `pnpm check-deps` | The package graph and the import rules in `docs/architecture.md` section 3. Part of `pnpm lint`; run it alone for a quicker loop. |
| `pnpm health` | Reports unused code and dependencies, duplication, and large files and functions. Writes `.juno-status/health.json`. |
| `pnpm test` | Runs every package's vitest suite (`packages/*/test`). |
| `pnpm test:e2e` | Builds, runs the Playwright tests against the built app, then the gallery behaviour tests. |
| `pnpm perf` | Builds and runs the perf scenarios (`apps/desktop/e2e/perf.spec.ts`), which fail over the budgets in `docs/performance.md`. `-g "<name>"` runs some of them; `JUNO_PERF_TRACE=<dir>` also writes traces for `scripts/perf-trace.mjs`. |
| `pnpm test:gallery` | Builds the gallery and runs only its behaviour tests (mouse-down activation, cursor rule, state switcher, layout-shift guard). |
| `pnpm test:feel` | Builds, then records the feel suite against the fake Slack: slow-motion videos, filmstrips and frame checks in `apps/desktop/feel-report/`. See "The feel suite". |
| `pnpm gallery` | Starts the fixture gallery at http://localhost:4174 (browser only, no Electron). |
| `pnpm gallery:shots` | Builds the gallery and screenshots every state in light and dark into `apps/gallery/shots/<Component>/<group>/<state>-<theme>.png`. |
| `pnpm specs:check` | Checks every Quint spec in `specs/`, including the broken and corrected pairs for Juno Agent. Runs simulations three at a time, the Apalache checks on one shared server, and skips checks that passed before with the same inputs (see "Faster test runs"). `--memory`, `--actions` or `--recovery` selects one agent spec. See `specs/README.md`. |
| `pnpm remote <script>` | Runs a Linux-safe root script (`test`, `specs:check`, `test:agent*`, `test:gallery`, `test:e2e`) on a fresh Namespace machine and streams the output. `--dry-run` shows what would be sent and run. See ADR 0013. |
| `pnpm test:agent-contracts` | Runs the `agent-cards` and `agent-contract` property tests: card identities, digests, retries, the RPC codecs and the chat projection. |
| `pnpm --filter @juno/agent-memory test` | Runs the pure memory rules' property tests. Its script takes the heavy-job lock itself. |
| `pnpm --filter @juno/engine test` | Runs one package's suite (here the engine's: the port protocol over an in-memory MessageChannel, live query serving). |
| `node scripts/build-icons.mjs` | Rebuilds `apps/desktop/build/icon.icns` and `icon.png` from `assets/icon.svg`. See "App icon". |
| `pnpm package` | Builds a DMG and zip with electron-builder into `apps/desktop/release/`. Not run in CI yet. |
| `JUNO_LIVE=1 pnpm smoke:live` | The read-only live smoke against your real workspace (see "Sign-in and the live smoke"). `pnpm smoke:live -- --fake` runs the same script against an in-process fake. |
| `JUNO_LIVE=1 pnpm sync:live` | The read-only sync dry run: the real `@juno/sync` cold boot against your workspace into a temporary directory, numbers only (see "The live sync dry run"). `pnpm sync:live -- --fake` runs it against an in-process fake. |
| `pnpm ai:eval` | Runs every AI task on invented examples with the fake provider and prints the outputs. `JUNO_AI=live pnpm ai:eval` uses OpenRouter through pi-ai with `OPENROUTER_API_KEY` (environment or `.env`) and prints outputs, latency and cost; without a key it says so and exits. `pnpm ai:eval routeCheck` runs one task. See `packages/ai/README.md`. |

`GALLERY_SHOTS_ONLY=Sidebar,Workspace pnpm gallery:shots` refreshes only those components and leaves other shots untouched.

The switcher, key and index tests use `GalleryTestComponent`, declared in `apps/gallery/src/testFixtures.tsx`. It is registered only when the page is opened as `/?test-fixtures#/...`, so it never shows in the normal gallery or the screenshots. Set `GALLERY_PORT` to run the tests while another worktree holds port 4174.

Before calling work done: `pnpm affected`, which covers typecheck, lint and the tests the change reaches (see "Affected tests").

Copy `.env.example` to `.env` for local secrets. `.env` is ignored by git.

## Codebase health

Run `pnpm health` for a summary and the largest clone pairs, files, and functions.
It runs separately from lint, does not take the heavy-job lock, and always exits successfully.
Findings and tool errors are report-only. These checks become blocking once the existing findings are cleaned up.

- **Knip** checks unused files, value exports, type exports, dependencies, and unlisted dependencies across all workspaces, scripts, and test entries. `pnpm health:knip` prints every finding. Private package exports are included, so a barrel export with no consumers is a finding even if its implementation is used internally.
- **jscpd** checks `packages/*/src` and `apps/*/src`, including fixtures and CSS. Clones need at least 100 tokens and eight lines. Comments and whitespace do not count as matching tokens. The percentage is duplicated lines divided by scanned source lines. `pnpm health:clones` writes the full clone report.
- **Size** checks tracked and new code files in apps, packages, scripts, and specs, including tests and configs. It reports files over 400 physical lines and functions over 80 lines using the TypeScript parser. Functions include methods, generators, and callbacks, with comments and blank lines inside their span. Nested functions can overlap. `pnpm health:size` prints every result.

`.juno-status/health.json` contains a timestamp, counts, duplication percentage, top offenders, and full Knip and size findings. `complete: false`, a null count, and an `errors` entry mean a tool failed, not that it found zero issues. Each external tool has a 20-second timeout. Raw reports are in `.juno-status/knip-report.json` and `.juno-status/jscpd-report.json`; all reports are gitignored.

Knip exceptions are commented in `knip.config.mjs`. Fontsource dependencies are loaded by CSS `@import`, which Knip does not parse. Babel loads `babel-plugin-react-compiler` by a string in both Vite configs. The default exports of the Knip and electron-vite configs are tool entry points. The icon script resolves Playwright through desktop's manifest with `createRequire`, where it is declared. Exports used inside their own module are omitted because that code is live; unused barrel re-exports remain visible. No source files or existing findings are excluded.

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

Three processes talk to each other, four with Juno Agent on (`docs/architecture.md` section 2):

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

With `JUNO_AGENT=1` (for example `JUNO_AGENT=1 pnpm dev`), main also forks the Juno
Agent utility process (`src/main/agent.ts`, built from `src/agent/index.ts` to
`out/main/agent.js`) without the Slack partition, and on every engine `ready` brokers
a port between the agent and the engine's AgentHost server (ADR 0012). It stays off
by default until the chat ships. The spike scripts behind the agent's design are in
`docs/juno-agent/spikes/`, with their results in `docs/juno-agent/spikes.md`.

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
| Feel: no shift, jump, flicker, empty frame or late feedback, frame by frame, in the built app | `apps/desktop/e2e/feel/*.feel.ts` | `pnpm test:feel` |

Tests that need the Effect test clock use `@effect/vitest`; see the effect skill.

## The gallery

`pnpm gallery` serves every primitive and view at http://localhost:4174. A component page shows one state at a time, with the states listed beside it under group headings (a select above the frame in a narrow window). The list is plain system styling on purpose, so it is never mistaken for product UI.

- **Addresses.** `#/Button?__state=variant/primary&theme=dark&accent=claret`. `__state` is `<group>/<state>` (just `<state>` for a state declared without a group); no `__state` opens the first state. `theme` and `accent` are left out when they are the defaults. `#/` is the index, which lists each component with its groups and states. The old `#/Button/primary` still opens the first state with that key.
- **Keys.** `j` / `k` or the down / up arrows move between states; `[` and `]` switch components (wrapping). Keys are ignored while typing in a field, and the arrows are left to the component while focus is inside the frame.
- **Declaring states.** Group them under headings in product words (`Data`, `Session`, `Failure`, `Interaction`, `Overview`). See `packages/ui/README.md`. List only states the component's code can reach, add no branch to a component to make a state possible, and keep pending states still: nothing resolves on a timer. An unreachable fixture is removed, not kept for show.
- **Screenshots.** `pnpm gallery:shots` writes `apps/gallery/shots/<Component>/<group>/<state>-<theme>.png`.

### The layout-shift guard

Nothing may move when the pointer or the keyboard touches it. `expectNoLayoutShift(page, action)` from `@juno/testing/layout-shift` (`packages/testing`) runs `action` and fails with a report (the node, the old and new box, the delta) if anything shifted. It starts a `PerformanceObserver` for `layout-shift` entries just before the action, waits two frames and then until every transition or animation running under the frame has finished (one iteration of an endless one the action started), and counts every entry with a value above 0, including those Chromium marks `hadRecentInput`. As a fallback it compares the layout box of every element in the frame (`offsetLeft`, `offsetTop`, `offsetWidth`, `offsetHeight`, relative to the frame) before and after. Those ignore transforms, so the press scale is not a shift but a change of size, border or position is, and nothing has to be excluded.

`apps/gallery/shift.spec.ts` hovers, leaves, presses, releases, focuses from the keyboard and blurs every interactive element of every state, with motion on, and checks that an Avatar photo arriving late or failing moves nothing (the `photo/pending` state points at `/__fixture/pending.png`, which the gallery server never answers; the test answers it). The desktop e2e can import the same helper for sidebar hover, tab switches, live messages and image loads.

## The feel suite

`pnpm test:feel` records scripted interactions in the built app against the fake Slack and checks them frame by frame. It is separate from `test:e2e` (its own config, `apps/desktop/playwright.feel.config.ts`) because it records video and takes a few minutes.

- **Recording.** `e2e/feel/recorder.ts` takes every compositor frame through the CDP screencast, and on every animation frame reads a few DOM probes (a rectangle, the scroll position, the rows at the top and bottom edges of the view, header text, an element's computed look), plus `layout-shift` and `long-animation-frame` entries and the input events.
- **When probes read.** Once per frame, in a ResizeObserver created in that frame's `requestAnimationFrame`, so it is delivered after layout and after the app's own observers, just before paint. Reading in `requestAnimationFrame` itself sees states the app corrects before painting (the topic view pins its scroll position in a ResizeObserver), and reported jumps that never reached the screen. When a check and the images disagree, trust the images and fix the probe.
- **Checks.** `e2e/feel/checks.ts` turns a recording into verdicts: an element lands and stays, the list stays at the bottom, the row in view holds still, feedback shows in the first frame after the event, a popover opens whole at its anchor, the pane switches from the old state to the new one with nothing between, no blank or flickering region (pixel diffs between frames), no long frames. They count frames and compare geometry, so a loaded machine slows a run down without failing it. Only the long-frame check uses durations: a frame over 100 ms with the page's own work in it fails; other frames over 50 ms only warn.
- **Scenarios.** One `*.feel.ts` file per area: opening topics and what arrives while reading (`topic`), hover, press and popovers (`interaction`), a 300-message thread with late images, the divider, scrolling and reactions (`long`), tab restore (`tabs`), and a skipped placeholder for Juno chat (`chat`). Add a scenario with `feel.run({ name, title, probes, regions, checks }, action)`; mark steps with `rec.mark('press')` so checks can start there.
- **Artefacts.** `apps/desktop/feel-report/` (gitignored, emptied each run): per scenario `frames/NNNN.jpg`, `filmstrip.png` (labelled tiles, failed frames outlined in red), `video.webm` (4× slow motion) and `result.json`; and `index.html`, the contact sheet with every scenario's checks, video and filmstrip, failures first. Open it with `open apps/desktop/feel-report/index.html`.
- **Needs.** The installed Google Chrome draws the filmstrips and computes the pixel diffs (`FEEL_BROWSER=chromium` uses Playwright's build instead). ffmpeg encodes the videos (`brew install ffmpeg`); without it the run still checks and writes filmstrips, and says there is no video.

## Milestone reviews

At the end of each UI milestone, run these reviews in parallel and turn the findings into fix packages with disjoint files. Each writes to `docs/reviews/<milestone>/`.

1. **Design review.** The `interfaces:better-interface` skill on the built app and the gallery shots, as in `docs/reviews/m3/design-review.md`.
2. **Code and performance review.** The performance skill's review questions and `docs/performance.md` 7.4, with measured numbers against every budget, as in `docs/reviews/m3/code-perf-review.md`.
3. **Feel review.** The `feel-review` skill (`.claude/skills/feel-review/`): run `pnpm test:feel`, read the contact sheet and the filmstrips, and report what shifts, jumps, flickers, flashes empty or answers late, with frame numbers.

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

## Faster test runs

- **Spec cache.** `pnpm specs:check` stores each passing Quint run in the system temp folder (`juno-cache/specs`), keyed by its arguments, what is checked on its output, the spec file and what it imports, and the Quint and Apalache versions. Every worktree shares it. A run whose key matches is not repeated: its saved output goes through the same checks and its trace is written back to `specs/traces/`. A changed spec reruns only its own checks. `SPECS_CACHE=off pnpm specs:check` or `--no-cache` runs everything; `SPECS_JOBS=<n>` sets how many typechecks and simulations run at once (default 3). The Apalache checks run after them, one at a time, on one Apalache server started for the run, so a check no longer pays for starting a JVM. Bump `cacheVersion` in `specs/check.mjs` when you change how a result is checked.
- **Build skip.** `test:e2e`, `perf`, `test:feel`, `test:gallery` and `gallery:shots` build through `scripts/build-cached.mjs`, which skips the build when no file git sees in the app or `packages/` changed since the last build and the output is untouched. `JUNO_REBUILD=1` forces a build. `pnpm build` and `pnpm dev` always build.
- **Shift guard.** The guard waits only for transitions and animations that are running after a touch, and its twelve parts take components from one queue in the temp folder, so they finish together. `GALLERY_SHIFT_ONLY=Button,Chip pnpm test:gallery` checks a few components while you iterate.
- **Changed tests only.** `pnpm test --changed main` runs only the vitest files affected by changes since `main` (vitest follows imports across packages). Run the full suite once before you report.
- **Remote runs.** `pnpm remote <script>` takes no local slot. See "Remote runs" below.

## Typecheck

Packages ship TypeScript source, so each package's `tsc -p` also checks the source of every workspace package it depends on, and 29 projects repeat much of the same work. `pnpm typecheck` (`scripts/typecheck.mjs`) runs the same projects with the same tsconfigs, so the rules are unchanged, but:

- **Skips what passed.** A project's key is a hash of its package's files, the files of every workspace package it depends on (directly or not), its tsconfig chain, `tsconfig.base.json`, the lockfile and the TypeScript version. A passing key is recorded in the system temp folder (`juno-cache/typecheck`), shared by every worktree; `pnpm remote typecheck` brings its results back. An unchanged project costs nothing. `--no-cache` checks everything.
- **Incremental.** A project that runs uses `tsc --incremental`, with its build info in the package's `node_modules/.cache/tsc/`, so only what changed is checked again.
- **Queued.** At most `JUNO_TYPECHECK_JOBS` (default 2) tsc processes in one run, and at most two at once on the Mac across every worktree (a separate `typecheck` queue in `scripts/heavy.mjs`, apart from the test slots).

Timings (2026-10-15):

| Run | Old `pnpm -r typecheck` | `pnpm typecheck` |
| --- | --- | --- |
| Mac, quiet (load 3 to 5), nothing cached or built | 35.6 s | 36.6 s (same work, two tsc at once) |
| Mac, quiet, incremental build info only (`--no-cache`) | 35.6 s | 15.4 s |
| Mac, nothing changed | 35.6 s | 3.9 s |
| Mac, one engine test file changed (5 projects) | 35.6 s | 8.2 s |
| Mac, a dozen worktrees at once | over 30 minutes (reported) | at most two tsc on the Mac; the rest wait or are cached |
| 16x32 remote, nothing cached | 34 s | 14.5 s |
| 16x32 remote, all cached | | 0.0 s (about 30 s end to end, warm) |

`pnpm lint` stays whole: oxlint, the cursor rule, `check-deps` and the fixture check take about 3 s together even on the loaded Mac, and `check-deps` needs the whole package graph to see a bad edge.

## Affected tests

`pnpm affected` works out which tests the change can reach and runs only those, each suite on its own Namespace machine at the same time (`--local` runs them one after another through the local root scripts; `--plan` only prints the plan; `--files a,b` plans for given files). The change is every file that differs from the merge base with `main`, committed or not, plus new files. Agents use it while iterating and for their report; full suites run on a schedule against `main` and before a merge when asked.

An import graph over `apps/` and `packages/` decides what each change reaches: relative imports, `@juno/*` through each package's `exports`, and named imports followed through barrel files (`export * from` and `export { } from`) to the module that declares the name. The rules:

| Changed | Runs |
| --- | --- |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the root `package.json`, `tsconfig.base.json`, `scripts/affected.mjs`, `scripts/remote*`, `scripts/heavy.mjs`, `scripts/build-cached.mjs` | everything below, in full |
| A file a vitest file reaches, or a package's `package.json`, `vitest.config.ts` or `tsconfig.json` | those vitest files (`pnpm test --passWithNoTests <files>`) |
| `specs/` (not Markdown) | `pnpm specs:check`, narrowed to `--memory`, `--actions` or `--recovery` when only that agent spec changed; its cache skips checks whose inputs passed before |
| A file a component's fixtures reach | `pnpm test:gallery` with `GALLERY_SHIFT_ONLY` set to those components (the behaviour tests run in full) |
| `apps/gallery/` (except `shots.spec.ts`), `packages/tokens/`, `packages/testing/` | `pnpm test:gallery` for every component |
| A file the desktop app or the e2e support reaches (`apps/desktop/src`, `e2e/fixtures.ts`, `e2e/driver/`, the Playwright config) | `pnpm test:desktop` in full |
| Only e2e spec files | `pnpm test:desktop <those files>` |
| Any `.ts`, `.tsx` or config a tsc project reads | `pnpm typecheck` remotely, when a project's key has not passed; it checks only those projects |
| Anything but Markdown | `pnpm lint`, on the Mac (about 3 s, less than a remote machine's overhead) |
| Documentation only | nothing |

**Results cache.** Each unit test file, gallery component (plus one item for the behaviour tests) and desktop e2e spec file is an item with a key: a hash of every file it reaches, its package and suite configs, and the lockfile. After a step passes, its items' keys are recorded in the system temp folder (`juno-cache/results`), shared by every worktree, whether the step ran here or remotely. An item whose key passed before is skipped and counted in the plan; `--no-cache` runs everything. `specs:check` keeps its own cache per Quint run. A failing step records nothing.

`perf` and `test:feel` never run here; the plan reminds you to run them on the Mac when the renderer or a view changed. The graph errs towards running more: a module imported whole (`import x from`, `import * as`) brings everything it imports. A test whose behaviour depends on a file it does not import (a fixture read from disk, an environment variable) is not seen; the scheduled full run on `main` catches that.

## Remote runs

`pnpm remote <script> [args...]` runs a root script on a Namespace Linux machine (16 vCPU, 32 GB; `--machine` overrides) and streams its output and exit code back. Each run gets its own machine, so agents never wait for each other; nothing takes the local heavy-job lock. Use it for `test`, `specs:check`, `test:agent*`, `test:gallery`, `test:desktop` (the desktop e2e alone; it passes arguments on, for example `pnpm remote test:desktop e2e/topic.spec.ts`) and `test:e2e`. `perf` and `test:feel` are refused: they time the Mac. Desktop e2e tests tagged `@mac` (`{ tag: '@mac' }`) depend on macOS behaviour and are skipped on Linux; the Mac runs them. Today that is one test, the sidebar width surviving a relaunch.

- **What is sent.** The files git sees in the worktree (tracked or new, not ignored), so uncommitted work is tested; `.env`, `node_modules`, build output and design images under `docs/` are not. The script stops if a file looks like a key or token file or holds what looks like a real Slack token.
- **Where it runs.** In the image from `scripts/remote/Dockerfile` (Playwright's Ubuntu image with Node 26, pnpm, Java 21, the installed workspace and Quint's downloads). Its tag is a hash of the Dockerfile, `pnpm-lock.yaml` and `pnpm-workspace.yaml`; when the registry lacks it, the first run builds it with `nsc build` (about two minutes) while others on the same Mac wait. Inside, `scripts/remote/run.sh` links the workspace offline and runs the script under xvfb with more workers than the Mac uses.
- **Results.** Output streams live; reports (spec traces, Playwright results) land in `.remote/<run>/`. The exit code is the script's own.
- **Warm pool.** After a clean run the machine goes back to a pool kept in the system temp folder (`scripts/remote/pool.mjs`); the next run on this Mac claims it with the image already pulled, which takes a small suite from about 190 s to 19 s. A machine runs one job at a time. A detached reaper destroys it after `JUNO_REMOTE_IDLE_MINUTES` (default 10) idle minutes, every machine ends after 3 hours, and after a failure or Ctrl-C the machine is destroyed at once. `pnpm remote --status` lists the pool; `pnpm remote --drain` destroys the idle machines.
- **Cap.** Machines in use and idle stay within `JUNO_REMOTE_MAX_VCPU` (default 64 vCPU, four 16x32 machines: the Team plan's Linux limit). A run waits while the pool is full and says so. An idle machine of another shape is destroyed to make room.
- **Cost.** A 16x32 machine costs about $0.016 a minute. The cap bounds the spend at about $1 an hour with every machine busy; idle machines live at most 10 minutes. `--keep` leaves a machine up outside the pool for `nsc ssh <id>`.
- **Setup.** `brew install namespacelabs/namespace/nsc` and `nsc login` once on the Mac. No credentials live in the repo.
- **Timings** (2026-10-15, 16x32). Local times are with a free slot, before any queue wait. A new machine adds about 20 s to create and 45 s to pull the image; a warm one adds about 10 s.

  | Script | Local (Mac) | Remote, new machine | Remote, warm machine | Script only | CPU busy |
  | --- | --- | --- | --- | --- | --- |
  | `test` | 160 s | 225 s | 107 s | about 85 s (the engine's `sync.test.ts` alone is about 60 s) | 8% |
  | `specs:check`, nothing cached | 629 s (614 to 645 s in other agents' logs) | 214 s | 120 s | 82 to 100 s | 87% |
  | `specs:check --shards 2` | | | | 68 and 72 s per shard | 80 to 84% |
  | `specs:check`, all cached | | | 39 s | 0.2 s | |
  | `test:agent-contracts` | about 5 s | 190 s | 14 to 21 s | 2 s | 12% |
  | `test:gallery` | 16.4 min (13.7 to 18.5 min in other agents' logs) | 153 s | 85 s | 53 s | 30 to 36% |
  | `test:desktop` | 2.9 min plus the build | 261 s | 124 s | 25 s | 31% |

  The slowest Apalache check (about 50 to 70 s with the server start) is the floor of a spec check, so `--shards 2` saves about 20 s and more shards save nothing; it is not the default.
- **Shards.** `pnpm remote --shards n <script>` runs the script on n machines at once with `JUNO_SHARD=i/n`; `specs:check` keeps its share of the jobs (dealt by expected cost, typechecks on every shard).
- **Spec cache.** A remote spec check takes the Mac's cache of passing Quint runs along (staged in `.remote/`) and brings back what it adds, so a check that passed anywhere is not run again.
- **Dials.** About one dial in four to Namespace's SSH gateway fails from this network and nsc takes 16 s to give up. The remote command prints a start line first; with none after 8 s, the run dials again (up to six times).
- **`--dry-run`** prints the steps without creating anything.

## Heavy jobs share one queue

Tests, e2e runs, gallery shots, benchmarks and spec checks spawn many processes. Several agents often work in separate worktrees on the same machine, so the root scripts (`pnpm test`, `pnpm test:e2e`, `pnpm test:feel`, `pnpm test:gallery`, `pnpm gallery:shots`, `pnpm specs:check`, `pnpm test:agent-contracts`, `pnpm test:agent-testing`) run through `scripts/heavy.mjs`. It takes a machine-wide lock in the system temp folder, shared by every worktree, and waits for a free slot. There are two slots by default (`JUNO_HEAVY_SLOTS` changes it): e2e and gallery runs spend most of their time waiting, so two fit on an 8-core, 8 GB machine. Timing runs (`pnpm perf`, `pnpm test:feel`) pass `--exclusive`, which takes every slot and stops new jobs from starting while it waits, so their numbers are not skewed by another run. Running a package's tests directly bypasses the queue, so prefer the root scripts.

