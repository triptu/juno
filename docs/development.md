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
| `pnpm typecheck` | Fast local check of all Bun-compatible projects with the pinned Bun; see "Typecheck". |
| `pnpm typecheck:tsc` | Manual TypeScript check of every project. |
| `pnpm typecheck:parity` | Manual comparison of Bun and TypeScript diagnostics across projects; bypasses result caches. |
| `pnpm lint` | Runs oxlint, cursor and token checks, dependency and fixture checks, and the health ratchet. |
| `pnpm check-deps` | The package graph and the import rules in `docs/architecture.md` section 3. Part of `pnpm lint`; run it alone for a quicker loop. |
| `pnpm health` | Reports unused code and dependencies, duplication, and large files and functions. Writes `.juno-status/health.json`. |
| `pnpm test` | Runs every package's vitest suite (`packages/*/test`). |
| `pnpm test:e2e` | Builds, runs the Playwright tests against the built app, then the gallery behaviour tests. |
| `pnpm perf` | Builds and runs the perf scenarios (`apps/desktop/e2e/perf.spec.ts`, config `playwright.perf.config.ts`), which fail over the budgets in `docs/performance.md`. A scenario that did not run, because its group's setup or an earlier scenario failed, fails the run too (`e2e/no-skips.ts`). `-g "<name>"` runs some of them; `JUNO_PERF_TRACE=<dir>` also writes traces for `scripts/perf-trace.mjs`. Passing `--reporter` replaces that check, so do not. |
| `pnpm test:gallery` | Builds the gallery and runs only its behaviour tests (mouse-down activation, cursor rule, state switcher, layout-shift guard). |
| `pnpm test:feel` | Builds, then records the feel suite against the fake Slack: slow-motion videos, filmstrips and frame checks in `apps/desktop/feel-report/`. See "The feel suite". |
| `pnpm gallery` | Starts the fixture gallery at http://localhost:4174 (browser only, no Electron). |
| `pnpm gallery:shots` | Builds the gallery and screenshots every state in light and dark into `apps/gallery/shots/<Component>/<group>/<state>-<theme>.png`. |
| `pnpm specs:check` | Checks every Quint spec in `specs/`, including the broken and corrected pairs for Juno Agent. Runs simulations three at a time, the Apalache checks on one shared server, and skips checks that passed before with the same inputs (see "Faster test runs"). `--memory`, `--actions` or `--recovery` selects one agent spec. See `specs/README.md`. |
| `pnpm specs:conformance` | Generates Quint traces of `specs/outbox.qnt` and replays them against the engine and the fake Slack (`specs/README.md`, "Conformance"). About 85 s on a remote machine. |
| `pnpm remote <script>` | Runs a Linux-safe root script (`test`, `specs:check`, `specs:conformance`, `test:agent*`, `test:gallery`, `test:e2e`) on a fresh Namespace machine and streams the output. `--dry-run` shows what would be sent and run. See ADR 0013. |
| `pnpm flake <spec>` | Repeats desktop e2e, gallery or package tests many times on remote machines (`-g <title>`, `--repeat 40`, `--machines 1\|2`, `--workers n`) and reports how many runs failed, with traces of the failures. See "Hunting a flaky test". |
| `pnpm test:agent-contracts` | Runs the `agent-cards` and `agent-contract` property tests: card identities, digests, retries, the RPC codecs and the chat projection. |
| `pnpm --filter @juno/agent-memory test` | Runs the pure memory rules' property tests. Its script takes the heavy-job lock itself. |
| `pnpm --filter @juno/engine test` | Runs one package's suite (here the engine's: the port protocol over an in-memory MessageChannel, live query serving). |
| `node scripts/build-icons.mjs` | Rebuilds `apps/desktop/build/icon.icns` and `icon.png` from `assets/icon.svg`. See "App icon". |
| `pnpm package` | Builds a DMG and zip with electron-builder into `apps/desktop/release/`. The tag workflow also builds these; see "Releasing". |
| `JUNO_LIVE=1 pnpm smoke:live` | The read-only live smoke against your real workspace (see "Sign-in and the live smoke"). `pnpm smoke:live -- --fake` runs the same script against an in-process fake. |
| `JUNO_LIVE=1 pnpm sync:live` | The read-only sync dry run: the real `@juno/sync` cold boot against your workspace into a temporary directory, numbers only (see "The live sync dry run"). `pnpm sync:live -- --fake` runs it against an in-process fake. |
| `JUNO_LIVE=1 pnpm react:live` | The live reaction check: the whole engine on the cached session, reacting in your self-DM through the outbox, then removing and cleaning up. Writes only reactions and two test posts in the self-DM. `-- --probe-get` instead asks `reactions.get` (read-only) for stored messages of every kind. Shapes and codes only (research section 10, "Live reactions"). |
| `pnpm ai:eval` | Runs every AI task on invented examples with the fake provider and prints the outputs. `JUNO_AI=live pnpm ai:eval` uses OpenRouter through pi-ai with `OPENROUTER_API_KEY` (environment or `.env`) and prints outputs, latency and cost; without a key it says so and exits. `pnpm ai:eval routeCheck` runs one task. See `packages/ai/README.md`. |
| `pnpm agent:eval` | Runs the Juno Agent eval cases on the real turn engine with the scripted model and prints the report (CI runs the same through `pnpm test`). `pnpm agent:eval --live` uses OpenRouter with `OPENROUTER_API_KEY` (environment or `.env`), costs money, and saves the report under `packages/agent/eval/reports/`; `--model haiku` picks another family, `--case <id>` one case. See `packages/agent/eval/README.md`. |

`GALLERY_SHOTS_ONLY=Sidebar,Workspace pnpm gallery:shots` refreshes only those components and leaves other shots untouched.

The switcher, key and index tests use `GalleryTestComponent`, declared in `apps/gallery/src/testFixtures.tsx`. It is registered only when the page is opened as `/?test-fixtures#/...`, so it never shows in the normal gallery or the screenshots. The tests serve the built gallery on a port derived from the worktree's path, so two worktrees never share a server; a run reuses a server only if one is already up on its own port. Set `GALLERY_PORT` to choose the port.

Before calling work done: `pnpm affected`, which covers typecheck, lint and the tests the change reaches (see "Affected tests").

Copy `.env.example` to `.env` for local secrets. `.env` is ignored by git.

## Decision log

Add one file per decision under `docs/decisions/log/`, named
`YYYY-MM-DD-HHMM-slug.md` using local IST time and a distinct descriptive slug.
Keep the existing one-line format, for example:

```md
- 10-17 00:55 · orchestrator · Record decisions in separate fragments to avoid merge conflicts.
```

Run `node scripts/decision-log.mjs` and commit both the fragment and generated
`docs/decision-log.md`. Never edit the generated log by hand. Lint checks that it
matches the fragments. The builder sorts newest first, then by filename for ties;
`~` in a reconstructed entry's time stays in its text. The status page reads the
built file. Historical fragments use a numeric prefix in the slug to preserve
their original order when timestamps match.

## Batch merges

Run `pnpm test:repo-tools` for the CLI checks using temporary Git repositories (batch merges and the migration order check).

Fetch `origin/main`, then run from the repository root:

```sh
node scripts/batch-merge.mjs branch-one branch-two
node scripts/batch-merge.mjs --continue batch-1
node scripts/batch-merge.mjs --continue batch-1 --push
```

The script creates `batch-N` from the current `origin/main` in
`.claude/worktrees/batch-N`, pins the input branch tips, and merges them in order.
At a source conflict it prints the branch and files. Resolve and `git add` them
in that worktree, then use `--continue batch-N` from the original worktree. You
can also commit the resolution yourself. An aborted merge must be redone before
continuing. Progress and command output stay in `.juno-status/batches/` in the
original worktree; read `batch-N.log` while checks run.

Generated-file conflicts use a temporary copy of the batch's version. After all
merges, the script installs with `pnpm install --frozen-lockfile`, rebuilds the
decision log, runs `pnpm health:baseline`, and commits generated changes. Review
the baseline diff: regeneration records the merged tree's current health,
including any increases. Then it runs one `pnpm affected --base <base-commit>`
against the pinned `origin/main` commit. A failed command retains the worktree;
fix the cause, commit source fixes, and continue to rerun checks.

Nothing pushes without `--push`. Publishing checks commit messages for attribution
lines, requires clean files and the checked commit, and uses a normal push to
`origin/main`. If main advanced, start a new batch after fetching. A successful
push removes the worktree; the batch branch and logs remain. Continuing a checked
batch reruns checks before publishing.

`--dry-run branch-one branch-two` performs local merges, installation and
regeneration, but only prints the affected plan. Dry-run batches cannot push.
Remove a discarded worktree with `git worktree remove <path>`, then delete its
batch branch with `git branch -D batch-N`. If a process was killed, remove its
`.juno-status/batches/active.lock` only after confirming it has stopped.

## Codebase health

Run `pnpm health` for a summary and the largest clone pairs, files, and functions.
`pnpm lint` runs the same scan with `--check` against `health-baseline.json`.
Knip and jscpd run concurrently; neither uses a cached result. Health scans do not
need the heavy-job lock. Tool errors fail both reporting and lint.

- **Knip** checks unused files, value exports, type exports, dependencies, and unlisted dependencies across all workspaces, scripts, and test entries. `pnpm health:knip` prints every finding. Private package exports are included, so a barrel export with no consumers is a finding even if its implementation is used internally.
- **jscpd** checks `packages/*/src` and `apps/*/src`, including fixtures and CSS. Clones need at least 100 tokens and eight lines. Comments and whitespace do not count as matching tokens. The percentage is duplicated lines divided by scanned source lines. `pnpm health:clones` writes the full clone report.
- **Size** checks tracked and new code files in apps, packages, scripts, and specs, including tests and configs. It reports files over 400 physical lines and functions over 80 lines using the TypeScript parser. Functions include methods, generators, and callbacks, with comments and blank lines inside their span. Nested functions can overlap. `pnpm health:size` prints every result.

`.juno-status/health.json` contains a timestamp, counts, duplication percentage, top offenders, and full Knip and size findings. `complete: false`, a null count, and an `errors` entry mean a tool failed, not that it found zero issues. Each external tool has a 20-second timeout. Raw reports are in `.juno-status/knip-report.json` and `.juno-status/jscpd-report.json`; all reports are gitignored.

Knip exceptions are commented in `knip.config.mjs`. Fontsource dependencies are loaded by CSS `@import`, which Knip does not parse. Babel loads `babel-plugin-react-compiler` by a string in both Vite configs. The default exports of the Knip and electron-vite configs are tool entry points. The icon script resolves Playwright through desktop's manifest with `createRequire`, where it is declared. Exports used inside their own module are omitted because that code is live; unused barrel re-exports remain visible. Playwright's alternate configs, packaging hooks, agent evals and benchmarks, research spike scripts,
and the engine's compile-time body compatibility check are explicit entries. The `tracking`
token group is tagged `@public` because `global.css` reads its emitted CSS variables.
No blanket source exclusion hides unused code.

The baseline caps unused files, exports, types, unused and unlisted dependencies,
clone pairs and cloned lines, and the two size counts. It also lists each oversized
file and function, so removing one does not allow a different oversized item.
Function identities use enclosing names and call labels, with an occurrence number
for otherwise identical callbacks; moving lines or editing a body preserves the id.
Renaming a function or changing a test label may require a reviewed baseline update.
Existing oversized functions are allowed to grow; new functions over 80 lines are not.

On 2026-10-15, five alternating warm runs on the same cleaned Mac worktree took
0.63 s median for the previous lint command (0.54–0.73 s) and 2.86 s with health
(2.59–3.37 s): about 2.23 s added. Every run completed all checks successfully;
Knip and jscpd scanned the source each time. This measures local scan overhead,
not app performance; timings vary with machine load.

To change the baseline deliberately, first run `pnpm health` and inspect the full
reports. Fix false positives with a narrow, explained Knip entry or annotation.
Then run `pnpm health:baseline`, review `git diff -- health-baseline.json`, and commit
it with the change and its reason. This command records current counts and lists,
including improvements. It refuses to record a failed scan. Do not hand-edit counts
to hide a tool failure. `pnpm test:health` checks regression detection and stable
function identities through the shared heavy-job queue.

The engine/agent runner clone remains: neither package may import the other, and
transport implementations do not belong in their schema-only contracts. Sharing it
needs a separate architecture decision. The maintenance pass deliberately leaves
`agent/src/router/*`, composer code, and `apps/desktop/e2e/perf.spec.ts` as
future split candidates (`TopicView.tsx` and `JunoChat.tsx` were split since).

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

Whenever a model provider is set up in Settings › Juno, main also forks the Juno
Agent utility process (`src/main/agent.ts`, built from `src/agent/index.ts` to
`out/main/agent.js`) without the Slack partition, and on every engine `ready` brokers
a port between the agent and the engine's AgentHost server (ADR 0012). With no
provider it does not run. The providers are OpenRouter, with its key in the login
keychain as the generic password `juno-openrouter-key`, and one OpenAI-compatible
endpoint (for example Ollama at `http://localhost:11434/v1`), with its optional key
as `juno-custom-provider-key` and its base URL and the active provider in
`<userData>/juno-provider.json` (`src/main/providers.ts`). `OPENROUTER_API_KEY` in
the environment sets OpenRouter up for development (for example
`OPENROUTER_API_KEY=… pnpm dev`). To start again with no provider, delete both items
(`security delete-generic-password -s juno-openrouter-key`, and the same for
`juno-custom-provider-key`) and the file. Under `JUNO_E2E` the keys are kept in
memory, `JUNO_E2E_OPENROUTER_KEY` sets OpenRouter up at launch (the fixtures'
`agent: true`), and `JUNO_FAKE_OPENROUTER_URL` points the agent at
`startFakeOpenRouter()` from `@juno/agent-testing/openrouter`; `startFakeOpenAi()`
from `@juno/agent-testing/openai` is an endpoint to set up through
`window.juno.agent.setProvider`. The spike scripts behind the agent's design are in
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

`JUNO_LIVE=1 pnpm probe:live` (`scripts/probe-live.ts`) answers questions the smoke does not:
the cost of the M7 recheck, what `conversations.history` and `conversations.replies` return
around threads, the search response, file objects and thumbnail auth, and the notification
prefs. It reuses the cached session, refuses methods outside its own read-only allow-list, starts
calls 1.5 s apart, and honours `Retry-After` once. It prints counts, key censuses and
milliseconds only, and writes redacted shapes to `--out DIR` (a temporary directory by default);
copy a shape into the recorded fixtures by hand and run `node scripts/check-fixtures-redacted.mjs`.
`-- --only search` runs the search part alone (four calls). `-- --only users` asks the edge
`users/info` about every person the newest conversations reference and reads one page of each
users list (about 14 calls). `-- --only emoji` reads every edge `emojis/list` page and prints its key census (about 5 calls). A full run is about 34 calls. The
results are in research section 10, "Live probe".

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
| Sidebar row text contrast, each level in both themes and every accent | `apps/gallery/contrast.spec.ts` | `pnpm test:gallery` |
| No layout shift on hover, press or focus, in every state | `apps/gallery/shift.spec.ts` (helper: `packages/testing`) | `pnpm test:gallery` |
| Topic art: fades on screen, whole when an off-screen row scrolls in | `apps/gallery/topic-art.spec.ts` | `pnpm test:gallery` |
| No focus ring cut off by a scroller or paint containment, tabbing through the main surfaces in light and dark (`GALLERY_RING_ONLY=Sidebar` for one, `*` for every component) | `apps/gallery/focus-ring.spec.ts` | `pnpm test:gallery` |
| Screenshots of every state | `apps/gallery/shots.spec.ts` | `pnpm gallery:shots` |
| Feel: no shift, jump, flicker, empty frame or late feedback, frame by frame, in the built app | `apps/desktop/e2e/feel/*.feel.ts` | `pnpm test:feel` |

Tests that need the Effect test clock use `@effect/vitest`; see the effect skill.

### Single-instance check

The second-launch test in `apps/desktop/e2e/app.spec.ts` starts a normal Electron
child against the first app's user-data directory. It requires exit code 0, a
`second-instance` event in the first app, and the original window remaining usable.
On macOS it also minimizes that window and checks that handover restores it.
The Linux runner uses Xvfb without a window manager, so it does not check minimize.

Do not use `expect(launchApp(...)).rejects` as the handover assertion. Playwright
waits for debugging endpoints and a window, while this process must exit before
opening one. Any launch error would satisfy that assertion, even a crash.
Playwright global setup runs `build-cached` before the desktop tests, including
direct `playwright test` calls and the perf config. Unchanged inputs and output
skip the build. The package scripts do not build a second time. Repeat locally with
`node scripts/heavy.mjs pnpm --filter @juno/desktop exec playwright test e2e/app.spec.ts -g "second launch" --repeat-each=10 --retries=0`.
`pnpm flake` runs remotely. Set `DEBUG=pw:browser` to capture the first app's
process logs. The test attaches the second process's output as `second-launch.log`.
The test allows 90 seconds overall and 30 seconds for the second process to exit.
This checks the development executable, not an installed DMG or Finder launch.

The three Mac failures reported on October 15 used a stale local build. The
first-run branch built at 18:43 UTC, then merged the single-instance lock at
19:03 UTC, and ran Playwright directly without rebuilding. Its earlier main
entry had no lock. Remote runs rebuilt, which explained the different results.
The recorded assertion failed after 4.2–8.9 seconds, before the 30-second test
timeout. Global setup prevents this mismatch after a merge.

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
- **Scenarios.** One `*.feel.ts` file per area: opening topics and what arrives while reading (`topic`), hover, press and popovers (`interaction`), a 300-message thread with late images, the divider, scrolling and reactions (`long`), tab restore (`tabs`), and the Juno tab and panel (`chat`). A scenario that skips fails the run (`e2e/no-skips.ts`) unless it is a placeholder recorded with `recordSkipped`, which adds a `placeholder` annotation. Add a scenario with `feel.run({ name, title, probes, regions, checks }, action)`; mark steps with `rec.mark('press')` so checks can start there.
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

TypeScript 7.0.2 remains installed for the manual `pnpm typecheck:tsc` path and parity comparison. Routine checks use Bun 1.4.3, installed as an exact root devDependency. `pnpm exec bun` resolves the pinned binary; the global Bun install is not used.

`pnpm typecheck` runs `bun check -b` over every project that Bun supports, locally. The checker reads the project inventory and dependency hashes from `scripts/typecheck.mjs`, builds a temporary solution config, and stores passing results separately in the shared system temp folder (`juno-cache/typecheck-bun`). `--no-cache` checks every supported project. Bun has no incremental build cache. Projects with unsupported compiler settings produce one warning naming the project and are skipped; there is no TypeScript fallback. Today all 29 project configs support Bun.

`pnpm typecheck:tsc` is the manual TypeScript-only check. No automatic check, hook, or scheduled run invokes it. `pnpm typecheck:parity` is also manual; it compares Bun and `tsc -b --force`, bypasses result caches, and fails if any project cannot be compared. Neither command is part of routine verification.

`pnpm lint` stays whole: oxlint, the cursor rule, `check-deps` and the fixture check take about 3 s together even on the loaded Mac, and `check-deps` needs the whole package graph to see a bad edge.

## Local Bun checks

`pnpm affected` uses the same local Bun check before starting remote test suites. It checks pending projects with `bun check -b --no-pretty --all`; a type error stops the run before remote suites start. Unsupported configs are warned about and skipped. It never runs TypeScript.

## Affected tests

`pnpm affected` works out which tests the change can reach and runs only those. After local Bun checking passes, each test suite runs on its own Namespace machine at the same time (`--local` runs them one after another through the local root scripts; `--plan` only prints the plan; `--files a,b` plans for given files). The change is every file that differs from the merge base with `main`, committed or not, plus new files. Agents use it while iterating and for their report; full suites run on a schedule against `main` and before a merge when asked.

An import graph over `apps/` and `packages/` decides what each change reaches: relative imports, `@juno/*` through each package's `exports`, and named imports followed through barrel files (`export * from` and `export { } from`) to the module that declares the name. The rules:

| Changed | Runs |
| --- | --- |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the root `package.json`, `tsconfig.base.json`, `scripts/affected.mjs`, `scripts/remote*`, `scripts/heavy.mjs`, `scripts/build-cached.mjs` | everything below, in full |
| A file a vitest file reaches, or a package's `package.json`, `vitest.config.ts` or `tsconfig.json` | those vitest files (`pnpm test --passWithNoTests <files>`) |
| `specs/` (not Markdown) | `pnpm specs:check`, narrowed to `--memory`, `--actions` or `--recovery` when only that agent spec changed; its cache skips checks whose inputs passed before |
| `specs/outbox.qnt`, the conformance generator, or code the replay reaches | `pnpm specs:conformance` |
| A file a component's fixtures reach | `pnpm test:gallery` with `GALLERY_SHIFT_ONLY` set to those components (the behaviour tests run in full) |
| `apps/gallery/` (except `shots.spec.ts`), `packages/tokens/`, `packages/testing/` | `pnpm test:gallery` for every component |
| A file the desktop app or the e2e support reaches (`apps/desktop/src`, `e2e/fixtures.ts`, `e2e/driver/`, the Playwright config) | `pnpm test:desktop` in full |
| Only e2e spec files | `pnpm test:desktop <those files>` |
| Any `.ts`, `.tsx` or config a typecheck project reads | `pnpm typecheck` locally with pinned Bun; unsupported projects are warned about and skipped |
| Anything but Markdown | `pnpm lint`, on the Mac (about 3 s, less than a remote machine's overhead) |
| Documentation only | nothing |

**Results cache.** Each unit test file, gallery component (plus one item for the behaviour tests) and desktop e2e spec file is an item with a key: a hash of every file it reaches, its package and suite configs, and the lockfile. After a step passes, its items' keys are recorded in the system temp folder (`juno-cache/results`), shared by every worktree, whether the step ran here or remotely. An item whose key passed before is skipped and counted in the plan; `--no-cache` runs everything. `specs:check` keeps its own cache per Quint run. A failing step records nothing.

`perf` and `test:feel` never run here, but `pnpm verify:main --with-mac` runs both on the Mac after the other suites; the plan reminds you to run them on the Mac when the renderer or a view changed. The graph errs towards running more: a module imported whole (`import x from`, `import * as`) brings everything it imports. A test whose behaviour depends on a file it does not import (a fixture read from disk, an environment variable) is not seen; the scheduled full run on `main` catches that.

## Remote runs

`pnpm remote <script> [args...]` runs a root script on a Namespace Linux machine of the shape that script needs (see "Machine shapes"; `--machine` or `JUNO_REMOTE_MACHINE` overrides) and streams its output and exit code back. Each run gets its own machine and waits when the shared core cap is full; nothing takes the local heavy-job lock. Use it for `test`, `specs:check`, `test:agent*`, `test:gallery`, `test:desktop` (the desktop e2e alone; it passes arguments on, for example `pnpm remote test:desktop e2e/topic.spec.ts`) and `test:e2e`. `perf` and `test:feel` are refused: they time the Mac. Desktop e2e tests tagged `@mac` (`{ tag: '@mac' }`) depend on macOS behaviour and are skipped on Linux; the Mac runs them. Today that is one test, the sidebar width surviving a relaunch.

- **What is sent.** The files git sees in the worktree (tracked or new, not ignored), so uncommitted work is tested; `.env`, `node_modules`, build output and design images under `docs/` are not. The script stops if a file looks like a key or token file or holds what looks like a real Slack token.
- **Where it runs.** In the image from `scripts/remote/Dockerfile` (Playwright's Ubuntu image with Node 26, pnpm, Java 21, the installed workspace, pinned Bun and Quint's downloads). Its tag is a hash of the Dockerfile, `pnpm-lock.yaml` and `pnpm-workspace.yaml`; when the registry lacks it, the first run builds it with `nsc build` (about two minutes) while others on the same Mac wait. Inside, `scripts/remote/run.sh` links the workspace offline and runs the script under xvfb with more workers than the Mac uses.
- **Results.** Output streams live and is saved as `.remote/<run>/run.log`, including failing test names even if downloading the reports fails. Reports (spec traces, Playwright results and any generated HTML report) land in the same directory. The exit code is the script's own.
- **Warm pool.** After a clean run the machine goes back to a pool kept in the system temp folder (`scripts/remote/pool.mjs`); the next run on this Mac claims it with the image already pulled, which takes a small suite from about 190 s to 19 s. A machine runs one job at a time. The pool keeps at most `JUNO_REMOTE_IDLE_PER_SHAPE` (default 1) idle machines of each shape; a detached pool daemon destroys one after `JUNO_REMOTE_IDLE_MINUTES` (default 1) idle minutes, every machine ends after 3 hours, and after a failure or Ctrl-C the machine is destroyed at once. `pnpm remote --status` lists the pool; `pnpm remote --drain` destroys the idle machines.
- **Admission.** Requests enter a first-come, first-served file queue shared across worktrees. The head request holds available cores until it can start; later small jobs cannot fill those gaps. Job end times are unknown, so the pool does not let jobs pass a blocked head, including warm-machine requests. Queue order survives daemon failure; dead clients are removed. All participating worktrees must use this pool version for daemon-only polling and queue fairness; older clients still use direct admission. Output reports position, requested cores and elapsed wait every ten seconds. Provisioning stays in the client, outside the decision lock, with cores reserved before the daemon grants it. The cap stays at most 24 vCPU; a lower `JUNO_REMOTE_MAX_VCPU` is honored.
- **Recovery.** Creation attempts are recorded before `nsc create`; machines carry pool-owner and attempt labels. The first acquisition starts a shared daemon (an upgrade of the reaper watcher). It owns inventory and admission, polling once five seconds after the previous reconciliation finishes; slow calls never overlap. Clients publish requests in the pool’s `queue/` directory and read their answers without calling Namespace. The daemon exits after six minutes when there are no requests or machines to reconcile. Untracked pool machines get a five-minute grace period; live local owners and pending creates are protected. Known idle cleanup runs under the decision lock before the inventory call, so a failed listing does not prevent that cleanup attempt. Machines labelled for another pool are left alone. Legacy `juno-remote=1` machines without an owner label are reconciled against this Mac's shared state. Failed destroys stay marked `destroying` and are retried. Workspace listings allow 90 seconds per call and three attempts for transient errors; `null` means no instances. During each daemon tick, reconciliation and admission share one snapshot. Newer machine records and pending creates still reserve capacity. If the daemon dies or cannot start, clients use the same durable queue and decision lock in direct mode, sharing successful inventory for up to five seconds and invalidating it before and after creates and destroys. A reservation identifies its request, so recovering an unanswered request cannot allocate it twice. Failed destroys remain recorded for the daemon to verify on its next poll. A transient workspace listing failure pauses acquisition and retries after two seconds; it never treats usage as zero. Timed-out creates get two retries with two- and four-second backoffs. Known partial instances are destroyed first. Ambiguous attempts retain their reservation and attempt label for up to five minutes so reconciliation can destroy late arrivals. Authentication and configuration errors still fail. Exhausted infrastructure failures use exit 255 and `infraFailure` in the log summary.
- **Cap.** Machines in use and idle stay within `JUNO_REMOTE_MAX_VCPU` (default 24 vCPU since 10-16, to hold cost down; the Team plan allows 64). A run waits while the pool is full; after a minute it reports tracked and untracked workspace vCPU. An idle machine of another shape is destroyed to make room.
- **Cost.** Namespace bills vCPU-minutes (about $0.001 each on the Team plan), whatever the shape, so a machine costs its vCPU count times the minutes it is up, idle or not. The cap bounds the spend at about $1.44 an hour with every machine busy. `--keep` leaves a machine available for `nsc ssh <id>` and tracked until its 3-hour expiry; it is neither reused nor drained.
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

## Current cost controls

The defaults are 24 vCPU in the workspace, one idle machine per shape and one
idle minute. `JUNO_REMOTE_MAX_VCPU=0` refuses Namespace runs before an image build.
A request larger than the cap fails instead of waiting forever.
`JUNO_REMOTE_IDLE_MINUTES=0` destroys a machine immediately on release.
These settings never reclaim a machine with a live owner. Releases record their
own idle window. The pool upgrades the old background reaper so its five-minute
policy does not survive a code update; it verifies the reaper command before
sending it a signal.

`pnpm remote:usage [--days 7]` reads `.remote/*/run.log` in all registered worktrees.
It reports counts, failures, cores, CPU busy, median script/startup/wall time,
measured core-minutes and the share of fresh machines. New logs include the
script, arguments, backend, machine shape, result and total wall time. Older
missing values are `?`; coverage counts show which logs support the cost total.
Core-minutes include measured creation, execution, reports and cleanup, but not
pool idle time. See [the cost audit](remote-costs.md) for the day-level machine
inventory and its limits.

Set `JUNO_REMOTE_IMAGE_CACHE=on` to try Namespace's native container image cache,
backed by an 8 GB cache volume for the measured 6 GB image working set. It caches
unpacked layers and downloaded blobs. It is off by default: five alternating
pairs gave 54.7 seconds uncached versus 54.5 seconds with the cache among
successes; the cache arm completed three of five attempts. Cache volumes add
storage charges. The roughly ten-second target was reached only on cache hits.
`--fresh` requests a new machine instead of claiming a warm one, for startup
measurements. Cache misses still pull from the registry. The image is unchanged, so this does not trigger a
new builder. The pool records pending creates as reserved cores and releases its
decision lock before provisioning, allowing independent creates within the cap.

`pnpm remote test:desktop` splits Playwright across four 4x8 machines. Each shard uses three workers and
returns a blob report and the parent merges them into `.remote/shards-*/html`.
A failed shard or missing report fails the parent. `--shards n` changes the split;
`JUNO_REMOTE_DESKTOP_SHARDS=1` or an explicit `--machine` runs one machine.
`test:e2e` runs four 4x8 desktop shards and an 8x16 gallery through their separate remote shapes, within the 24-vCPU cap. The internal `JUNO_REMOTE_SHARDED` marker only prevents recursive sharding; it is not an opt-in switch.
`pnpm flake` keeps its repetition semantics instead of splitting its selected tests.

Namespace stays the default. An optional SSH backend is enabled only by
`JUNO_RUNNER_HOST`. Setup, health checks and a standalone Windows setup prompt are
in [Set up an optional SSH runner](self-hosted-runner.md).

## Hunting a flaky test

`pnpm flake <spec...> [-g <title>] [--repeat 40] [--machines 2] [--workers n]` runs the specs (all under `apps/desktop/e2e` or all under `apps/gallery`) through `pnpm remote` with Playwright's `--repeat-each`, no retries and traces kept on failure. The repeats are split across the machines (at most two, so other agents keep theirs), and each machine runs its usual number of workers, so the tests run under the load of a normal remote run; `--workers` raises it. It ends with one line, `flake: 2 of 160 failed`, and the names of the failing tests. Traces are in `.remote/<run>/`; `pnpm exec playwright show-trace <trace.zip>` opens one.

Package tests under `packages/` use Vitest's `--repeats` with retries off. Their summary counts test cases, each failed if any repetition failed, and states the number of executions per case. For example, `pnpm flake packages/engine/test/sidebar-state.test.ts -g "four people" --repeat 200 --machines 1` runs that case 200 times on one small machine. Every repetition runs its setup and teardown.

```sh
pnpm flake apps/desktop/e2e/sidebar.spec.ts -g "list scrollbar" --repeat 120
pnpm flake apps/gallery/behaviour.spec.ts -g "rewritten Home" --repeat 400 --workers 32
```

Measure the failure rate before a fix and prove the fix with the same count and load. A test that fails a few times in a hundred needs a hundred or more runs to show it. To see what the app was doing when a test failed, add a temporary `console.log` of what the test cannot see in its assertion (what `:hover` matches, which Slack calls arrived) and repeat; the line reporter prints it.

Causes found so far (2026-10-15):

- **A host port started before its listener.** The agent started its Electron port as soon as main handed it over, before the RPC worker attached its message listener. The engine's one-time ready frame could be lost in that gap, leaving `host.hello` waiting forever and both chat tests timing out at agent readiness. The adapter now starts the port only after attaching the listener, so Electron keeps the frame queued.

- **One X display for every worker.** On Linux the workers' windows opened on one Xvfb display, stacked at the same place. When another test's window mapped or closed over one, X sent crossing events at the real pointer, and Chromium moved hover there: hover tests lost the pointer. The e2e fixtures now start an Xvfb per worker (`display` in `apps/desktop/e2e/fixtures.ts`).
- **Work after "Engine live".** Against the fake, every sync cycle ends with a follow pass on the background lane, after the phase is already live. `waitForSync` (through `expectEngineLive`) now also waits for the engine status's `aria-busy` to be false, which it is once the cycle has ended (`EngineStatus.syncing`).

- **launch.json lost on quit.** Main wrote `launch.json` without waiting, and the window's close wrote it again as the app quit, so the process could exit mid-write and the next launch read the defaults: a theme or accent chosen just before quitting was lost about one relaunch in forty. Writes now run one at a time through a temporary file and a rename, and main waits for the last one before it quits (`launchWriter` in `apps/desktop/src/main/launch.ts`).

- **Boxes measured before the web fonts.** A gallery test that compares boxes must wait for the fonts, as `openState` in `apps/gallery/support.ts` does. In a fallback font the Home title is 37 px wider and each meta line 2 px taller.

- **A dropped first value in a live query trigger.** `notifications.status` dropped the first value of the presence stream as if the first run had already read it, but the two start together. When the launch schedule set presence in between, the menu never learned it and "Set yourself away" did nothing visible (103 of 300 runs, 8 workers). A trigger that carries state must not drop its first value.

- **A row drawn at its estimate next to a held row.** When an older page went in above the rows in view, its rows were laid out at their size estimate; the one between the top of the view and the held row grew a frame later and moved what was on screen (the long-thread topic test, 12 of 200). The page's rows above the held row are now laid out in full (`eagerRows` in `containers/topic/scroll.ts`).

- **A scroll set from a script is not the user's.** The topic list lets go of its hold on the bottom on the user's input (wheel, touch, key, pointer). A test that sets `scrollTop` gives no input, so a commit that adds rows before the scroll settles (the rest of the window, just after an open) puts the bottom back. `TopicPane.scrollUp` turns the mouse wheel over the list instead. Install a `scrollend` listener and await that before the wheel turns: the wheel reaches the page by another path than `evaluate`.

- **A source-link jump kept the bottom hold until `scrollend`.** A reply committed before that event pulled the topic back to the bottom. A source jump releases the bottom hold before calling `scrollIntoView`. It lays out the rows around the target before measuring it, then holds the cited row in place. The e2e test defers `scrollend` until a reply is drawn and requires the cited row to stay at exactly the same vertical position.

## Machine shapes

`pnpm remote` picks a cost-conscious shape for each script (`remoteShapes` in `scripts/remote.mjs`). Measured on 2026-10-15 with TypeScript 7; "script" is the time the script itself took, without the minute or so a new machine needs to start and pull the image:

| Script | Shape | Script time | Why not smaller or bigger |
| --- | --- | --- | --- |
| `lint`, `test:agent*` | 2x4 | | small and short; a bigger machine costs more than it saves |
| `test` | 2x4 | 262 s in the current full suite; 156 s on 4x8 | uses less script compute in this pilot but takes longer; see the measurements below |
| `test:gallery`, some components | 4x8 | a few components take under a minute | |
| `test:gallery`, every component | 8x16, including `pnpm affected` | 132–146 s at 78–87% busy; 215 s at 73% on 4x8 | four cores miss three minutes; selected components still use 4x8 |
| `test:desktop` | four 4x8 machines, 3 workers each | 83 / 187 / 112 / 82 s; 37–66% busy; 30.9 script core-min total | reports merge after all shards; explicit `--machine` disables the split |
| `test:e2e` | desktop shards plus gallery shape | depends on both suites | each suite uses its own shape |
| `specs:traces` | 8x16, eight jobs | 132 s at 97% busy; 333 s at 98% on 4x8 | four cores miss three minutes; no Apalache in trace-only runs |
| `specs:check`, nothing cached | 8x16 | 126 s (214 s on 4x8, 82 to 100 s on 16x32) | CPU-bound at 90%; with the cache a run takes seconds on any shape |

Workers follow the core count (`scripts/remote/run.sh`): vitest at least four workers, two unit packages at a time, with the agent timing project run afterwards on 2-core machines, Electron one per two cores, except three workers on each 4-core desktop shard, the gallery three per core, spec simulations one per two cores beside one Apalache server per four, except trace-only runs use one job per core without Apalache. `pnpm remote --shards n` also splits the gallery (each machine takes every n-th state) and the spec check across n machines; it costs about the same and is not the default.

Earlier full-suite pilots on the same prebuilt image (15 October 2026):

| Work | Before: script / busy / core-min | After: script / busy / core-min |
| --- | --- | --- |
| Unit | 4 cores: 156 s / 43% / 10.4 | 2 cores: 262 s / 67% / 8.7 |
| Desktop | 8 cores: 277 s / 56% / 36.9 | two 4-core shards: 272 and 210 s / 42% and 72% / 32.1 total |

The two-core unit run passed in 262 seconds. Desktop shards
passed and their reports merged; five tests were added on main between pilots.
The longest shard is no slower in this pilot, but shared-capacity waits staggered
them: total wall time grew from 738 to about 2,734 seconds. This does not prove
parallel end-to-end wall time. Unit total wall time was 246 seconds before and
303 after. See [the measurement limits and reproduction commands](remote-costs.md).

Historical measurements before the cost controls above: a typical `pnpm affected` run (a view and an engine file changed: typecheck, lint, 90 vitest files, the gallery for one component and the whole desktop e2e), measured on 2026-10-15 with every item run (`--no-cache`):

| | Before: 16x32 for every step | After: shapes above |
| --- | --- | --- |
| Machines | four of 16 vCPU (64 vCPU, the whole cap) | 2 + 4 + 4 + 8 = 18 vCPU |
| Machine time while running | 60 vCPU-minutes (warm machines) | 37 to 38 vCPU-minutes (new machines, including start-up) |
| Idle time afterwards, at most | 4 x 16 vCPU x 10 min = 640 vCPU-minutes | 18 vCPU x 5 min = 90 vCPU-minutes |
| Cost | $0.06 running, up to $0.70 with idle time | $0.04 running, up to $0.13 with idle time |
| Wall time | 289 s | 216 to 273 s |
| Runs at once within the cap | one | three |

Both wall times include waiting for machines, because other worktrees still on 16x32 held the cap; without waiting the new shapes take about 2.4 minutes with new machines (the desktop e2e is the longest step) and less with warm ones.

## Heavy jobs share one queue

Tests, e2e runs, gallery shots, benchmarks and spec checks spawn many processes. Several agents often work in separate worktrees on the same machine, so the root scripts (`pnpm test`, `pnpm test:e2e`, `pnpm test:feel`, `pnpm test:gallery`, `pnpm gallery:shots`, `pnpm specs:check`, `pnpm test:agent-contracts`, `pnpm test:agent-testing`) run through `scripts/heavy.mjs`. It takes a machine-wide lock in the system temp folder, shared by every worktree, and waits for a free slot. There are two slots by default (`JUNO_HEAVY_SLOTS` changes it). On the Mac, `--electron` also takes a single shared app-launch slot. `test:desktop`, `test:e2e`, `test:gallery` and `gallery:shots` use it, so only one of these jobs runs at once. Ordinary jobs can still use both slots, or run beside one app job. An app job waiting for the app-launch slot holds no general slot. Timing runs (`pnpm perf`, `pnpm test:feel`) pass `--exclusive`, which takes every slot and stops new jobs from starting while it waits, so their numbers are not skewed by another run. Running a package's tests directly bypasses the queue, so prefer the root scripts. `pnpm test:health` and `pnpm test:remote-pool` skip the queue: they are small Node tests that should not wait behind perf or package runs.


## Releasing

The release target is macOS Apple Silicon. `pnpm package` builds the app, rebuilds
native dependencies for Electron, and writes the DMG, ZIP, block maps and
update metadata (when a feed is configured) to `apps/desktop/release/`. It never
publishes. Developer ID signing and notarization require the explicit `JUNO_RELEASE=1` switch; without it,
the build prints one unsigned-build line and disables identity discovery.
On Apple Silicon, electron-builder repairs the local **ad-hoc** signature after
flipping fuses. This uses no certificate or credentials and does not grant
Gatekeeper trust. A literally unsigned ARM64 executable is killed by macOS;
"unsigned" here means without Developer ID signing or notarization.

The engine and agent use Electron's built-in `node:sqlite`, so there is no SQLite
addon to rebuild. `npmRebuild` is enabled for future native dependencies; `.node`
files and koffi are explicitly unpacked. Only `electron-updater` and its runtime
dependencies ship as node_modules; application dependencies are bundled by Vite.
Source maps are excluded. Codex uses the separately installed `codex` executable;
its unused vendor binaries do not ship. Keep the ZIP: macOS auto-update needs it.

### What the owner provides

- A **Developer ID Application** certificate with its private key, exported as a
  password-protected `.p12`. Set `CSC_LINK` to its path locally or its base64
  contents in CI, and `CSC_KEY_PASSWORD` to the export password. An already
  installed identity can instead be selected locally with `CSC_NAME`.
- The Apple Developer **Team ID** (`APPLE_TEAM_ID`).
- Either `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD`, or an App Store Connect
  team API key: `APPLE_API_KEY` (absolute path to its `.p8`), `APPLE_API_KEY_ID`
  and `APPLE_API_ISSUER`. In Actions, store the file as the
  `APPLE_API_KEY_BASE64` secret; the workflow writes it to a temporary file and
  deletes it after the build. Supply one authentication method at a time.
- A public update feed URL, supplied at build time as `JUNO_UPDATE_FEED_URL`
  (Actions variable `UPDATE_FEED_URL`). For GitHub Releases, use
  `https://github.com/<owner>/<repo>/releases/latest/download`. There is no default
  repository or feed. Without a feed, updates remain unavailable.
- A release destination (`RELEASE_REPOSITORY=owner/repo` in Actions) and a GitHub
  token with **Contents: write** access to it (`RELEASE_GITHUB_TOKEN`). A local
  upload uses `GH_TOKEN`. The workflow can use its scoped `github.token` when
  publishing to its own repository. Without a destination, CI only uploads
  Actions artifacts. The installed app contains no GitHub token; update assets
  must be publicly readable.

Keep all credentials in the environment or repository Actions secrets. Never
commit certificates, keys, passwords or tokens. No secrets are needed for PR
lint/typecheck. Heavy checks run through `pnpm affected` on Namespace.

### Steps

1. Install Node 26, pnpm 12.11.2 and Xcode (including its command-line tools).
   Run `pnpm install --frozen-lockfile` and `pnpm affected`.
2. Set the desktop version in `apps/desktop/package.json`. Build and smoke the
   local package with `pnpm package` and `pnpm test:package`. The smoke launches
   the executable directly, signs in to fake Slack, waits for sidebar rows,
   starts the agent against fake OpenRouter, and relaunches the cached account.
   It uses temporary data and never reads a real Slack session. Without a Developer
   ID signature, it applies `codesign -s -` locally and verifies the result. It
   measures five cached-account launches from process spawn to the renderer's
   first sidebar-row paint marker, reporting median and range. These are warm
   filesystem-cache runs with CDP attached, not a cold-disk benchmark.
3. For a local signed release, provide the variables above (including the public
   feed URL), then run
   `JUNO_RELEASE=1 pnpm package`. electron-builder uses `notarytool` and staples
   the ticket. Partial release credentials fail the build. Verify with
   `codesign --verify --deep --strict apps/desktop/release/mac-arm64/Juno.app`
   and `xcrun stapler validate apps/desktop/release/mac-arm64/Juno.app`, then
   run `pnpm test:package` again.
4. For CI, configure those repository secrets, commit the version, and create
   and push the matching `v<version>` tag. `.github/workflows/release.yml` runs
   on `macos-26`. Complete credentials enable signing and notarization;
   otherwise it builds unsigned artifacts. It uploads artifacts to a **draft**
   GitHub release in the configured distribution repository and will not modify
   an already published release. In a separate distribution repository, GitHub
   creates the version tag there; the build still comes from the source tag.
5. Review the artifacts and signing/notarization results before publishing the
   draft. Never publish the unsigned fallback as an update. On another Mac,
   install the prior signed build, opt into updates in Settings › About,
   publish the newer signed release, and check **Restart to update**. This
   cross-version signature and installation check requires the owner's ID and
   cannot be verified by the unsigned smoke.

Updates are off by default and unavailable without a configured feed, in
development, and in tests. An enabled install checks 30 seconds after launch and every six hours, quietly downloads,
and shows a single ready line in Settings › About. Closing the app does not
install the update; only **Restart to update** does. Turning the setting off
cancels a download and suppresses the ready line. Errors retry quietly later.

The hardened runtime entitlements grant JIT for Electron's V8 and network client
access. There is no application sandbox entitlement or disabled library
validation. No shared keychain access group is used today: secrets use
Electron `safeStorage` and generic login-keychain items through
`/usr/bin/security`. Adding a Team-ID-prefixed sharing group would not describe
those existing items, so the entitlement deliberately has none.

The six configured fuses turn RunAsNode, NODE_OPTIONS and Node CLI inspection
off, and cookie encryption, embedded asar integrity validation and asar-only
loading on. Engine and agent use `utilityProcess.fork`, not Electron-as-Node.
The Codex child is a separate native executable. Development wrappers that
strip `ELECTRON_RUN_AS_NODE` remain useful with the unmodified development
Electron. Playwright's Electron launcher needs Node inspection and cannot drive
the hardened package; the packaged smoke instead uses Chromium CDP. The
`JUNO_E2E` fake-server seams remain available independently of the Node fuses.

### Engine and sync benchmarks

`pnpm bench:engine` runs `packages/engine/test/bench` with one worker and serial files, through the exclusive machine lock. `pnpm bench:sync` runs the read-only sync harness against the large fake seed with production pacing; it never opens a real session and fails if it cannot reach `live` within an hour. Both can run through `pnpm remote` on a dedicated 4x8 Linux machine. Compare runs on the same shape; renderer performance budgets still run on the Mac. The fake's normal engine tests disable pacing, so their boot time does not measure the request budget.

## StyleX token check

`pnpm lint` runs `node scripts/check-tokens.mjs` over `packages/ui`,
`packages/views` and the desktop renderer. It parses StyleX `create` calls,
including aliased imports and nested conditions. Raw CSS colours, px/rem/em
lengths (also inside templates and calc), and numeric length properties fail.
Zero, percentages, unitless values, token references and 1px border/outline
hairlines pass. Named component constants and runtime style parameters are
not evaluated. For a real geometry exception, put `// tokens-allow: reason`
after the declaration on the same line; an empty reason does not pass.
Run the rule tests with `node --test scripts/check-tokens.test.mjs`.

Measured on the shared Mac (2026-10-15), the token check alone took 0.36 s
median (0.35–0.50 s, five successful runs including Node startup). Five
alternating full lint runs with and without the check took 3.59 s
(3.42–4.88 s) and 3.85 s (3.11–4.95 s) respectively. Other worktrees were
active, so that full-lint difference is noise; budget about 0.36 s extra
for parsing the StyleX source files, not a lint speedup.

## Delayed-load layout checks

At `d0876483`, all 18 cases passed in 38.5 seconds on one `linux/amd64:4x8` remote runner with two workers. This is test time, excluding allocation, image pull and build. Use `pnpm remote --machine linux/amd64:4x8 test:desktop layout-shift.spec.ts` for the same runner size.

`pnpm remote test:desktop layout-shift.spec.ts` runs the desktop shift checks against fake Slack. They are ordinary desktop e2e tests, so `pnpm affected` includes them whenever renderer inputs change. No Mac timing or filmstrip recording is required.

`expectStableAnchor` in `apps/desktop/e2e/shiftProbe.ts` samples a retained DOM anchor's screen coordinates every animation frame and asserts exactly zero movement. It also requires Chromium's Layout Shift observer and rejects entries without recent input. The anchor check includes the recent-input interval, which otherwise hides jumps for 500 ms. Start it before releasing delayed data, and wait for the resulting UI inside its action. A missing anchor fails.

Use `fake.holdNext({ method, reason: 'open' })`, assert the call is held, then `fake.release({ method })` to exercise partial caches. Use silent fake posts followed by one socket message to reproduce history missing above the latest message. Do not substitute a settled gallery fixture for this case. Repeat with `pnpm flake apps/desktop/e2e/layout-shift.spec.ts --repeat 20 --machines 1`. Keep `JUNO_REMOTE_MAX_VCPU` at 24 or lower.

## Scheduled full run

`pnpm verify:main` runs every suite against `main` (`--ref <ref>` for another): it checks the ref out into a temporary detached worktree, so nothing local is sent, and runs `test`, `specs:check` with no cache (every Quint run), `test:gallery` and `test:desktop` through `pnpm remote` at the same time. It writes a summary to `.juno-status/verify-main.md` and `.json` (each suite's result, time, log and the failing tests it names) and the full logs to `.juno-status/verify-main/<run>/`, and exits 1 if a suite failed. `--with-mac` also runs the e2e tests tagged `@mac` on this Mac, which takes a heavy-job slot. `perf` and `test:feel` are not part of it. The first run (2026-10-15) passed in 170 s of wall time: `test` 170 s, `specs:check` 146 s, `test:gallery` 74 s, `test:desktop` 114 s.
