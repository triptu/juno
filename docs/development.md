# Development

How to build and run Juno, and how the repo is put together.

## Prerequisites

- Node 24 or newer (Node 26 is what this was built with).
- pnpm 12. Node 25+ has no Corepack, so install it directly: `npm i -g pnpm@12`.
- macOS for the window chrome and e2e tests. Nothing else is platform-specific yet.
- Google Chrome, for the gallery tests and screenshots.
- Git LFS (`brew install git-lfs`, then `git lfs install` once), for the images and videos under `docs/`.

No Playwright browser download is needed for the desktop e2e tests. Electron is the browser. The
gallery projects use the installed Google Chrome (`channel: 'chrome'`); set
`GALLERY_BROWSER=chromium` after `npx playwright install chromium` to use Playwright's own build.

### Git LFS

Images and videos under `docs/` (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.mp4`, `.webm`, `.mov`) are stored in Git LFS, as `.gitattributes` lists. They were about 240 MB of the 265 MB checkout on 10-18, and they made most of the repo's growth. Nothing the app, the tests or CI reads is under `docs/`, so a checkout without LFS gets pointer files there and still builds and tests. The app icon in `apps/desktop/build` stays a normal file.

- `git lfs install` adds the `pre-push` hook that uploads new images. Without it, a push leaves pointers on GitHub with nothing behind them. Worktrees share their clone's hooks, so once per clone is enough.
- `pnpm lint` runs `scripts/check-lfs.mjs`, which fails when a file under `docs/` that should be in LFS is stored as the file itself. It also warns when the clone has no LFS `pre-push` hook.
- To clone without the images: `GIT_LFS_SKIP_SMUDGE=1 git clone ...`, then `git lfs pull --include="docs/design/home/**"` for the ones you need.

**A branch from before the move.** A branch that added or changed images before docs moved to LFS (10-18) stores them as normal files. After it merges or rebases onto main, `git status` lists those images as modified and `check-lfs` fails. Run `git add --renormalize docs` and commit; nothing in the images changes. A conflict on an image means both sides changed it: keep the branch's version with `git checkout --theirs <path>` during a merge (`--ours` during a rebase), then renormalize.

**History is not rewritten yet.** History from before 10-18 still holds the images as normal files, so a full clone still downloads them once (about 220 MB). A shallow clone (`--depth 1`) does not. A rewrite (`git lfs migrate import --everything` over the same patterns, then a force-push of main) is planned for a time when no other work is happening, because it changes every commit hash: every clone, worktree and open branch has to move to the new history. Before it runs, merge or close every open branch and stop every agent. Afterwards, re-clone, or `git fetch` and `git reset --hard origin/main` in each checkout, then delete the old worktrees.

## Commands

Run these from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs everything, linking packages from pnpm's global virtual store (see "Worktrees and installs"). |
| `pnpm dev` | Starts electron-vite with HMR for the renderer and reload for main and preload. |
| `pnpm build` | Builds main, preload and renderer into `apps/desktop/out/`, then checks the renderer bundle size. |
| `pnpm typecheck` | Fast local check of all Bun-compatible projects with the pinned Bun; see "Typecheck". |
| `pnpm typecheck:tsc` | Manual TypeScript check of every project. |
| `pnpm typecheck:parity` | Manual comparison of Bun and TypeScript diagnostics across projects; bypasses result caches. |
| `pnpm lint` | Runs oxlint, cursor and token checks, dependency and fixture checks, and the health ratchet, all at once (`scripts/lint.mjs`; see "Typecheck"). |
| `pnpm check-deps` | The package graph and the import rules in `docs/architecture.md` section 3. Part of `pnpm lint`; run it alone for a quicker loop. |
| `pnpm health` | Reports unused code and dependencies, duplication, and large files and functions. Writes `.juno-status/health.json`. |
| `pnpm test` | Runs every package's vitest suite (`packages/*/test` and `apps/desktop/test`). |
| `pnpm test:e2e` | Builds, runs the Playwright tests against the built app, then the gallery behaviour tests. |
| `pnpm perf` | Builds and runs the perf scenarios (`apps/desktop/e2e/perf.spec.ts`, config `playwright.perf.config.ts`), which fail over the budgets in `docs/performance.md`. A scenario that did not run, because its group's setup or an earlier scenario failed, fails the run too (`e2e/no-skips.ts`). `-g "<name>"` runs some of them; `JUNO_PERF_TRACE=<dir>` also writes traces for `scripts/perf-trace.mjs`. Passing `--reporter` replaces that check, so do not. |
| `pnpm test:gallery` | Builds the gallery and runs only its behaviour tests (mouse-down activation, cursor rule, state switcher, layout-shift guard). |
| `pnpm test:feel` | Builds, then records the feel suite against the fake Slack: slow-motion videos, filmstrips and frame checks in `apps/desktop/feel-report/`. See "The feel suite". |
| `pnpm gallery` | Starts the fixture gallery at http://localhost:4174 (browser only, no Electron). |
| `pnpm gallery:shots` | Builds the gallery and screenshots every state in light and dark into `apps/gallery/shots/<Component>/<group>/<state>-<theme>.png`. |
| `pnpm specs:check` | Checks every Quint spec in `specs/`, including the broken and corrected pairs for Juno Agent. Runs simulations three at a time, the Apalache checks on one shared server, and skips checks that passed before with the same inputs (see "Faster test runs"). `--memory`, `--actions` or `--recovery` selects one agent spec. See `specs/README.md`. |
| `pnpm specs:conformance` | Generates Quint traces of `specs/outbox.qnt` and replays them against the engine and the fake Slack (`specs/README.md`, "Conformance"). About 30 s on a remote machine when its traces are cached. |
| `pnpm remote <script>` | Runs a Linux-safe root script (`test`, `specs:check`, `specs:conformance`, `test:agent*`, `test:gallery`, `test:e2e`) on a fresh Namespace machine and streams the output. `--dry-run` shows what would be sent and run. See ADR 0013. |
| `pnpm flake <spec>` | Repeats desktop e2e, gallery or package tests many times on remote machines (`-g <title>`, `--repeat 40`, `--machines 1\|2`, `--workers n`) and reports how many runs failed, with traces of the failures. See "Hunting a flaky test". |
| `pnpm test:agent-contracts` | Runs the `agent-cards` and `agent-contract` property tests: card identities, digests, retries, the RPC codecs and the chat projection. |
| `pnpm --filter @juno/agent-memory test` | Runs the pure memory rules' property tests. Its script takes the heavy-job lock itself. |
| `pnpm --filter @juno/engine test` | Runs one package's suite (here the engine's: the port protocol over an in-memory MessageChannel, live query serving). |
| `node scripts/build-icons.mjs` | Rebuilds `apps/desktop/build/icon.icns` and `icon.png` from `assets/icon.svg`. See "App icon". |
| `pnpm package` | Builds an unsigned DMG with electron-builder into `apps/desktop/release/`; signed builds also make a ZIP for in-place updates. The tag workflow builds these too; see "Releasing". |
| `JUNO_LIVE=1 pnpm smoke:live` | The read-only live smoke against your real workspace (see "Sign-in and the live smoke"). `pnpm smoke:live -- --fake` runs the same script against an in-process fake. |
| `JUNO_LIVE=1 pnpm presence:live` | The live presence check (`scripts/presence-live.ts`): polls `users.getPresence` for you while Juno's socket is closed, open, tickling every 19 s, then idle, and prints presence values and seconds. Sends only `ping` and `tickle`. Research section 3, Presence. |
| `JUNO_LIVE=1 pnpm sync:live` | The read-only sync dry run: the real `@juno/sync` cold boot against your workspace into a temporary directory, numbers only (see "The live sync dry run"). `pnpm sync:live -- --fake` runs it against an in-process fake. |
| `JUNO_LIVE=1 node --import ./scripts/ts-resolve-hooks.mjs scripts/idle-live.ts` | The live idle check: the whole engine on the cached session, read-only as the timeline below, synced into `--dir` (kept, so a second run is a relaunch on the same cache) or a temporary folder, then left alone. Once no call has been made for 30 s it prints the share of one core every 10 s over `--idle` seconds (180 by default), the calls and the SQL statements run meanwhile (Juno's SQL text, never a value); `--profile DIR` writes a CPU profile of that window, `--fake-ai` runs the AI jobs on the engine's fake model, `--fake` uses the large fake seed. See performance.md 8.12. |
| `JUNO_LIVE=1 pnpm sync:timeline` | The first sync timeline (`scripts/first-sync-live.ts`): the whole engine signed in from an empty data folder on the cached session, read-only (every write refused before it leaves, no AI key). Prints when the sidebar, Home and every conversation first show, when unread counts settle (all, and those of unread DMs and mentions), where each kind of conversation fell in the history order, history ends and the sync ends; Slack calls by method with retries, 429s and `Retry-After`; CPU and SQLite time. `--out FILE` writes the timeline as JSON (method names, counts and times only). `-- --fake` runs it on the large fake seed with the app's pacing, `--fake --small` on 16 conversations. See performance.md, "First sync timeline". |
| `JUNO_LIVE=1 pnpm react:live` | The live reaction check: the whole engine on the cached session, reacting in your self-DM through the outbox, then removing and cleaning up. Writes only reactions and two test posts in the self-DM. `-- --probe-get` instead asks `reactions.get` (read-only) for stored messages of every kind. Shapes and codes only (research section 10, "Live reactions"). |
| `JUNO_LIVE=1 pnpm huddle:live` | The huddle spike (`docs/plans/huddles.md`, phase 2): joins a huddle in the private test channel `juno-huddle-test` on the cached session with `rooms.join`, runs the answer through the Chime SDK in a local Chromium page with a fake microphone, prints a status line every 10 s for `--minutes N` (default 5), and always sends `rooms.leave`. `--create-only` finds or creates the channel and exits; `--socket` also prints room frames from the socket; `--headed` shows the window so you can hear the huddle. Writes only that channel's create, join and leave. Field names, codes and counts only. `-- --fake` stops after `rooms.join`. |
| `JUNO_LIVE=1 node --import ./scripts/ts-resolve-hooks.mjs scripts/dnd-live.ts` | Reads Slack's notification schedule (the `dnd_*` prefs) on the cached session and prints it. `--apply` writes Juno's notification hours into it once (`--days 1,2,3,4,5 --from 540 --to 1140`, defaults otherwise) and reads them back; `--restore '<json>'` writes a printed schedule back. Calls only `users.prefs.get` and `users.prefs.set`, and writes only schedule prefs. Your own account only (research section 7, "Live write"). |
| `pnpm ai:eval` | Runs every AI task on invented examples with the fake provider and prints the outputs. `JUNO_AI=live pnpm ai:eval` uses OpenRouter through pi-ai with `OPENROUTER_API_KEY` (environment or `.env`) and prints outputs, latency and cost; without a key it says so and exits. `pnpm ai:eval routeCheck` runs one task. See `packages/ai/README.md`. |
| `pnpm agent:eval` | Runs the Juno Agent eval cases on the real turn engine with the scripted model and prints the report (CI runs the same through `pnpm test`). `pnpm agent:eval --live` uses OpenRouter with `OPENROUTER_API_KEY` (environment or `.env`), costs money, and saves the report under `packages/agent/eval/reports/`; `--model haiku` picks another family, `--case <id>` one case. See `packages/agent/eval/README.md`. |

`GALLERY_SHOTS_ONLY=Sidebar,Workspace pnpm gallery:shots` refreshes only those components and leaves other shots untouched. Add `GALLERY_SHOTS_ACCENT=teal` to shoot them in another accent as `<state>-<theme>-teal.png`, beside the default accent's shots.

The switcher, key and index tests use `GalleryTestComponent`, declared in `apps/gallery/src/testFixtures.tsx`. It is registered only when the page is opened as `/?test-fixtures#/...`, so it never shows in the normal gallery or the screenshots. The tests serve the built gallery on a port derived from the worktree's path, so two worktrees never share a server; a run reuses a server only if one is already up on its own port. Set `GALLERY_PORT` to choose the port.

Before calling work done: `pnpm affected`, which covers typecheck, lint and the tests the change reaches (see "Affected tests").

Copy `.env.example` to `.env` for local secrets. `.env` is ignored by git.

## Worktrees and installs

Agents work in their own git worktrees. Create and remove them with the helper:

```sh
node scripts/worktree.mjs add <name> [--base <ref>] [--branch <branch>] [--detach <ref>] [--no-install]
node scripts/worktree.mjs remove <name-or-path> [--force] [--delete-branch]
```

`add` checks out `<branch>` (default `<name>`; an existing branch is reused, a new one starts at `--base`, default `origin/main`; `--detach <ref>` checks out a commit with no branch, as for a DMG build), runs `pnpm install --frozen-lockfile` and prints the path. Worktrees go in `/Volumes/AgentWork/worktrees/juno/` when that volume is mounted (file event logging and Spotlight are off there), else in `.claude/worktrees/`. `scripts/worktree-folder.mjs` decides the folder (the volume counts as mounted when `/Volumes/AgentWork/.fseventsd/no_log` exists) and is shared by the helper, `batch-merge.mjs` and packaging; `JUNO_WORKTREE_DIR` overrides it. Older worktrees under `.claude/worktrees/` stay until their branches merge. The helper writes `.metadata_never_index` into that folder so Spotlight skips it, and waits to install while the load average is above 8. `remove` removes the worktree and, with `--delete-branch`, deletes its branch if it is merged.

**The global virtual store.** `pnpm-workspace.yaml` sets `virtualStoreType: global`. Each package is written once into the store's `links` folder (`pnpm store path`, then `links/`), keyed by its version and its dependencies, and a project's `node_modules` holds only symlinks into it. Before, every worktree had its own `node_modules/.pnpm` with about 50,000 entries; creating and deleting those flooded macOS's `fseventsd` (about 260% CPU on 10-17) and froze the Mac. Measured on 10-17 (warm store, one install at a time):

| Setup | Entries in the worktree's `node_modules` | Install | Remove worktree |
| --- | --- | --- | --- |
| Per-worktree `.pnpm`, main disk | 49,515–50,100 | 3.0–4.2 s | 4.2–7.7 s |
| Per-worktree `.pnpm`, AgentWork volume | 49,514 | 2.6–3.0 s | 3.3 s |
| Global virtual store, main disk | 1,045 | 0.5–0.9 s | 0.5 s |
| Global virtual store, AgentWork volume | 1,045 | 0.3 s (34 s with an empty store) | 0.4 s |

Removing a worktree with no install takes 0.4 s. A worktree on the AgentWork volume uses a store on that volume (`/Volumes/AgentWork/.pnpm-store`), because pnpm keeps the store on the same volume as the project; the main checkout keeps using `~/Library/pnpm/store`. An existing worktree switches to the shared store on its next `pnpm install`, which removes its old `.pnpm` folder.

What changes with it:

- **A package resolves only what it declares.** Inside the store, a package sees its own dependencies and peers, not the workspace's hoisted packages. Three packages broke: `@phosphor-icons/react` imports React's types without depending on `@types/react`, Playwright's Electron API imports `electron`, and Quint's Apalache client requires `protobufjs` and `semver`. `packageExtensions` in `pnpm-workspace.yaml` declares them. Scripts run through `pnpm` get `NODE_PATH` and a resolve hook from pnpm that hide such gaps, but plain `node` (the remote image's Quint warm-up, for one) does not, so add a line there when something fails only because a dependency cannot see a package it does not declare.
- **Electron's binary is shared.** Electron 44 has no install script: the first `require('electron')` downloads and unpacks it (about 600 files, 300 MB) next to the package. With the shared store that happens once per Electron version, not once per worktree. Two versions live in separate store folders.
- **Packaging uses `pnpm deploy`.** electron-builder cannot find the dependencies of dependencies in the shared store (`pnpm list` reports paths that do not exist). `apps/desktop/build/package.cjs` first deploys the app's production dependencies as real files into a temporary folder and packages from there. That folder is under `/Volumes/AgentWork/tmp` when the volume is mounted, else in the system temp folder. electron-builder's native rebuild then writes only into that copy, never into the shared store. `files` in `apps/desktop/package.json` limits the deploy to `out/`.
- **The app under test gets neither.** pnpm passes that `NODE_PATH` and resolve hook to everything it runs, Electron included. The e2e fixture (`apps/desktop/e2e/fixtures.ts`) drops both, as the packaged app has neither; with them, a Home send to a DM did not arrive in one e2e test.
- **Remote runs** install in their image the same way.

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

The script creates `batch-N` from the current `origin/main` in the worktree
folder (`/Volumes/AgentWork/worktrees/juno/batch-N` when that volume is
mounted, else `.claude/worktrees/batch-N`; see "Worktrees and installs"), pins the input branch tips, and merges them in order.
At a source conflict it prints the branch and files. Resolve and `git add` them
in that worktree, then use `--continue batch-N` from the original worktree. You
can also commit the resolution yourself. An aborted merge must be redone before
continuing. Progress and command output stay in `.juno-status/batches/` in the
original worktree; read `batch-N.log` while checks run.

Generated-file conflicts use a temporary copy of the batch's version. After all
merges, the script installs with `pnpm install --frozen-lockfile`, rebuilds the
decision log, runs `pnpm health:baseline`, and commits generated changes. Review
the baseline diff: regeneration records the merged tree's current health,
including any increases. Then it runs `pnpm typecheck`, `pnpm lint` and
`pnpm affected --batch --base <batch base>`: the unit test files the merged
change reaches, plus `specs:check` and `specs:conformance` when the code the
specs model changed ("Affected tests"), on one machine. Files that passed with
the same inputs, in an agent's run or an earlier batch, are skipped through the
shared results cache. The full suites run on main afterwards (see "Testing").
When Namespace is down, `--local` runs those steps on this Mac instead, through
the machine lock. A failed command retains the worktree;
fix the cause, commit source fixes, and continue to rerun checks.

Nothing pushes without `--push`. Publishing checks commit messages for attribution
lines, requires clean files and the checked commit, and uses a normal push to
`origin/main`. If main advanced, start a new batch after fetching. A successful
push removes the worktree; the batch branch and logs remain. Continuing a checked
batch reruns checks before publishing.

`--dry-run branch-one branch-two` performs local merges, installation and
regeneration, but runs no checks. Dry-run batches cannot push.
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

`.juno-status/health.json` contains a timestamp, counts, duplication percentage, top offenders, and full Knip and size findings. `complete: false`, a null count, and an `errors` entry mean a tool failed, not that it found zero issues. Each external tool (`scripts/health-run.mjs`) gets 20 s on an idle machine, scaled by the one-minute load per core (at a load of 16 on 8 cores it gets 40 s) and capped at 120 s. A tool that runs out of time is tried once more with twice the limit. If it times out again, its `errors` entry has `timedOut: true` and lint says the tools timed out and no finding was checked: run `pnpm lint` again when the machine is less busy. It still fails, because nothing was checked. Raw reports are in `.juno-status/knip-report.json` and `.juno-status/jscpd-report.json`; all reports are gitignored.

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
  "Slack Safe Storage" keychain item (the `security` tool makes the request,
  so the prompt names `security`, not Juno). "Allow" is enough: main keeps the
  password in memory until Juno quits or signs out, so pressing the button
  again in the same run does not ask again. The copies are deleted afterwards
  and the password is never written anywhere.

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
`-- --only files` checks the newest self-DM image via an exact history re-read, probes `files.info`, and compares thumbnail GETs with and without the cookie. It prints booleans and statuses and writes no shapes. `-- --only search` runs the search part alone (four calls). `-- --only users` asks the edge
`users/info` about every person the newest conversations reference and reads one page of each
users list (about 14 calls). `-- --only emoji` reads every edge `emojis/list` page and prints its key census (about 5 calls). A full run is about 34 calls. The
results are in research section 10, "Live probe".

### Keychain prompts

Goal: at most one macOS prompt on a first run. Every keychain access from
launch through the first sign-in and sync, in order:

1. **`providers.load()` at launch** reads `juno-openrouter-key` and
   `juno-custom-provider-key` with `security find-generic-password -w`. No
   prompt: on a first run the items do not exist, and once they do, `security`
   created them, so it is on their access list. This does not depend on Juno's
   signature.
2. **`requestSecrets` at engine start** reads `secrets.bin`. On a first run
   there is no file, so `safeStorage` is not called.
3. **The `persist:slack` cookie store** is encrypted (the cookie encryption
   fuse is on) with "Juno Safe Storage", the same item `safeStorage` uses.
   Chromium creates it the first time it needs it. Creating an item never
   prompts, and the app that created it reads it without a prompt.
4. **Use the Slack app's session**: `security find-generic-password` without
   `-w` checks which Slack items exist (attributes only, no prompt), then one
   `-w` read of Slack's item. **This is the one prompt**: Slack created the
   item, so macOS always asks before another program reads it. For the App
   Store build, when that password does not unlock the cookie and another
   Slack item exists, the import stops and says "Use the Slack app's session
   again to try the next one" rather than asking a second time in one press.
   A password macOS gave is reused, without a read, by later imports in the
   same run; a refusal is not, so pressing the button again asks again.
5. **The import writes the `d` cookie** into `persist:slack`, and after
   `auth.test` main writes `secrets.bin` with `safeStorage.encryptString`.
   Both use "Juno Safe Storage" from step 3, so no prompt.
6. **Sign in to Slack** (the window) reads no Slack item; its cookies go
   through step 3's item.
7. **MCP credentials** (`juno-mcp`) and **backup secrets** (`juno-backup`) are
   read only when the agent asks, after a provider is set up. Like step 1,
   `security` created them, so there is no prompt.

Checked on 10-17 with an unsigned package of `bb4fcb71` and a fresh user-data folder, while a "Juno Safe Storage" item from a 10-15 build was in the login keychain: launch to the sign-in screen showed no prompt. The import's prompts (steps 4 and 5) need someone at the Mac and were not counted.

**Who reads "Juno Safe Storage".** Only main, once per launch. Chromium keeps
the key in memory and hands it to the network service (cookies) over IPC; the
helpers, the engine and the agent never read the keychain. Measured on 10-18
with an unsigned package of `391da5cc`, a test keychain holding a dummy
"Juno Safe Storage" item first in the search list, and securityd's
`integrity` log (`log stream --level debug --predicate 'process ==
"securityd" AND category == "integrity"'`), which names each reader by
cdhash: a launch with an encrypted `secrets.bin` read it once, from
`Juno.app`; a fake-Slack sign-in and a signed-in relaunch (cookies decrypted,
sync running) each read it once, from `Juno.app`. The cookie encryption fuse
adds no reader, and turning it off would leave the `d` cookie in plain text on
disk without removing the prompt, since `safeStorage` reads the same item.

**Why updates prompt.** macOS checks two things before an app reads an item:
the item's access list (the app's designated requirement) and its partition
list (an id securityd gives the app). Without Developer ID both change with
every build:

- An ad-hoc designated requirement is `cdhash H"…"`, a hash of that build.
- The partition id is `teamid:<team>` only for Apple-issued Developer ID,
  Mac Development, Mac Distribution and App Store signatures. Every other
  signed app, a self-signed certificate included, gets `cdhash:<hash>`
  (`partitionIdForProcess` in Apple's `securityd/src/clientid.cpp`).

So the first launch after an update fails both checks on main's one read. The
macOS dialog asks for the login keychain password. **Always Allow** adds the new
build to both lists: one prompt, and none on later launches of that build.
**Allow** passes the access list once, then securityd asks again for the
partition list, so two prompts on every launch until Always Allow is chosen.
This is how one update produced three or four prompts. (Read from Apple's
source, not counted with someone at the Mac.)

A stable self-signed identity does not help. Checked on 10-18 on a
partition-capable test keychain: two builds signed with the same self-signed
certificate shared a designated requirement (`identifier "…" and
certificate root = H"…"`) and passed the access list, but the second build
failed the partition list (`ACL partition mismatch: client cdhash:…`). A
Developer ID signature (or an Apple Development one) gets `teamid:` and a
designated requirement anchored to Apple and the team, so access survives
updates and these prompts stop.

The Slack item prompt in step 4 is for `security`, not Juno, so signing does
not change it; it appears once per run that imports.

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
| Mouse-down activation, state switcher, in a real browser | `apps/gallery/activation.spec.ts`, `apps/gallery/behaviour.spec.ts` | `pnpm test:gallery` |
| Sidebar row text contrast, each level in both themes and every accent | `apps/gallery/contrast.spec.ts` | `pnpm test:gallery` |
| No layout shift on hover, press or focus, and the cursor rule, in every state | `apps/gallery/shift.spec.ts` (helper: `packages/testing`) | `pnpm test:gallery` |
| Topic art: fades on screen, whole when an off-screen row scrolls in | `apps/gallery/topic-art.spec.ts` | `pnpm test:gallery` |
| Sidebar rows as views: a DM's preview, the group DM tile, the row's description, the title tooltip, the Resolve slot, the list scrollbar | `apps/gallery/sidebar-rows.spec.ts` | `pnpm test:gallery` |
| No focus ring cut off by a scroller or paint containment, tabbing through the main surfaces in light, in four parts (`GALLERY_RING_ONLY=Sidebar` for one, `*` for every component; dark changes only colours) | `apps/gallery/focus-ring.spec.ts` | `pnpm test:gallery` |
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

- **Addresses.** `#/Button?__state=variant/primary&theme=dark&accent=claret`. `__state` is `<group>/<state>` (just `<state>` for a state declared without a group); no `__state` opens the first state. `theme` and `accent` are left out when they are the defaults. States draw in Compact density, the app's default; a state declares `frame.density: 'comfortable'` to draw in Comfortable, and `density=comfortable` or `density=compact` in the address overrides both. `#/` is the index, which lists each component with its groups and states. The old `#/Button/primary` still opens the first state with that key.
- **Keys.** `j` / `k` or the down / up arrows move between states; `[` and `]` switch components (wrapping). Keys are ignored while typing in a field, and the arrows are left to the component while focus is inside the frame.
- **Declaring states.** Group them under headings in product words (`Data`, `Session`, `Failure`, `Interaction`, `Overview`). See `packages/ui/README.md`. List only states the component's code can reach, add no branch to a component to make a state possible, and keep pending states still: nothing resolves on a timer. An unreachable fixture is removed, not kept for show.
- **Screenshots.** `pnpm gallery:shots` writes `apps/gallery/shots/<Component>/<group>/<state>-<theme>.png`.
- **Behaviour specs.** The `behaviour` project in `apps/gallery/playwright.config.ts` runs every `*.spec.ts` in `apps/gallery/` except `shots.spec.ts`, so a new spec file runs without editing the config. `pnpm affected` passes a changed spec as `/<name>.spec.ts`; the slash keeps `geometry.spec.ts` from also matching `list-geometry.spec.ts`.


### The layout-shift guard

Nothing may move when the pointer or the keyboard touches it. `expectNoLayoutShift(page, action)` from `@juno/testing/layout-shift` (`packages/testing`) runs `action` and fails with a report (the node, the old and new box, the delta) if anything shifted. It starts a `PerformanceObserver` for `layout-shift` entries just before the action, waits two frames and then until every transition or animation running under the frame has finished (one iteration of an endless one the action started; with `motion: 'layout'` only those of properties that can move a box, which the gallery uses), and counts every entry with a value above 0, including those Chromium marks `hadRecentInput`, except a `<video>`'s own controls (sources with no node inside a video's box, or an entry with no sources while a video with controls is under the frame). As a fallback it compares the layout box of every element in the frame (`offsetLeft`, `offsetTop`, `offsetWidth`, `offsetHeight`, relative to the frame) before and after. Those ignore transforms, so the press scale is not a shift but a change of size, border or position is, and nothing has to be excluded.

`apps/gallery/shift.spec.ts` hovers, leaves, presses, releases, focuses from the keyboard and blurs every interactive element of every state, with motion on, and checks that an Avatar photo arriving late or failing moves nothing (the `photo/pending` state points at `/__fixture/pending.png`, which the gallery server never answers; the test answers it). The desktop e2e can import the same helper for sidebar hover, tab switches, live messages and image loads.

The guard and the focus-ring check walk many states on one page, and a state changes only the address's hash, so the document is never reloaded and its renderer keeps the code and styles of every component it drew. Both take their page from `walkPages()` in `apps/gallery/support.ts`, which moves to a fresh browser context every 20 states. Before that (10-18), the 24 parts of a remote run on an 8x16 machine grew their renderers from about 100 MB to 370 MB each, the machine ran out of its 16 GB, and the kernel's OOM killer ended one renderer, which Playwright reports as `Target crashed` or `Page crashed` in whatever state that part had reached. With the fresh contexts the same run peaks at 12.7 GB with 3 GB free (154 s script time). 16 workers peak at 9.5 GB but take 172 s, so the remote runner keeps 24. `/dev/shm` is not the cause: the container has 7.9 GB of it, and Playwright already passes `--disable-dev-shm-usage`.

The 10-18 shift-walk hang looked like a close stuck in `pages.close()`, but a repeat of the RemoveCard states failed 20 of 20 walks at `remove/click-then-working`: pressing the last control makes the card working and disables that control, then the guard's keyboard-focus action on it waited until the test deadline. When Playwright aborted the test, context cleanup saw an already closed browser. Closing the page before the context did not fix that action. The guard now checks focus and blur before press and release, while the control is still interactive, and gives each state 30 s to finish. `walkPages()` closes the page with `runBeforeUnload: false` before closing its context, bounds each close at 5 s, and closes the worker browser with a clear failure if the context cannot close. This keeps a stuck context from silently retaining a renderer across rollovers.

After the change, two full remote gallery runs in a row passed all 305 tests: 178 s with 13.0 GB peak used and 2.7 GB available, then 171 s with 12.8 GB peak used and 2.8 GB available. Both used the standard 8x16 machine and 24 gallery workers. The focused RemoveCard walk also passed three repeats at 24 workers after the interaction order changed.

## The feel suite

`pnpm test:feel` records scripted interactions in the built app against the fake Slack and checks them frame by frame. It is separate from `test:e2e` (its own config, `apps/desktop/playwright.feel.config.ts`) because it records video and takes a few minutes.

- **Recording.** `e2e/feel/recorder.ts` takes every compositor frame through the CDP screencast, and on every animation frame reads a few DOM probes (a rectangle, the scroll position, the rows at the top and bottom edges of the view, header text, an element's computed look), plus `layout-shift` and `long-animation-frame` entries and the input events.
- **When probes read.** Once per frame, in a ResizeObserver created in that frame's `requestAnimationFrame`, so it is delivered after layout and after the app's own observers, just before paint. Reading in `requestAnimationFrame` itself sees states the app corrects before painting (the topic view pins its scroll position in a ResizeObserver), and reported jumps that never reached the screen. When a check and the images disagree, trust the images and fix the probe.
- **Checks.** `e2e/feel/checks.ts` turns a recording into verdicts: an element lands and stays, the list stays at the bottom, the row in view holds still, feedback shows in the first frame after the event, a popover opens whole at its anchor, the pane switches from the old state to the new one with nothing between, no blank or flickering region (pixel diffs between frames), no long frames. They count frames and compare geometry, so a loaded machine slows a run down without failing it. Only the long-frame check uses durations: a frame over 100 ms with the page's own work in it fails; other frames over 50 ms only warn.
- **Scenarios.** One `*.feel.ts` file per area: opening topics and what arrives while reading (`topic`), hover, press and popovers (`interaction`), a 300-message thread with late images, the divider, scrolling and reactions (`long`), tab restore (`tabs`), the Juno tab and panel and Juno images (`chat`), Home's review sheets (`reviews`), the sidebar's order hold (`sidebar-hold`), density and Settings (`settings`), the Home icon and Home's first sync (`home`), the lazy parts' first open after a launch (`lazy`) and the welcome card (`welcome`). A scenario that skips fails the run (`e2e/no-skips.ts`) unless it is a placeholder recorded with `recordSkipped`, which adds a `placeholder` annotation. Add a scenario with `feel.run({ name, title, probes, regions, checks }, action)`; mark steps with `rec.mark('press')` so checks can start there.
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
- **pnpm 12 blocks install scripts.** `pnpm-workspace.yaml` must list `esbuild` and
  `bun` under `allowBuilds` (the old `onlyBuiltDependencies` key is ignored).
  Electron 44 has no install script: `apps/desktop/node_modules/electron/dist` appears
  the first time something requires `electron` (`node -e "require('electron')"` in
  `apps/desktop` fetches it).
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
- **Shift guard.** The gallery's guard waits only for running transitions and animations that can move a box, touches once a state that draws the same DOM as one already checked, and its twelve parts take components from one queue in the temp folder, so they finish together. The parts also check the cursor rule on each state they open. `GALLERY_SHIFT_ONLY=Button,Chip pnpm test:gallery` checks a few components while you iterate.
- **Changed tests only.** `pnpm test --changed main` runs only the vitest files affected by changes since `main` (vitest follows imports across packages).
- **Remote runs.** `pnpm remote <script>` takes no local slot. See "Remote runs" below.

## Typecheck

TypeScript 7.0.2 remains installed for the manual `pnpm typecheck:tsc` path and parity comparison. Routine checks use Bun 1.4.3, installed as an exact root devDependency. `pnpm exec bun` resolves the pinned binary; the global Bun install is not used.

`pnpm typecheck` runs `bun check -b` over every project that Bun supports, locally. The checker reads the project inventory and dependency hashes from `scripts/typecheck.mjs`, builds a temporary solution config, and stores passing results separately in the shared system temp folder (`juno-cache/typecheck-bun`). `--no-cache` checks every supported project. Bun has no incremental build cache. Projects with unsupported compiler settings produce one warning naming the project and are skipped; there is no TypeScript fallback. Today all 29 project configs support Bun.

`pnpm typecheck:tsc` is the manual TypeScript-only check. No automatic check, hook, or scheduled run invokes it. `pnpm typecheck:parity` is also manual; it compares Bun and `tsc -b --force`, bypasses result caches, and fails if any project cannot be compared. Neither command is part of routine verification.

**Type stripping.** Node runs some TypeScript from source by stripping types: the agent's crash and recovery fixtures, `pnpm agent:eval`, the AI evals, `fake-slack start`, and the live scripts in `scripts/`, which reach the engine and most packages under it. Node cannot strip syntax that emits code, such as parameter properties (`constructor(private readonly x)`), enums or namespaces, and fails at load time. So every package such code reaches sets `erasableSyntaxOnly` in its `tsconfig.json`, and `pnpm typecheck` reports that syntax: all of `packages/` except `ui`, `views`, `tokens` and `testing`, and `scripts/tsconfig.json`. The desktop app, `ui` and `views` are bundled by Vite and may use it. A package that Node starts to run from source needs the flag too; the flag applies to every file in a project's program, so a bundled package it imports must follow the rule as well.

`pnpm lint` runs its ten checks at once through `scripts/lint.mjs`: oxlint, the decision log, the cache epoch, the migration order, the cursor rule, the duotone icons (`check-duotone.mjs`), tokens, `check-deps`, the fixture check and the health ratchet. None depends on another. Each check's output is printed as one group, under a line with its name, result and time, when it finishes. Lint fails if any check fails, and its last line names the ones that did.

Measured on 10-17 on this Mac, eight alternating runs of each while other agents kept the load at 5.5 to 7.3 on 8 cores, so the numbers vary a lot. The checks one after another with `&&` took 5.5 s median (fastest 3.0 s). At once they took 4.8 s median (fastest 2.2 s). In the parallel run every check except health finishes within 0.7 s. Health takes 2.6 s, and knip alone takes 1.9 to 2.0 s, so knip sets the floor. Making lint faster than that means making knip faster.

`pnpm lint` stays whole: oxlint, the cursor rule, `check-deps` and the fixture check take about 3 s together even on the loaded Mac, and `check-deps` needs the whole package graph to see a bad edge.

## Local Bun checks

`pnpm affected` uses the same local Bun check before starting remote test suites. It checks pending projects with `bun check -b --no-pretty --all`; a type error stops the run before remote suites start. Unsupported configs are warned about and skipped. It never runs TypeScript.

## Testing

Since 10-16, Juno merges first and tests in full afterwards. Many agents work at once, and when each one ran `pnpm affected` the remote queue held about 20 jobs: one run asked for about 8 machines (4 desktop shards, gallery, unit tests, spec checks), the 24 vCPU cap fit one run at a time, and jobs of 1.5 to 3 minutes waited 10 to 56 minutes.

**Agents.** Before reporting, an agent runs `pnpm affected`: the local Bun check and lint, then, as one plan on one remote machine, the unit files its change reaches, the specs it added or changed, the specs it names with `--spec`, and at most 10 more desktop specs that cover the change most directly ("Affected tests"). Heavy tests run only when the change is in their area, and the Quint checks only when the code the specs model changed. `pnpm affected --plan` first shows what it would run and why. `--wide` runs every spec the change can reach, for the rare change that needs it. One remote run at a time per agent. To run a few unit test files by hand, use `pnpm remote test --passWithNoTests <files>` (paths relative to their package); one spec, `pnpm remote test:desktop <files>`.

**Merging.** The orchestrator merges finished branches into main in batches after typecheck, lint and the unit tests pass on the merged tree. The full suites do not gate a merge.

**The CI keeper.** Run `pnpm verify:main --ref origin/main` every six hours, and replace one run each day with `pnpm verify:main --ref origin/main --nightly`. Full runs include heavy sync tests and quarantined tests. Run Quint uncached when its specs or checker change too. Do not start a full run after a merge count. An urgent request in `.juno-status/ci-keeper-request.json` overrides the interval: run its command, record the result, then clear the request. Fix broken-on-main regressions first. Commit the coverage map after each full run; it must not grow older than three days. Conformance is in the full plan. Do not repeat `test:agent` separately; the unit suite already includes it.

**Flakes.** Remote Playwright runs retry once. Tests that pass only on retry remain listed as flaky in the console and full-run summary. Tag a confirmed main flake `{ tag: '@flaky' }` the same day and add its exact reporter ID, reason and date to `.juno-status/release-waivers.json`. Triage this list daily. Tagged tests skip selective runs and still run in scheduled runs. To triage one remotely, use `pnpm remote --env JUNO_INCLUDE_FLAKY=1 test:desktop --grep @flaky` (or `test:gallery`). Release waivers apply only to named test failures in complete reports, never to a crash, timeout, missing report or other infrastructure failure. Remove the tag and waiver when fixed. Do not weaken assertions or run retry loops to obtain green results.

**One machine per run** (landed 10-16): `pnpm affected` and `pnpm verify:main` run their remote suites as one plan on one 8x16 machine, build the desktop app once, and do not shard the desktop e2e. See "Remote runs" and "Machine shapes".

**Test selection by coverage** (landed 10-17): `pnpm affected` picks desktop e2e specs by a coverage map the keeper refreshes, and gallery behaviour specs by the components they open. See "Desktop specs by coverage".

**Narrow plans** (10-18): every spec boots the whole app, so the coverage map linked the median source file to 64 of 103 specs, and 125 of the 181 merges of 10-16 to 10-18 would have run 100 or more desktop specs. `pnpm affected` now ranks the specs and runs at most 10 besides the changed and named ones, skips heavy tests outside the change's area, and runs conformance only for the code the specs model. The scheduled full run covers the rest. Replayed over the 30 branch merges up to `993f2375` (`pnpm affected --plan --json --range`, old planner against new, both without the results cache): 2,503 desktop specs became 296, plans that ran 100 or more desktop specs went from 22 to none, shift-guard components from 1,326 to 546, conformance from 18 plans to 9, and the remote time, estimated from the per-spec times of the 10-17 and 10-18 full runs, from 13,873 s to 6,071 s (median plan 512 s to 189 s). `--wide` planned the same steps as the old planner for all 30. See "Affected tests".

**A leaner suite** (10-17). Slow, duplicated and misplaced tests were merged, moved or removed, and fixed waits replaced with waits on a condition. Each suite on one remote machine of its usual shape, main at `0d93f4e9` before and the `test-slim` branch after:

| Suite | Machine | Before: script time, tests | After: script time, tests |
| --- | --- | --- | --- |
| `test` | 2x4 | 233 s, 1,363 | 170 s, 1,363 |
| `specs:check` | 8x16 | 1 s (all cached) | unchanged |
| `specs:conformance` | 4x8 | 118 s (31 s traces, 86 s replays), 77 | 27 s with cached traces, 80 (four files, each with its own trace-count test) |
| `test:gallery` | 8x16 | 156 s, 182 | 104 s, 185 (the focus-ring check is now four parts) |
| `test:desktop` | 4x8 | 619 s, 380 | 538 s, 372 |

Where it came from: a 31 s idle-time sleep and an 11 s poll sleep in unit tests, and shorter Retry-After values where only one 429 has to show rate-limited; conformance replays split into four files and traces cached; the gallery guard waiting only for motion that can move a box, the cursor sweep folded into the shift walk, and the focus ring checked in light only; in the desktop e2e, a two-minute real-clock wait, a 31 s idle wait, one merged test and seven removed duplicates. A run after a spec change still generates its conformance traces (28 Quint runs, about 45 s on this Mac).

The T3 watcher (`packages/agent/src/t3/watch.ts`) no longer reads on a fixed 10 s poll: it reads 1 s after a change and backs off to 10 s while nothing changes, and wakes at once when `t3_thread_wait` reports the run ended or Juno sends an answer, so the T3 Code e2e tests no longer wait out a poll for those steps. Still slow, left as they are: `ai-key.spec.ts` waits about 22 s for the title job's 30 s tick after the daily cap is raised; several tests sleep a few seconds to show that nothing happens, where no signal marks the end of a pass.

**Round 2** (10-17). The follow-ups above, measured the same way but with every suite on the standard 8x16 machine, one after another in one plan (`pnpm remote --env JUNO_PLAN_SERIAL=1 test:plan test + test:gallery + test:desktop`), main at `0e8669fe` before and the `test-slim-2` branch after. Summed test time is the sum of the per-test (desktop, gallery) or per-file (unit) durations the run log prints; script time depends mostly on the slowest worker.

| Suite | Before: script time, summed, tests | After: script time, summed, tests |
| --- | --- | --- |
| `test` | 90 s, 406 s, 1,481 | 86 s, 392 s, 1,490 |
| `specs:conformance` | not changed | 27 s with cached traces, 80 |
| `test:gallery` | 135 s, 2,742 s, 218 | 116 s, 2,312 s, 223 |
| `test:desktop` | 241 s, 1,514 s, 411 | 236 s, 1,395 s, 401 |

The desktop specs changed went from 246 s to 152 s summed: `presence.spec.ts` 103 to 41 s, `sidebar.spec.ts` 33 to 23 s, `quick-start.spec.ts` 26 to 18 s, `send-checks.spec.ts` 52 to 47 s, `mentions.spec.ts` 21 to 16 s, `emoji-colon.spec.ts` 12 to 8 s. The rest of the desktop and gallery difference is run-to-run variation. What changed:

- Pure rules moved to unit tests. The 1,000-character limit on the checks on send is `sendChecksApply` in `@juno/domain`; the private-channel audience check and lowercase i left alone were already unit tested (`checks.test.ts`). Emoji matching (the colon query, custom aliases, ranking) moved from the renderer container to `@juno/domain` (`composer-emoji.test.ts`). Mention parsing was already in `composer-mentions.test.ts`, so Backspace on a picked name joined the person mention test, and New chat's emoji Tab joined the New chat mention test.
- Sidebar view states moved to `apps/gallery/sidebar-rows.spec.ts`: five e2e tests (DM Main row, row description, title tooltip, Resolve on hover and focus, list scrollbar). The DM rows' missing people stack, which the engine decides, joined the quick filters test.
- `quick-start.spec.ts`: the preview test runs on a fifth of the large seed (13 s to 5 s); the budget test keeps the large seed.
- `presence.spec.ts`: against the fake the engine spaces tickles 2 s apart (`session/Session.ts`; the 19 s pacing is unit tested in `@juno/slack`), and the tests make main read the idle time at once, so two 30 s waits became about 4 s each.

Looked at and left: the ten slowest unit files (the engine's `sync`, `send`, `reads`, `art`, `automated`, `actions`, `reconnect`, `reactions`, `messages`, `send-copies`) spend their time booting an engine per test, with sleeps under 3 s that show nothing happens; `juno-agent/crash.spec.ts` relaunches by design; the 429 storm in `realtime.spec.ts` needs a Retry-After longer than the interactive lane's 5 s wait; `idle-cpu.spec.ts` measures over the 20 s window performance.md sets; `automated.spec.ts` waits 4 s three times for the Automated job's 3 s window, which has no signal for a finished pass.

**Round 3** (10-17). Main at `c57723fc`, `pnpm remote test:desktop` on one 8x16 machine: 409 passed, 1,414 s summed, 291 s script time. Round 2 had already moved the send-check limits, emoji matching and five sidebar view states, and mention parsing was unit tested, so what was left was launches:

- A test that needs a launch setting gets it from a fixture option: `test.use({ fakeAiDelayMillis })` in `grammar-pause.spec.ts` and the three slow-model tests in `send-checks.spec.ts`, `test.use({ screenShared: true })` for the capture that never stops in `privacy-sharing.spec.ts`. Each used to sign in, quit and relaunch. A relaunch stays where a test checks what survives one.
- `quick-start.spec.ts`: the flow test runs on the same fifth of the large seed as the preview test (13 s on the large seed). The budget stays on the large seed in `perf.spec.ts`.

These four specs took 88 s summed before (`send-checks` 48, `quick-start` 18, `grammar-pause` 12, `privacy-sharing` 11).

Looked at and left: the 429 storm in `realtime.spec.ts` (33 s) and `idle-cpu.spec.ts` (28 s), as in round 2; `ai-key.spec.ts` (23 s), whose three waits show nothing happens; the AI assist off tests in `send-checks`, `art` and `home`, which set the pref in `user.db` and relaunch because the app reads it at launch; the remaining mention and emoji e2e tests, each one user flow over rules already unit tested.

**Round 4** (10-18): the audit in `docs/testing-audit.md` measured what each suite costs and what it caught in a week, removed a gallery hang that cost every full run on main 13 minutes, merged desktop tests that shared their setup (474 to 408 launches), and removed or rewrote tests of internals. Its rules follow.

**Unit setup and parallel files** (10-19). The engine harness builds an empty migrated database template once per test file, closes it, then copies it into each fresh engine's private directory. It does not copy synced workspace data or share engines. Store migration tests still run from scratch. Related engine checks can share one named flow; tests of different starting states and failure cases remain independent. Large-seed repair and socket-liveness cases are separate files so existing remote file parallelism can overlap them. `pnpm remote test` already sets `JUNO_TEST_FILE_PARALLEL=1` and bounds workers to the runner; the local serial default is unchanged. Measurements and the assertion inventory are in [Unit suite timing](unit-suite-timing.md).

### Rules for tests

These apply to every new or changed test. The audit has the measurements behind them.

- **Test what a user or a caller sees.** Assert on the screen, on what reached the fake Slack, on rows a live query returns, or on a command's result. Do not assert on private state (a queue's internal map, a table only the module reads), on calls between our own modules, or on the exact shape of an internal object; such a test fails on a refactor and passes on a bug. Unit tests are for pure rules; boot the engine against the fake Slack for anything else.
- **A test must be able to fail.** Before you finish, break the code it guards (return early, flip a condition) and see it fail. A check of a constant against the same literal, of what the test itself set up, or of a copy of the code (SQL pasted into the test) guards nothing. A title must match the input: "flattens list items" needs a list.
- **One check, one place.** Before adding a test, search for one that already makes the same assertion: a spec table row, another package's test, a gallery state. Extend that one.
- **One launch per journey.** A desktop test pays about 1.9 s to launch, sign in and sync before its own first step (0.63 s launch and close, 0.69 s sign-in, 0.69 s first sync). Add a small check as a `test.step` of the test whose journey already reaches that state, named for what it checks, rather than as a new test. Start a new test only when the check needs a fresh app (first sign-in, counts from zero, a pristine sidebar order), its own launch options, or a relaunch. Order steps so that none changes what a later one checks, and take a fresh baseline where a count is relative.
- **Wait for the thing, not for time.** Wait for the value you assert, the stored row (`e2e/driver/userDb.ts` reads `user.db`), `scrollend`, a call in `fake.calls`, or the answer row. A fixed sleep is allowed only to show that nothing happens when no signal marks the end of the pass, with a comment that says so. To make such a sleep short, give the product's window a test-only setting (`markDelayMillis`, `slackScheduleDebounceMillis`, `automatedWindowMillis`) and keep the app's value in the one test that checks the window itself.
- **Every wait has a bound.** A Playwright call that can wait for an element must not wait for the test's whole timeout inside a long walk: give it its own timeout, or check the element still matches first. One unbounded `locator.evaluate` cost 13 minutes per run.
- **Theme only where colour matters.** The dark theme changes colours and shadows, never a size. Geometry and overlap checks run in light; contrast and fill checks run in both.
- **Keep these, whatever they cost:** the Quint specs and conformance, privacy and secret-handling tests, the sync, read-state, follow-state and outbox tests, crash and recovery tests, regression tests named after a real bug, and the layout-shift and feel checks. Make them faster; do not drop them.

## Affected tests

`pnpm affected` works out which tests the change can reach and runs only those. After local Bun checking passes, the remote suites run as one plan on one Namespace machine (`pnpm remote test:plan`, see "Remote runs"), and the local steps (lint, the Node checks) run on the Mac beside it. Each step's result comes back separately, so the results cache records the steps that passed (`--local` runs every step one after another through the local root scripts; `--plan` only prints the plan, and `--plan --json` prints it as JSON; `--files a,b` plans for given files; `--spec <spec>` also runs that desktop or gallery spec, repeated or comma-separated; `--max-specs <n>` allows more coverage-picked desktop specs than 10; `--wide` plans every spec the change can reach, heavy tests included, as before 10-18; `--batch` is the batch gate's plan, below; `--local-on-outage` runs the remote steps here if Namespace stays unreachable, see "Outages" under "Remote runs"). The change is every file that differs from the merge base with `origin/main` (or `main` when there is no remote), committed or not, plus new files. Agents use it while iterating and for their report; full suites run on a schedule against `main` and before a merge when asked.

An import graph over `apps/` and `packages/` decides what each change reaches, and for desktop e2e specs a coverage map narrows it ("Desktop specs by coverage" below). The graph follows relative imports, `@juno/*` through each package's `exports`, and named imports followed through barrel files (`export * from` and `export { } from`) to the module that declares the name. The rules:

| Changed | Runs |
| --- | --- |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the root `package.json`, `tsconfig.base.json` | every unit test, `specs:check`, conformance, and a sample of each e2e suite: the 10 smallest desktop specs and 10 gallery components (no spec can be told apart) |
| `scripts/affected.mjs`, `scripts/affected-select.mjs`, `scripts/affected-run.mjs`, `scripts/affected-tests.mjs`, `scripts/test-areas.mjs`, `scripts/import-graph.mjs`, `scripts/coverage-map.mjs`, `scripts/remote*`, `scripts/heavy.mjs`, `scripts/build-cached.mjs`, `scripts/without-run-as-node.mjs` | the tool tests (`test:health`, `test:repo-tools`, `test:remote-pool`) and `e2e/app.spec.ts`, as a check that a run still works |
| A vitest file, a file one reaches, or a package's `package.json`, `vitest.config.ts` or `tsconfig.json` | those vitest files (`pnpm test --passWithNoTests <files>`). A vitest file is any file a package's or app's `vitest.config.ts` includes (every project's `include`, `test/**/*.test.ts` by default), in `packages/` and `apps/` alike: `apps/desktop/test/`, `packages/agent/eval/` |
| A script under `scripts/` that a Node test imports, or the test itself | the root script that runs that test with `node --test` (`test:repo-tools`, `test:health`, `test:remote-pool`); every `scripts/**/*.test.mjs` belongs to one (`scripts/affected.test.mjs` checks) |
| `specs/` (not Markdown) | `pnpm specs:check`, narrowed to `--memory`, `--actions` or `--recovery` when only that agent spec changed; its cache skips checks whose inputs passed before |
| The code the specs model (`PROTOCOL_PATHS` in `scripts/test-areas.mjs`): `specs/`, `packages/sync/`, the engine's `outbox.ts` and `send/`, the conformance harness | `pnpm specs:conformance` |
| A file a component's fixtures reach | `pnpm test:gallery` with `GALLERY_SHIFT_ONLY` set to at most 10 of those components, ranked as desktop specs are (below), and the other behaviour specs that open one of them |
| A gallery behaviour spec other than `shift.spec.ts` | that spec |
| The gallery harness: `apps/gallery/` (except its spec files and `shots.spec.ts`), `shift.spec.ts`, `packages/testing/` | `pnpm test:gallery` for every component and spec, the heavy shift guard over every component included |
| A file the desktop app runs (`apps/desktop/src` and the packages it bundles) | `pnpm test:desktop` with at most 10 of the specs the coverage map says ran it, the most direct first (below) |
| The shared e2e support: `e2e/fixtures.ts`, `e2e/driver/`, `e2e/build.ts`, `e2e/coverage.ts`, `e2e/no-skips.ts`, the Playwright and electron-vite configs, `apps/desktop/package.json`, the renderer's `index.html`, `src/coverage.ts`, and what they reach outside the app (the fake Slack, the fake OpenRouter) | `pnpm test:desktop` with at most 10 of the specs that use what changed, the nearest first (below) |
| An e2e spec file | that spec, always |
| A helper some specs import | those specs, ranked above coverage picks |
| Any `.ts`, `.tsx` or config a typecheck project reads | `pnpm typecheck` locally with pinned Bun; unsupported projects are warned about and skipped |
| Anything but Markdown | `pnpm lint`, on the Mac (about 3 s, less than a remote machine's overhead) |
| Documentation only | nothing |

`--wide` keeps the rules from before 10-18: everything runs for the files in the first two rows, every spec the coverage map picks runs, shared e2e support and style sheets run every desktop spec, `packages/tokens/` runs the whole gallery, conformance runs for any of the 425 files its replay reaches, and heavy tests always run.

**Heavy tests.** Some tests are slow because of what they check, and their code rarely changes: the large-seed idle test (5 minutes in a full run, 12 alone), the first-sync cases in `layout-shift.spec.ts`, every test in `quick-start.spec.ts`, the 429 storm in `realtime.spec.ts`, and the gallery's shift guard over every component. Each is tagged `@heavy` and its area's tag (`{ tag: ['@heavy', '@heavy-sync'] }`). `HEAVY_AREAS` in `scripts/test-areas.mjs` is the one place that says which code each area covers: sync (`packages/sync/`, the engine's session and start, the Slack client's pacing, the large seed and the three specs), idle (the process monitor, the engine's workers, the agent's schedulers, `idle-cpu.spec.ts`) and the gallery harness. The idle spec's portable gate is a remote runaway check (25% of one core averaged over 60 s); its fine per-process budgets are in `@mac` tests. A plan runs an area's heavy tests only when a changed file, or a spec named with `--spec`, is in that area. Otherwise it sets `JUNO_SKIP_TAGS` (for example `@heavy-sync,@heavy-idle`), which each suite's Playwright config adds to its `grepInvert`, and leaves out a spec whose every test is heavy. The scheduled remote full run includes the coarse idle check. Fine idle budgets run in the nightly Mac lane and on demand on the Mac; they do not run in remote plans or remote full runs.

**Batch gate.** `pnpm affected --batch --base <ref>` (what `scripts/batch-merge.mjs` runs after its own typecheck and lint) plans only the unit files and script tests the batch reaches, `specs:check` when `specs/` changed, and conformance when the code the specs model changed. It does not run the gallery or desktop e2e.

**Results cache.** Each unit test file, gallery component, gallery behaviour spec file and desktop e2e spec file is an item with a key: a hash of every file it reaches, its package and suite configs, and the lockfile. After a step passes, its items' keys are recorded in the system temp folder (`juno-cache/results`), shared by every worktree, whether the step ran here or remotely. An item whose key passed before is skipped and counted in the plan; `--no-cache` runs everything. `specs:check` keeps its own cache per Quint run. A failing step records nothing.

`perf` and `test:feel` never run here, but `pnpm verify:main --with-mac` runs both on the Mac after the other suites; the nightly Mac run covers them. Run a matching perf scenario for new per-row, per-frame or startup work, and a matching feel scenario for a change to that interaction. Use the nightly result as the baseline. The plan names matching perf and feel scenarios from `PERF_INTERACTIONS` in `scripts/test-areas.mjs` when their files change. The graph errs towards running more: a module imported whole (`import x from`, `import * as`) brings everything it imports. A test whose behaviour depends on a file it does not import (a fixture read from disk, an environment variable) is not seen; the scheduled full run on `main` catches that.

### Desktop specs by coverage

Nearly every file reaches the whole desktop app through the import graph, so the graph alone would run every desktop spec for any app change. Instead, `pnpm affected` reads `apps/desktop/e2e/coverage-map.json`, which records, for each spec file, the source files under `apps/` and `packages/` whose functions ran while one of its tests had the app open.

**Recording.** `JUNO_COVERAGE=1` turns it on for a desktop run. The build then writes hidden source maps (`electron.vite.config.ts`; `build-cached` rebuilds when the variable changes). `apps/desktop/src/coverage.ts` is the first import of main, the engine and the agent: with `JUNO_E2E_COVERAGE` set to a directory, each process starts precise function coverage on its own inspector and writes the start offsets of the functions that ran. Main also attaches to each renderer over the DevTools protocol before its page loads. The fixtures give each launch its own directory under the spec it belongs to, and ask main and the renderers to write before they close the app. The engine and the agent write every two seconds and on SIGTERM. The run's teardown (`e2e/coverage.ts`) runs `node scripts/coverage-map.mjs reduce`, which maps the offsets to source files with the source maps and writes `apps/desktop/coverage/map/partial-<shard>.json`; `pnpm remote` brings it back with the reports. A module's top level does not count: in a bundle it runs at load in every test, so it says nothing about a spec.

**Refreshing.** `pnpm verify:main` runs the desktop suite with `JUNO_COVERAGE=1` and writes the joined map (`node scripts/coverage-map.mjs merge <partials> --commit <sha>`) to `apps/desktop/e2e/coverage-map.json` in the checkout it ran from. A failed test still ran its code, so failures do not stop the refresh. The CI keeper commits the map after each of its runs on main, as "Refresh the e2e coverage map". The map is a few hundred kilobytes, one source file per line, so a refresh reads as a diff.

**Selecting.** `scripts/affected-select.mjs` picks the candidates, and the plan prints each spec's strongest reason:

- for a change to the shared e2e support (the driver, the fixtures, the fake Slack, the fake OpenRouter), the specs that use a changed class member or function, or a support part that uses one (`reachSpecs`). A spec uses `Palette.section` when it names `.section` and can get a `Palette`: it names the class or an accessor that builds or returns one. A change outside every named part (a class's own line) counts as a change to everything the file exports, and a Slack method a changed line names (`'conversations.history'`) picks the specs that name it. Where nothing can be placed (a config, a page), every spec is a candidate and the smallest stand in. `--wide` keeps the old rule: every spec for support other than the driver, and for a driver change outside a named part;
- a changed app file outside the JavaScript bundles (a style sheet, a page, an asset) picks nothing; the gallery and the scheduled full run check it (`--wide`: every spec);
- the specs that ran a changed file;
- a changed spec, and the specs that import a changed helper;
- for a file with module-level code only (`moduleOnly` in the map: bundled, but no spec ran a function from it, such as schemas, RPC routes and prompts) or a file that is new since the map's commit, the specs that ran the files importing it, walking up through importers that did not run; none when nothing that imports it ran (`--wide`: every spec);
- the specs that ran a file importing a changed file, when that importer itself changed since the map's commit (it may call the changed file now);
- specs the map has no coverage for (new or never recorded), whenever the app changed.

A changed app file that was in no bundle when the map was recorded (types only, or not used by the app) picks no spec.

**Ranking.** The plan runs every changed spec and every spec named with `--spec`, then at most 10 candidates (`--max-specs`), the highest score first (`rankSpecs`). A spec scores, for each changed file it ran, the log of how many specs there are over how many ran that file: a file every spec runs (app boot, the shared harness, `Palette.tsx`, which the shell mounts) adds almost nothing, and one three specs run adds a lot. A support change adds more the nearer the spec is to what changed. A helper adds more the fewer specs import it. A spec named like a changed file (`palette.spec.ts` for `Palette.tsx`) adds a little. A tie goes to the spec that ran fewer files, which is usually the quicker one. The plan says how many more specs ran a changed file; the scheduled full run covers them. Gallery components for the shift guard are ranked the same way, by how few components a changed file reaches and a component named like a changed file.

**Measured** (10-17, map from `d15f27ee`, replaying merges with `pnpm affected --plan --range <merge>^1..<merge>`). Of the 20 merges on main up to `25e9b5f7`, 17 touched the app, and for each the import graph picked every desktop spec. The coverage map picked 6 of 69 for palette-pages, 44 for thread-root and 1 for a batch fix; the other 14 still ran everything, because of the lockfile or root `package.json` (4), the fake Slack, the fake OpenRouter or the fixtures (5), or core files every spec runs (5: navigation, the send worker, sync boot). 123 files are run by every spec and the median file by 40. File by file it is narrower: palette files pick 5 specs, the message window 44. It picked the failing spec for all six real desktop failures of 10-16 (mirror-reads, tabs, both break-pass specs, avatars-unfurls, stick-bottom), whether given the whole merge or only the files that caused the failure. Gallery behaviour specs: 3 of 14 for palette-pages, slack-import-paths and automated-reason, 8 for send-checks-c, 13 for broad UI merges.

**Staleness.** The map lags main by the time since the keeper's last run (at most six hours in normal operation). The rules above cover the two ways it goes stale: new files, and importers edited since the map. What they miss is a call that became reachable through a file that did not change, which is rare; the keeper's full run on main catches it. A map more than three days old, from a commit this repository does not have, or missing, is not used: every spec runs when the app changed, as before. `pnpm affected --graph` ignores the map.

**Limits.** Code that runs only in the test process (the fake Slack, the driver) is not recorded; that is why changes there are picked by the names specs use, not by the map. The renderer writes its coverage when the test closes the app, so a renderer that crashed or a window that closed before that is not counted. Tests tagged `@mac` do not run remotely and are not recorded. The gallery is not recorded: its behaviour specs are narrowed by the component names they open (`galleryComponents`), and a spec that reads every route without filtering them runs for any component.

## Remote runs

`pnpm remote <script> [args...]` tries a configured SSH runner first, then runs a root script on Namespace if the runner is unreachable or full for 60 seconds. Both backends stream output and the exit code back.

SSH wide unit-only jobs reserve 4 cores with a Docker CPU limit of 4: `test` without named files or with more than 20 named files, and `specs:check` without a carried cache or with caching disabled, including those steps inside `test:plan`. The 20-file threshold keeps small affected slices cheap and gives broad selections across packages the full budget; it is a scheduling heuristic. Narrow unit selections, `test:agent*`, and cached spec checks reserve 1 core with a limit of 2. Jobs and plans containing `test:gallery` without desktop or e2e steps reserve 3 cores with a limit of 3. Any `test:desktop` or `test:e2e` step reserves 4 cores with a limit of 4, including plans that also run the gallery. Other scripts keep 8 cores. Host admission counts reservations, not CPU limits. `--machine` or `JUNO_REMOTE_MACHINE` overrides both values on SSH and the shape on Namespace; default SSH reservations shrink to fit a smaller host.

Namespace, including fallback, uses the standard shape, 8x16 (see "Machine shapes"). Each Namespace run gets its own machine and waits when the shared core cap is full; nothing takes the local heavy-job lock. Use it for `test`, `specs:check`, `test:agent*`, `test:gallery`, `test:desktop` (the desktop e2e alone; it passes arguments on, for example `pnpm remote test:desktop e2e/topic.spec.ts`) and `test:e2e`. `perf` and `test:feel` are refused: they time the Mac. Desktop e2e tests tagged `@mac` (`{ tag: '@mac' }`) depend on macOS behaviour and are skipped on Linux; the nightly Mac run includes them. The native Window and Graphics idle budgets are `@mac` only; the remote `idle-cpu.spec.ts` check uses a 25% runaway ceiling for every Juno process. For idle CPU changes, run the fine budgets through the local heavy-job lock with `pnpm test:desktop idle-cpu.spec.ts --grep @mac`.

- **Plans.** `pnpm remote test:plan <step> + <step> ...` runs several root scripts on one machine (`scripts/plan.mjs`); `KEY=VALUE` words before a step's script set its environment, for example `pnpm remote test:plan test --passWithNoTests a.test.ts + GALLERY_SHIFT_ONLY=Chip test:gallery + test:desktop`. The app suites (`test:desktop`, `test:gallery`, `test:e2e`) run one after another. Unit tests and spec checks each have their own lane beside them under `nice`; `JUNO_PLAN_SERIAL=1` runs every step in turn. Lane workers scale with the Docker CPU limit, rounded down and at least one: desktop gets half, gallery three quarters, and unit tests and Quint simulations a quarter each. At 3 cores the gallery keeps three workers and shift parts. At 4 cores this gives two desktop or three gallery workers, one unit worker in one package, and one simulation. At 8 cores it gives four desktop or six gallery workers, two unit workers, and two simulations. An uncached bounded check adds one Apalache checker. Gallery shift parts match its workers. Explicit step environment settings still win. Inside the container `scripts/build-cached.mjs` reuses a build made earlier in the run, so the desktop app is built once. Each line of output starts with `[<script>]`, and a line `plan: step <i> <script> exited with <code> after <s> s` gives each step's result; `pnpm affected` and `pnpm verify:main` read those lines.
- **What is sent.** The files git sees in the worktree (tracked or new, not ignored), so uncommitted work is tested; `.env`, `node_modules`, build output and design images under `docs/` are not. The script stops if a file looks like a key or token file or holds what looks like a real Slack token.
- **Where it runs.** Both backends use the toolchain in `scripts/remote/Dockerfile`: Playwright's Ubuntu image, Node 26, pnpm, Java 21 and Quint's Rust evaluator and Apalache. Its tag hashes only the Dockerfile and the root manifest's Quint pin. Namespace builds and pushes a missing `juno-toolchain:<tag>` with `nsc build`; SSH builds the same image locally. Each container unpacks a fresh workspace, installs with `pnpm install --frozen-lockfile --prefer-offline`, checks Bun's version, and runs the script under xvfb. Electron and Bun download through their approved install scripts. The log reports `remote: workspace installed in N s`.
- **Dependency cache.** SSH mounts its persistent pnpm store and metadata, pnpm runtime locks, and Electron downloads. Namespace requests `--volume cache:juno-workspace-v1:/var/cache/juno-runner:4gb` on new machines and mounts the same directories from that machine into each container. A warm pool machine reuses its disk. `JUNO_REMOTE_STORE_CACHE=off` disables the volume request; `JUNO_REMOTE_STORE_TAG` selects another tag for measurements. If the plan rejects cache volumes before allocating a machine, the run logs the fallback and creates a machine without the volume. New machines then install cold. Registry, transport and capacity failures retain their existing recovery. [Namespace's cache lifecycle](https://namespace.so/docs/architecture/storage/cache-volumes) permits cache misses and commits only clean instance completions, so every install can fetch missing packages. `JUNO_RUNNER_HOST= pnpm remote ...` forces Namespace for a comparison.

- **Results.** Output streams live and is saved as `.remote/<run>/run.log`, including failing test names even if downloading the reports fails. Reports (spec traces, Playwright results and any generated HTML report) land in the same directory. The exit code is the script's own.
- **Memory.** The remote runner samples `MemTotal - MemAvailable` every two seconds and prints the peak used and available memory after each script. These are machine-wide values. SSH also prints cgroup v2 `memory.peak`, including file cache, for the job container; use that peak to size shared host capacity. SSH CPU busy uses cgroup CPU time divided by the Docker CPU limit, rather than all host threads.
- **Warm pool.** After a clean run the machine goes back to a pool kept in the system temp folder (`scripts/remote/pool.mjs`); the next run on this Mac claims it with the image already pulled, which takes a small suite from about 190 s to 19 s. A machine runs one job at a time. The pool keeps at most `JUNO_REMOTE_IDLE_PER_SHAPE` (default 2) idle machines of each shape; a detached pool daemon destroys one after `JUNO_REMOTE_IDLE_MINUTES` (default 8) idle minutes (the cost is in "Current cost controls"), every machine ends after 3 hours, and after a failure or Ctrl-C the machine is destroyed at once. `pnpm remote --status` lists the pool; `pnpm remote --drain` destroys the idle machines.
- **Admission.** Requests enter a first-come, first-served file queue shared across worktrees. With one shape, a free machine or 8 free cores fit any request. A request that does not fit (an explicit larger `--machine`) does not hold free cores: later requests that fit may start, until it has waited `JUNO_REMOTE_HOLD_SECONDS` (default 120). After that it holds the cores it needs, so a stream of small jobs cannot starve it. Queue order survives daemon failure; dead clients are removed. All participating worktrees must use this pool version for daemon-only polling and queue fairness; older clients still use direct admission. Output reports position, requested cores and elapsed wait every ten seconds. Provisioning stays in the client, outside the decision lock, with cores reserved before the daemon grants it. The daemon admits every request against its own cap, so runs from older worktrees, which still send `cap: 24`, get the current cap; a request whose `JUNO_REMOTE_MAX_VCPU` was set below the default keeps its lower cap.
- **Recovery.** Creation attempts are recorded before `nsc create`; machines carry pool-owner and attempt labels. The first acquisition starts a shared daemon (an upgrade of the reaper watcher). It runs from a copy of the pool's modules in the pool folder (`daemon/<hash>/`, `scripts/remote/daemon-home.mjs`), never from a worktree: on 10-17 one started by `verify:main` outlived its temporary checkout. A daemon of an older version, or one whose script no longer exists, is replaced; the pool checks the process's command before signalling it. It owns inventory and admission, polling once five seconds after the previous reconciliation finishes; slow calls never overlap. Clients publish requests in the pool’s `queue/` directory and read their answers without calling Namespace. The daemon exits after six minutes when there are no requests or machines to reconcile. Untracked pool machines get a five-minute grace period; live local owners and pending creates are protected. Known idle cleanup runs under the decision lock before the inventory call, so a failed listing does not prevent that cleanup attempt. Machines labelled for another pool are left alone. Legacy `juno-remote=1` machines without an owner label are reconciled against this Mac's shared state. Failed destroys stay marked `destroying` and are retried. Workspace listings allow 90 seconds per call and three attempts for transient errors; `null` means no instances. During each daemon tick, reconciliation and admission share one snapshot. Newer machine records and pending creates still reserve capacity. If the daemon dies or cannot start, clients use the same durable queue and decision lock in direct mode, sharing successful inventory for up to five seconds and invalidating it before and after creates and destroys. A reservation identifies its request, so recovering an unanswered request cannot allocate it twice. Failed destroys remain recorded for the daemon to verify on its next poll. A transient workspace listing failure pauses acquisition and retries after two seconds; it never treats usage as zero. Timed-out creates get two quick retries (after two and four seconds), then one a minute while the failures last. Known partial instances are destroyed first. A failed attempt, or one whose client died during `nsc create`, keeps its reservation and attempt label until an inventory taken after the failure has shown its machine destroyed, or has not shown it for five minutes. While Namespace cannot be listed nothing is forgotten, and the daemon stays up while such a record exists, so a machine that arrives late is destroyed when it appears and is never handed out. A client that died before calling `nsc create` frees its reservation at once. Authentication and configuration errors still fail. Infrastructure failures use exit 255 and `infraFailure` in the log summary.
- **Outages.** On 10-17 Namespace's EU compute API hung from 07:12 to about 11:10 IST: `nsc list` timed out and creates returned 504 or `DeadlineExceeded`, while sign-in still worked. The daemon could not read the inventory, so it admitted nothing, and four runs waited up to two hours without saying why. Every failed or timed-out `nsc list` and `nsc create` (502, 503 and 504 included) is now recorded in the pool folder's `namespace-outage` file (`scripts/remote/outage.mjs`), with when the failures started and the last error; a success clears its call. Once a call has failed at least twice over three minutes (`JUNO_REMOTE_OUTAGE_AFTER`), every waiting run prints one line, such as `remote: Namespace unreachable since 07:12 (nsc list timed out 14 times; last: ...). Waiting; use --local to run on this Mac.`, then a reminder every five minutes in place of its queue position. `pnpm remote --status` shows the same line. Runs keep waiting by default, since this Mac is the owner's computer. `JUNO_REMOTE_OUTAGE_WAIT=10m` (or `90s`, `1h`; a bare number is minutes) makes a run give up once the outage has lasted that long, with exit code 75 and `outage: true` in the log summary. `pnpm affected` then says that `--local` runs the steps here; `pnpm affected --local-on-outage` sets the wait to 10 minutes unless it is set, and on exit 75 runs the remote steps on this Mac through the heavy-job lock. `batch-merge --local` runs a batch's unit tests here. One `nsc list` may take `JUNO_REMOTE_LIST_TIMEOUT_SECONDS` (default 90); `nsc create` is ended after 10 minutes and other `nsc` calls after 2.
- **Cap.** Machines in use and idle stay within `JUNO_REMOTE_MAX_VCPU` (default 48 vCPU, approved by the owner on 10-17 to clear the queue; 24 from 10-16). `JUNO_REMOTE_MAX_VCPU` may lower it, or raise it up to the Team plan's 64; the pool daemon uses the value from the run that started it. A run waits while the pool is full; after a minute it reports tracked and untracked workspace vCPU. An idle machine of another shape is destroyed to make room. Namespace's image builders (`nsc.purpose=builder`) are not counted: they stay up idle after an image build and are not ours to release, and on 10-16 two of them (32 vCPU) stopped every run for over 15 minutes while 31 requests waited.
- **Cost.** Namespace bills vCPU-minutes (about $0.001 each on the Team plan), whatever the shape, so a machine costs its vCPU count times the minutes it is up, idle or not. The 48 vCPU cap bounds the spend at about $2.88 an hour with every machine busy. `--keep` leaves a machine available for `nsc ssh <id>` and tracked until its 3-hour expiry; it is neither reused nor drained.
- **Setup.** `brew install namespacelabs/namespace/nsc` and `nsc login` once on the Mac. No credentials live in the repo.
- **Timings** (2026-10-15, 16x32, before the standard shape; the one-machine numbers are in "Machine shapes"). Local times are with a free slot, before any queue wait. A new machine adds about 20 s to create and 45 s to pull the image; a warm one adds about 10 s.

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
- **Shards.** Opt-in only. `pnpm remote --shards n <script>` runs the script on n machines at once with `JUNO_SHARD=i/n`; for `test:desktop` each machine runs its Playwright shard and the parent merges the blob reports into `.remote/shards-*/html`; `specs:check` keeps its share of the jobs (dealt by expected cost, typechecks on every shard).
- **Spec cache.** A remote spec check takes the Mac's cache of passing Quint runs along (staged in `.remote/`) and brings back what it adds, so a check that passed anywhere is not run again.
- **Dials.** About one dial in four to Namespace's SSH gateway fails from this network and nsc takes 16 s to give up. The remote command prints a start line first; with none after 8 s, the run dials again (up to six times).
- **`--dry-run`** prints the steps without creating anything.

### Toolchain and store measurements

Measured on 2026-10-19 from `9f3c80b04` and this change. Each reported workload
ran once per state, sequentially, with 23 unit tests and, for the app plan,
four desktop tests. All passed without test retries. SSH uses its default
1-core reservation with a 2-core limit for the unit run, and 4 cores for the
app plan. Namespace uses 8x16. These observations include network variation;
they are not established speedups. Builds below had a missing tag but reused
the common base and Node layers.

| Measure, seconds | SSH full image | SSH toolchain | Namespace full image | Namespace toolchain |
| --- | --- | --- | --- | --- |
| Missing-tag build | 113–185, earlier owner measurements | 63.5 | About 120, earlier measurements | 53.3, including push |
| Cold install | Baked into image | 55 | Baked into image | 26 for the unit run, 3 for the app plan |
| Warm install or offline linking | 0–1 | 0–1 | 0–1 | 0–1 on both a fresh cache hit and a warm machine |
| Install after a lockfile change | Rebuilds the image | 5, same image tag | Rebuilds the image | Not measured; the shared tag test covers both backends |
| Unit run, wall | 91, image present | 220 with the first build, 52 warm, 55 after the lockfile change | 58 fresh, 56 warm | 143 with the first build, 67 fresh with cached store, 42 warm |
| App plan, wall | 105, image present | 78 warm | 77 fresh, 62 warm | 85 fresh with cold store, 67 fresh with cached store, 46 warm |

The SSH wall times above precede the IPv4 transport fix. After that fix, the
same warm unit run took 32 seconds. Three fresh-shell `runner:check` calls
passed in 0.67–1.68 seconds and still reported 16 cores. DNS lookup took
10–1,209 ms. Raw SSH tried an unreachable advertised IPv6 address for five
seconds before IPv4, while IPv4-only probes passed in 0.17–0.42 seconds.
The new fresh cached Namespace unit run, the new warm unit run and the old
warm unit run each had a gateway retry before the command started. The new
warm unit observation includes that retry.

Five alternating warm installs per flag gave a median of 214 ms for
`--prefer-offline` (204–282 ms) and 220 ms for `--offline` (198–275 ms).
The ranges overlap. Keep `--prefer-offline` so cold stores and new packages
work. The first SSH install's policy metadata was copied into the persistent
cache after timing exposed it outside the store; later runs mount that
metadata directly. The temporary lockfile commit added `is-number@7.0.0` to
one package, then was removed. No image build occurred for that change.

Two concurrent SSH containers installed against the same pnpm store and runtime
lock directory. Both checked that their uid matched the store owner. The image
contained no workspace manifest or node_modules.
The same uid check initially exposed Quint's warmed downloads behind the base
image's private `/home/pwuser` directory. The toolchain makes that directory
readable and searchable by other job uids. Timings above precede this permission
fix. After rebuilding, the Rust evaluator and Apalache both passed a one-step
model check as the laptop's uid 1000, using the warmed downloads.
The final Namespace image also passed the app plan. That fresh machine had a
cold store: install took 70 seconds, including a 67-second registry request
while checking supply-chain policies. Total wall time was 203 seconds, including
the 42.6-second image build and push. The laptop's permission-fix rebuild took
46.4 seconds. These follow-up checks show why the initial timings are observations,
not a reliable estimate for every cold run.

Namespace saved a 1,666 MB cache generation. Its first follow-up fresh machine
missed the cache and installed in 15 seconds; a later fresh machine restored
it and installed in one second. Cache misses during distribution are expected,
as described in [Namespace's cache lifecycle](https://namespace.so/docs/architecture/storage/cache-volumes).
The two measurement cache tags were released. The common toolchain remains the
default: warm installs cost at most one reported second, and these app plans
show no clear Namespace regression that would justify a separate full image.

Reproduce the workloads, one command at a time:

```sh
JUNO_REMOTE_MAX_VCPU=0 pnpm remote test --passWithNoTests test/messages.test.ts
JUNO_REMOTE_MAX_VCPU=0 pnpm remote test:plan test --passWithNoTests test/messages.test.ts + test:desktop e2e/app.spec.ts
JUNO_RUNNER_HOST= pnpm remote --fresh test --passWithNoTests test/messages.test.ts
JUNO_RUNNER_HOST= pnpm remote test:plan test --passWithNoTests test/messages.test.ts + test:desktop e2e/app.spec.ts
```

For Namespace, use a new `JUNO_REMOTE_STORE_TAG` for a cold store, reuse that tag
on a fresh machine for a cache hit, and omit `--fresh` for a warm pool machine.
`JUNO_REMOTE_IDLE_MINUTES=0` destroys a measurement machine after its run.
`JUNO_REMOTE_STORE_CACHE=off` on a new machine measures the machine-disk fallback. Cache hits are
best effort; check pnpm's reused and downloaded counts before calling a run warm.

## Current cost controls

The defaults are 48 vCPU in the workspace (at most about $2.88 an hour with every
machine busy; approved by the owner on 10-17), two idle machines per shape and eight
idle minutes (since 10-16; before, one machine and one minute). `JUNO_REMOTE_MAX_VCPU=0` refuses Namespace runs before an image build.
A request larger than the cap fails instead of waiting forever.
`JUNO_REMOTE_IDLE_MINUTES=0` destroys a machine immediately on release.
These settings never reclaim a machine with a live owner. Releases record their
own idle window. The pool upgrades the old background reaper so its five-minute
policy does not survive a code update; it verifies the reaper command before
sending it a signal.

The idle policy trades idle vCPU-minutes for warm starts. A new 8x16 machine
costs about 20 s to create and 37 to 145 s to pull the image (logs from 10-16),
that is 8 to 22 vCPU-minutes and one to two and a half minutes of wall time per
run; a warm one starts in about 4 s. Two idle 8x16 machines for eight minutes
cost at most 2 x 8 vCPU x 8 min = 128 vCPU-minutes (about $0.13) after the last
run of a busy spell. The bound per hour is 2 x 8 x 60 = 960 vCPU-minutes (about
$0.96 an hour) if both machines sat idle the whole hour, which needs runs that
arrive less than eight minutes apart and never use them. In practice a machine
is idle only between runs, at most 64 vCPU-minutes per run. Before, one idle
machine per shape for one minute cost at most 14 vCPU-minutes per spell, but
most runs paid for a new machine. Idle machines count against the cap, and a
run that needs room destroys idle machines of another shape first.

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

`pnpm remote test:desktop` runs on one machine and builds the app once. `--shards n`
splits it across n machines; each returns a blob report and the parent merges them
into `.remote/shards-*/html`, and a failed shard or missing report fails the parent.
`test:e2e` runs the desktop e2e and then the gallery on one machine.
`pnpm flake` keeps its repetition semantics instead of splitting its selected tests.

Configure `~/.config/juno/runner.json` on the Mac with `host`, `port`, and `key`
to prefer an SSH runner for every agent, including `pnpm affected` and
`pnpm verify:main` plans. `JUNO_RUNNER_HOST`, `JUNO_RUNNER_PORT`, and
`JUNO_RUNNER_KEY` override file values. An empty `JUNO_RUNNER_HOST` selects
Namespace. The real host and user belong only in the machine-local file.

The SSH runner uses `juno-toolchain:<tag>`. The tag hashes `scripts/remote/Dockerfile`
and the root manifest's Quint pin, so changing the lockfile does not rebuild it.
A missing tag is built on the runner under a host build lock. No `nsc` or
Namespace registry access is needed on the runner. Each run installs with
`--frozen-lockfile --prefer-offline` against `~/.cache/juno-runner/pnpm-store` (including pnpm metadata),
checks Bun's version and reports `remote: workspace installed in N s`.
Electron downloads use `~/.cache/electron`. Containers use the host uid and
share pnpm's runtime locks. Cache ownership must match that uid.
`JUNO_RUNNER_IMAGE` selects a full preloaded image and skips the install.
`pnpm runner:check` reports a missing local tag without failing, and
`pnpm runner:prune` removes old full-image and toolchain tags and unused build
cache while keeping the selected image. It leaves dependency caches alone.
Docker refuses removal of images referenced by containers.

An unreachable runner falls back to Namespace. For `.local` hosts, SSH tries IPv4 first and falls back to dual stack if the transport cannot connect. The successful family is reused for the job. This avoids a five-second stall on the laptop's advertised but unreachable IPv6 address. Authentication and connected-host failures still stop the run. After the image is ready, a job
waits at most 60 seconds for runner cores before falling back. With
`JUNO_REMOTE_MAX_VCPU=0`, it waits without a deadline and never allocates
Namespace machines. SSH authentication errors, broken Docker, failed builds,
and failed tests return an error without fallback. A runner job does not start
the Namespace warm pool or daemon. Without a configured host, Namespace remains
the default. Setup and a standalone Windows prompt are in
[Set up an optional SSH runner](self-hosted-runner.md).

## Hunting a flaky test

`pnpm flake <spec...> [-g <title>] [--repeat 40] [--machines 2] [--workers n]` runs the specs (all under `apps/desktop/e2e` or all under `apps/gallery`) through `pnpm remote` with Playwright's `--repeat-each`, no retries and traces kept on failure. The repeats are split across the machines (at most two, so other agents keep theirs), and each machine runs its usual number of workers, so the tests run under the load of a normal remote run; `--workers` raises it. It ends with one line, `flake: 2 of 160 failed`, and the names of the failing tests. Traces are in `.remote/<run>/`; `pnpm exec playwright show-trace <trace.zip>` opens one. For the gallery's shift and focus-ring walks, each repeat walks every state again, and `GALLERY_SHIFT_ONLY=MediaViewer pnpm flake apps/gallery/shift.spec.ts --repeat 20 --machines 1` limits the walk to those components.

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

- **A preference lost on quit.** The renderer sends `prefs.set` without waiting for it, as Hide on the welcome card does. A window's close ended the engine's fibers for that port, and quitting killed the engine at once, so a write that was still waiting for the database was dropped and the card came back on the next launch (the welcome test that hides it and quits at once, 3 of 15 at 16 workers). `prefs.set` is now uninterruptible, and on quit main sends `quit` and waits for the engine to close its scope and exit, killing it only after 3 s (`EngineSupervisor.stop`).

- **A menu closed by Home's field.** Home's field takes focus when it mounts, and a popover closes on focus outside it. At launch the sidebar can show before Home, so the account menu opened then closed as Home came in, and `expectSignedIn` found no session line (2 of 30 at 16 workers, once the quit above was fixed). The field no longer takes focus from an open menu or dialog outside its Home (`inOpenMenu` in `containers/HomeComposer.tsx`).

- **Boxes measured before the web fonts.** A gallery test that compares boxes must wait for the fonts, as `openState` in `apps/gallery/support.ts` does. In a fallback font the Home title is 37 px wider and each meta line 2 px taller.

- **An image that failed after the state looked drawn.** `AttachmentCard/failed-image` draws its preview's box, then the image fails to decode and the card removes the box, as unfurls do (decision 10-16, avatars-unfurls): the footer moves up 197 px. That happens on every open, about 15 ms after the frame shows; under load it landed in the shift guard's first hover, which reported the footer going from `0x0` to drawn (3 runs on 10-17, on the Mac and on Linux; 0 of 20 walks on a quiet machine). `openState` now also waits until the frame's images have loaded or failed, and two frames, before a test touches the state. The held Avatar photo and lazy images out of view are not waited for.

- **A row remembered in a fallback font.** The gallery's index uses system fonts, so the first state a page opened was laid out in a fallback font. `openState` waited for the fonts, but a message row already off screen stayed skipped by `content-visibility` at the size it had in the fallback font (53 px for 52) until Chromium laid it out again, during a later hover: the TourScene thread failed the shift guard in 26 of 1300 tests at `--repeat 20`, each time with that row 659 px below the visible part of the list. The gallery now loads its fonts before its first render (`apps/gallery/src/main.tsx`). To tell a stale remembered size from a real one, compare the row's height with its children's: a skipped row's children are laid out when read, the row keeps its remembered size.

- **A dropped first value in a live query trigger.** `notifications.status` dropped the first value of the presence stream as if the first run had already read it, but the two start together. When the launch schedule set presence in between, the menu never learned it and "Set yourself away" did nothing visible (103 of 300 runs, 8 workers). A trigger that carries state must not drop its first value.

- **A row drawn at its estimate next to a held row.** When an older page went in above the rows in view, its rows were laid out at their size estimate; the one between the top of the view and the held row grew a frame later and moved what was on screen (the long-thread topic test, 12 of 200). The page's rows above the held row are now laid out in full (`eagerRows` in `containers/topic/scroll.ts`).

- **A test marker made of digits.** The backup test that removes a message checked that no table of the restored database held the message's marker, `4417`. Timestamps and uuidv7 ids can hold those digits too: one run had `applied_at` 1792287544170 in `schema_migrations` and `created_at` 1792287544178 in `incarnations`; another had it in `incarnations`, `messages` and `inbox`, whose rows hold timestamps and the incarnation id. No removed text survived the purge. The marker is now a word with letters outside hex (`quokka`), which no number or id can contain. Search a database for a marker of letters, not digits.

- **A menu command sent without its key.** `tabs.menu` clicks the item through main, which reaches the renderer over IPC, while `keyboard.type` goes straight to the page, so keys typed at once could arrive before the command. A real ⌘N cannot do this: its keydown reaches the page first and starts holding keys (`holdKeysAfterNewShortcut`). The ⌘N typing tests lost "m" to the old field 3 of 60 runs. Key presses in tests never reach Electron's menu accelerators on Linux, so `tabs.shortcut` sends the keydown to the page and then clicks the item.

- **A conformance round reached while the engine still worked.** A replay round counted as reached once the projections had been equal for 300 ms. On a loaded machine the reconnect's catch-up, whose reads are not gated, could outlast that and store the post or its copy after the next step the harness drove, and a `disconnect` round could end before the engine had seen the drop, so it still claimed the next send. The engine was ahead of the model each time (`offlineSend` at `accept(1)` and `outbox-random-1` at `resend(2)`: 10 failures in 40 loaded passes of every trace on main, with or without grammar-chips-1017; none after). A round now also waits until no sync cycle runs, and `connected` compares the engine's view of the socket too (`busy` and `observeConnection` in `packages/engine/test/conformance/`).

- **A scroll set from a script is not the user's.** The topic list lets go of its hold on the bottom on the user's input (wheel, touch, key, pointer). A test that sets `scrollTop` gives no input, so a commit that adds rows before the scroll settles (the rest of the window, just after an open) puts the bottom back. `TopicPane.scrollUp` turns the mouse wheel over the list instead. Install a `scrollend` listener and await that before the wheel turns: the wheel reaches the page by another path than `evaluate`.

- **A source-link jump kept the bottom hold until `scrollend`.** A reply committed before that event pulled the topic back to the bottom. A source jump releases the bottom hold before calling `scrollIntoView`. It lays out the rows around the target before measuring it, then holds the cited row in place. The e2e test defers `scrollend` until a reply is drawn and requires the cited row to stay at exactly the same vertical position.

- **A source jump before the rest of the topic was drawn.** A topic draws only the rows near its open position in the first frame and the rest in a transition (`drawnAll`). The source jump ran once the message was in the window, found no row for it, and nothing ran it again, so the jump was lost. Under load the transition took over a second, longer than the Juno answer took (9 of 40 runs at 16 workers). The jump now runs again when `drawnAll` turns true (`useMessageFlash` in `containers/topic/position.ts`).

- **Background AI jobs racing a test.** Tests run the fake AI, and with AI assist on by default the title, art, Home and Automated jobs ran in every test: an AI title replaced the fallback a test expected, and the title job's `topic_overlay` row broke a test's own insert. These jobs are now off in tests (`EngineConfig.aiJobs: false`) unless a test opts in: `test.use({ aiJobs: true })` or `launchApp(..., { aiJobs: true })` in the desktop e2e (`JUNO_E2E_AI_JOBS`), `bootedEngine(..., { aiJobs: true })` in the engine tests. With them off, the Automated job still places channels by its rules and asks on Home about the rest, as with AI assist off. Interactive AI (send checks, grammar, ⌘K, the Juno agent) is not affected. The jobs had also slowed the engine enough to hide a timing assumption: in the 429 storm test the gap landed after the layout probe's window, and without them it lands inside it, so the probe now skips the sidebar list's own moves.

- **A copy's delete retried inside its call across a socket drop.** `SlackApi.call` retries `internal_error` itself, and each try runs the copy check again. A try that came after the reconnect, before the catch-up ended, kept the copy as not rechecked, so the duplicate stayed (5 of 100 remote, 20 of 30 on a loaded Mac). The check now leaves the row waiting for the catch-up, as the worker's pass does (`actionWorker.ts`).

- **A command that cancelled a topic open.** A topic open applies once the topic can paint (`show` in `navigation.ts`). ⌘J right after the click still saw the Juno tab, opened it again, and that change cancelled the waiting open: the topic never showed (1 of 80 at 8 workers). The Juno shortcuts now decide after the navigation already asked for (`afterNavigation`).

- **A failed video's controls.** In the gallery the fixture video never loads, and Chromium reported its controls moving inside the video as a `layout-shift` entry with no sources (value under 0.001) when a press on the filmstrip was released (16 of 20 repeats of the MediaViewer walk). No page element's box moved. The guard now counts an entry with no sources as no shift while a video with controls is under the frame, or was when the action started.

- **A list item read at its threshold.** Home shows "moved a lot" from `MOVED_A_LOT_MIN` (8) new replies, so a test that injects nine and waits for the item can read it at eight. Wait for the value the test asserts.

- **An older page that landed after the jump to the bottom.** A topic that opens at the "new" divider near its top asks for an older page at once. Under load the page landed after `toLatest` had reached the bottom, and `useOlderPages` replaced the bottom pin with a pin on the row in view, so the list stopped holding its end: the composer grew and the last message went 88 px out of view (2 of 40 at 24 workers, 12 of 40 with logging). The page now leaves a bottom pin alone (`older.ts`). The composer test also waits for the observer's first look before it types and for an entry at the smaller height, rather than counting frames.

- **A box read while a node was replaced.** `locator.boundingBox()` finds the element, then measures it in a second step. When the New chat tab became the topic, the topic's composer replaced its placeholder slot (`ComposerSlot`) with a new node; a read that found the slot and measured it after the swap got `null` (2 of 20 at 16 workers). Every frame still showed one field in the same place. To check what the user sees through a change, record the boxes on every frame (`recordBoxes` in `apps/desktop/e2e/shiftProbe.ts`); to read one box, poll until it is there.

- **A draft that a send check could stop.** A Main draft that shares two words with a thread gets "Looks like a reply to" on Enter only if the typing pause's check (400 ms) has answered by then, so the same test sometimes sent and sometimes showed the bar (1 of 20). A test that is not about the check uses a draft that matches no thread; one that is waits for the answer (`routeAnswered` in `send-checks.spec.ts`).

- **A product window shorter than the test's own steps.** A new read mark waits 400 ms and later marks replace its intent, so marks in quick succession make one call. The test sent five marks one after another and expected one call, but on a loaded machine the five round trips took up to 1.2 s, and a second call is then correct (3 of 20 at ten busy processes per core, each run whose five marks took over 600 ms). The test now sets a 3 s window (`markDelayMillis`, tests only) and checks that the five marks fit in it. A test of a time window must make its steps fit the window by construction, not by speed.

- **A boot wait sized for the small seed.** `bootedEngine` waited 30 s for `live`, which the default seed reaches in 0.5 to 2.6 s even under load. The large-seed cold boot test reaches it in 2 to 5 s quiet, 7 to 23 s at four busy processes per core and 14 to 75 s at ten, so it timed out in plan runs at 97 to 99% busy. It now waits 90 s (`liveMillis`).

- **A speed budget asserted inside a loaded plan.** `quick-start.spec.ts` failed its 5 s sign-in-to-rows budget in a plan at 96% busy. On a quiet remote machine it takes about 2.7 s, the same before and after the tour (10 runs each: 2,687 to 2,738 ms at `480da939^1`, 2,681 to 2,782 ms at `480da939`). Budgets belong to `perf.spec.ts` on the Mac; the e2e test keeps the flow with a ceiling and records the time.

- **A style change read before the next frame under reduced motion.** The gallery runs with `reducedMotion: 'reduce'`, and `global.css` then gives every element `transition-duration: 0.01ms`. Their `transition-property` is `all`, so any change to a box that is already drawn becomes a transition that ends only on the next animation frame. `placeToolbar` reads the row's styles as the row turns `:hover`, so the toolbar's slot is already shown when the flip below the row is written; a read before the next frame found the toolbar still above the row, at 42 px (`toolbar-geometry.spec.ts`: 6 of 250 runs with `pnpm remote test:gallery toolbar-geometry.spec.ts --repeat-each=50`, then 0 of 250 and 0 of 1,000 with `transition-property: none` on the slot). `pnpm flake` did not show it in 1,300 runs: it records a trace, and the trace's snapshots wait for frames. To hunt a flake that depends on frames, run `pnpm remote test:gallery <spec> --repeat-each=<n> --retries=0` without a trace. The same hunt found a real bug: the toolbar's place was decided only on `pointerenter`, so a row that scrolled under a still pointer kept it; the row now decides again on `pointermove` and the list's `scrollend`.

- **A sidebar row moved between the read of its box and the press.** Rows sort by latest activity. A test that injects a message and then opens that row read the row's box before the engine moved it to the top, so the press landed on the row that took its place: `partial thread waits for history at bottom` opened another topic (1 in a plan run at 85% busy; 0 of 20 at 16 workers, where the move came 34 to 161 ms after the inject and the pointer reached the row 107 to 406 ms after the move). `SidebarRow.select` now waits until the row's box is the same on two frames and points again if it moved under the pointer, and a test that has just moved a row waits for it (`sidebar.expectTop`). The tests that measure the first sync must also let the list settle: the quick start paints #alerts-prod and #deploys, which leave for Automated as their history lands (in 20 of 20 tour runs, 110 to 690 ms after the first paint; in 2 of 20 runs of the cold sidebar test), and the sync card leaving at the end makes the list 77 px taller. The tour waits for the sync to end before its layout check, and the cold sidebar test starts its probe once the bot channels have left.

- **A send dropped while an image was still being read.** The Juno chat reads an attached image in the renderer before its chip is ready, and its send returned without a word while any chip was in that state. The line under the files shows as soon as the file is attached, so a test (or a user) that pressed Enter right after it lost the send, and the words stayed in the composer: the text-only model test waited 15 s for a reply that never came (1 of 40 and 2 of 80 at 16 workers, 0 of 80 after; Enter came 11 ms after the line). The send now waits for the read of an image Juno takes and leaves out one that stays (`takeForJuno` in `containers/juno/junoFiles.ts`). When a send does nothing, read the page snapshot in the failure's `error-context.md`: words still in the composer mean the renderer refused it, not the agent.

- **A count that changed digits in its fixed box.** Home's syncing line right-aligns the count in a box as wide as the total's digits (`HomeSyncLine`). When the count goes from 9 to 10, the text starts one digit further left in a box that stays put, and Chromium reports a `layout-shift` entry (value 0.0000028) whose only source is that box, with the same box before and after. `expectStableAnchor` failed the Home first-sync test on it (28 of 30 at 16 workers; in 9 of them the same entry also named a sidebar row the test skips, which kept the region filter from dropping it). The probe now drops the sources inside `outside` and counts an entry only if one of the rest moved, as the feel suite's `noLayoutShift` does; an entry with no sources still counts (0 of 30 after).

- **A toast shown before the live query that a menu reads.** A command replies before its change reaches the renderer's live queries, and `runAction` showed the toast on the reply. After "#alerts-prod: Never", the test right-clicked the row while `notifications.settings` still held the old level, so Notify me showed When it matters (2 of 30 runs, 16 workers). The app now waits for the settings to hold the new level before the toast (`shown` in `runAction`, up to one second), so the toast never names a change a menu cannot show yet (0 of 30).

- **A Home send dropped by a tab switch.** Enter on Home to a channel's or a person's Main waits for the wrong-place check (at most 250 ms) before it sends. A hidden tab is an `Activity` in hidden mode, which runs its effects' cleanups, and Home's cleanup cleared the check's token, so a tab chosen before the check answered dropped the send: nothing was posted and the draft stayed in the hidden Home. The break-pass test sends a DM and at once chooses the Maya tab, so under a full suite's load the switch came first (about one affected run in four; 0 of 100 alone at 24 workers and 0 of 260 in a loaded plan). The token is now cleared only when the text or destination changes (`useHomeSendChecks`), and `home-send-tab.spec.ts` chooses another tab in the same task as Enter (5 of 5 failed before, 0 after). The send trace (`apps/desktop/e2e/README.md`) showed it: a `switch` and no `send asked`, and no post in `posts`.

- **A new tab that cancelled a topic open.** ⌘T and "+" asked for their tab as a replaceable change, so a topic still waiting to paint in the current tab was dropped and that tab stayed where it was. The same break-pass test opens #eng, then Maya with ⌘-click, then a new tab; with the Home send fixed it failed 3 of 100 at 24 workers this way, the send trace showing `tabs dropped` for #eng's open. A new tab is no longer replaceable, as a topic's new tab already was, and `show` applies a change that is not replaceable even when it waits for no topic. `tabs.spec.ts` clicks "+" in the same task as the press on a row (5 of 5 failed before, 0 after).

- **A click that found an element the next render hid.** The emoji picker searches a deferred copy of the query, so for one render after `fill` the browse grid is still shown and its `:rocket:` matches the search's button name. Under load `click()` resolved that one, far down in a skipped section. The results then rendered and the grid got `hidden`, and Playwright kept checking the node it had found, which is still connected, so it waited 30 s on "element is not visible" while the result sat on screen (`chat-reactions.spec.ts`: 7 of 20 at 16 workers; a log in the page showed the result visible within 200 ms and the locator, read again, matched only it). Tests now pick from `[data-emoji-results]` (0 of 20). A locator that can match a node a coming render hides should name the part that only exists once the render is done.

- **A card button pressed while Juno still answered.** The remove card shows with the status bubble (40 px) under it, and Juno's "Done." (56 px) takes that bubble's place about 70 to 100 ms later, so the chat, held at the bottom, scrolls 15 px. `click()` had measured the button before the scroll and pressed its old centre after it, 0.06 px below the button's new bottom edge: `pointerdown` went to the card's inner `div`, and `onCard` never ran (`memory.spec.ts`, 1 of 20, then 2, 5 and 3 of 40 at 16 workers; a log in the page showed the event's target was the `div` while `elementFromPoint` at the same point still named the button). This is a chat taking a reply under the pointer, as SPEC 13.2 asks, not a lost click. The test now waits for the second "Done." and for the status bubble to go before it presses Remove (0 of 40). To press a button in the chat, wait until the run that drew it has ended. A target that `pointerdown` names and `elementFromPoint` does not means the point was measured before a move.

## Machine shapes

Both backends now use the same toolchain and install per run. The [toolchain and store measurements](#toolchain-and-store-measurements) compare fresh and warm runs with the earlier full image. Namespace worker counts and machine reservations are unchanged. Namespace requests a 4 GB dependency cache, with 1,666 MB used in these slices.

SSH reserves 4 cores for wide unit-only jobs (CPU limit 4), 1 for narrow unit jobs (CPU limit 2), 3 for gallery jobs without desktop or e2e steps, and 4 for jobs with desktop or e2e steps, as described under "Remote runs". Both `--machine` and `JUNO_REMOTE_MACHINE` override the reservation and limit.

One full laptop unit run on 2026-10-19 with the wide sizing
(`JUNO_REMOTE_MAX_VCPU=0 pnpm remote test`) passed: 4 reserved cores, CPU limit
4, 325 s script time and 328.53 s wall time. Two packages used two Vitest
workers each; the image and store were warm. CPU busy averaged 50% and peak
container memory was 1.54 GiB including file cache. See
[the measurement scope](self-hosted-runner.md#laptop-measurements).

SSH laptop measurements on 2026-10-19 (24 threads, 30 GiB RAM), one successful
sequential run per size, with the image present:

| Work | 8 cores: script / CPU busy / peak GiB | Earlier reduced size: script / CPU busy / peak GiB |
| --- | --- | --- |
| App plan: 54 unit tests and 21 desktop tests | 72 s / 41% / 4.07 | 4 cores: 86 s / 72% / 2.76 |
| Unit files: 54 tests | 46 s / 11% / 1.25 | 2 cores: 46 s / 44% / 1.21 |
| Gallery shift slice | 33 s / 36% / 2.65 | 4 cores: 38 s / 57% / 1.85 |

These measurements predate the new reservations. CPU busy is relative to the
Docker CPU limit. Peak memory includes the container's file cache; script time excludes setup and report download. At 4 cores the
app plan used two desktop workers and one unit worker; the standalone gallery
used three workers and shift parts. At 2 cores the unit job used two workers
in one package. All tests passed without test retries. The owner chose to lend
16 of 24 threads, leaving eight for the desktop: 4 app plans, or 5 gallery jobs,
or 4 wide unit jobs, or 16 narrow unit jobs fit at once. At the earlier measured
slice peaks, four app plans use about 11.04 GiB, five gallery slices 9.25 GiB,
and sixteen narrow unit slices 19.36 GiB, below the roughly 24 GB job budget.
16 is the owner's choice, not a memory-derived limit. These are sequential
slices, not a concurrent full-suite test.
See [the commands and measurement scope](self-hosted-runner.md#laptop-measurements).

Namespace runs every script on one standard shape, 8x16 (`standardShape` in `scripts/remote.mjs`; `--machine` overrides). With one shape a free machine fits any waiting run and a warm machine is reused by the next run whatever it runs, so the pool does not fragment. Six 8x16 machines fit the 48 vCPU cap, so six plans run at once; 16x32 would fit three. `pnpm affected` and `pnpm verify:main` send their remote suites as one plan (`test:plan`), and the desktop e2e is not sharded.

A typical UI change, before and after (`packages/views/src/Composer.tsx`: the gallery for six components and the whole desktop e2e, 380 tests), measured on 10-16 and 10-17 while other agents' runs were queued:

| | Before: five 4x8 machines (four desktop shards, the gallery) | After: one 8x16 machine, one plan |
| --- | --- | --- |
| vCPU asked for | 20 (two runs at once needed 40, above the 24 vCPU cap then) | 8 (three runs fit in 24 vCPU, six in 48) |
| Queue wait | 52 to 230 s per job | 278 s, behind other agents' 4x8 jobs |
| Start-up | 4 s warm, 85 s on a new machine | 41 s on a new machine (37 s image pull), about 4 s warm |
| Script | shards 95 / 107 / 178 / 204 s, gallery 102 s; each shard builds the app | 369 s: gallery 103 s, then desktop 266 s with one build (about 20 s) |
| CPU busy | 37 to 70% per machine | 61% on average, 83% at the median |
| Wall time | 381 s | 687 s with the wait; about 410 s without it, about 375 s warm |
| Machine time | 60 vCPU-minutes | about 56 vCPU-minutes |

On an idle pool one run is slower than five machines at once (about 375 s warm against about 210 s), but it asks for 8 vCPU instead of 20, builds once, and fits beside two other runs, where before a second run waited for the first. Two runs at once were not measured before merging; measure them on main. Running the gallery beside the desktop e2e on the same machine took 317 s but failed three tests (one gallery cursor test, two desktop timing tests) at 95% median CPU, so the app suites run one after another.

**Lanes side by side** (10-17). A plan originally ran the app suites in one lane and the unit tests and spec checks in another, at the same time (`scripts/plan.mjs`). With each suite's own worker count the machine was far past full: busy time stops at 100%, so the remote run now also prints the runnable tasks per core and the kernel's CPU pressure (the share of time some task waited for a core), with a 30 s timeline. The 10-17 split gave the app lane 5 desktop or 8 gallery workers on 8 cores, and beside it vitest with 4 workers and one package at a time, then spec checks with 2 jobs and one Apalache. The table below records that two-lane plan. The current three-lane plan uses the worker counts under "Plans" above. A step's own `KEY=VALUE` words still win; a suite run alone keeps its own counts. The full `verify:main` plan on one 8x16, one commit:

| Workers | Script | Busy, average | Runnable per core, median | CPU pressure, median | Failed |
| --- | --- | --- | --- | --- | --- |
| Each suite's own (desktop 8, gallery 24) | 534 s | 92% | 4 to 7 | about 85% | 2 layout-shift tests |
| Desktop 6, the rest unchanged | 560 s | 93% | 3 to 7 | about 80% | the codex removal test |
| Desktop 6, gallery 12, the other lane smaller | 540 s | 82% | 2.2 | 58% | the chat-cache benchmark |
| Every suite one after another, desktop 6 | 625 s | 72% | 1.4 | 30% | none |
| Desktop 5, gallery 8, the other lane smaller (the default) | 564 s | 79% | 1.6 | 42% | none |

Alone, the gallery at 3 workers per core still ran 5.5 runnable tasks per core; the desktop suite at 6 workers ran 2 to 3. Most failures reported from plan runs on 10-17 were waits that a loaded core made late (layout-shift probes, 1 s polls, the conformance replay's settle time, the chat benchmark).

Earlier measurements, with a shape per script (2026-10-15, TypeScript 7; "script" excludes start-up):

| Script | Shape then | Script time |
| --- | --- | --- |
| `test` | 2x4 | 262 s in the full suite; 156 s on 4x8 |
| `test:gallery`, every component | 8x16 | 132–146 s at 78–87% busy; 215 s at 73% on 4x8 |
| `test:desktop` | four 4x8 machines, 3 workers each | 83 / 187 / 112 / 82 s; 37–66% busy; 30.9 script core-min total |
| `specs:traces` | 8x16, eight jobs | 132 s at 97% busy; 333 s at 98% on 4x8 |
| `specs:check`, nothing cached | 8x16 | 126 s (214 s on 4x8, 82 to 100 s on 16x32) |

Standalone SSH workers follow `JUNO_RUNNER_JOB_CORES` (`scripts/remote/workers.sh`): Vitest uses two workers in one package at a 2-core limit; at limits of 4 or more, two packages divide the worker budget equally (two workers each at 4 cores). Desktop uses two workers at 4 cores, gallery three workers and shift parts at 4 cores, and Quint one simulation per two cores and one checker per four, at least one each. Plan lanes use the smaller counts under "Plans" above. Namespace keeps its existing standalone workers: vitest at least four workers, two unit packages at a time, with the agent timing project run afterwards on 2-core machines, Electron one per two cores, one per core from eight cores, except three workers on each 4-core desktop shard, the gallery three per core, spec simulations one per two cores beside one Apalache server per four, except trace-only runs use one job per core without Apalache. `pnpm remote --shards n` also splits the gallery (each machine takes every n-th state) and the spec check across n machines; it costs about the same and is not the default.

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

Tests, e2e runs, gallery shots, benchmarks and spec checks spawn many processes. Several agents often work in separate worktrees on the same machine, so the root scripts (`pnpm test`, `pnpm test:e2e`, `pnpm test:feel`, `pnpm test:gallery`, `pnpm gallery:shots`, `pnpm specs:check`, `pnpm test:agent-contracts`, `pnpm test:agent-testing`) run through `scripts/heavy.mjs`. It takes a machine-wide lock in the system temp folder, shared by every worktree, and waits for a free slot. There are two slots by default (`JUNO_HEAVY_SLOTS` changes it). On the Mac, `--electron` also takes a single shared app-launch slot. `test:desktop`, `test:e2e`, `test:gallery` and `gallery:shots` use it, so only one of these jobs runs at once. Ordinary jobs can still use both slots, or run beside one app job. An app job waiting for the app-launch slot holds no general slot. Timing runs (`pnpm perf`, `pnpm test:feel`) pass `--exclusive`, which takes every slot and stops new jobs from starting while it waits, so their numbers are not skewed by another run. Release packaging passes `--priority release` with `--exclusive`: it moves ahead of all queued jobs while it waits for active jobs to finish, without interrupting them. Use `node scripts/heavy.mjs --status` to see holders and queued commands, PIDs and wait times. The wrapper sets `JUNO_HEAVY_HELD` for its child; nested heavy commands run within the parent's reservation and cannot deadlock waiting for a slot the parent holds. Running a package's tests directly bypasses the queue, so prefer the root scripts. `pnpm test:health` and `pnpm test:remote-pool` skip the queue: they are small Node tests that should not wait behind perf or package runs.


## Releasing

The release target is macOS Apple Silicon. `pnpm package` builds the app, rebuilds
native dependencies for Electron, and writes the DMG, its block map and
update metadata (`latest-mac.yml`) to `apps/desktop/release/`. It never
publishes; `pnpm release:publish` does (below). Developer ID signing and notarization require the explicit `JUNO_RELEASE=1` switch; without it,
the build prints one unsigned-build line and disables identity discovery.
The package runs through the machine-wide heavy lock. A signed build also makes
a ZIP and its block map: electron-updater's Mac installer requires the ZIP.
Unsigned installs from 0.1.1 onward read the release's asset list themselves
and download the DMG, so they need neither a ZIP nor a ZIP entry in
`latest-mac.yml`. The metadata still names the DMG for signed builds and for
release validation.
On Apple Silicon, electron-builder repairs the local **ad-hoc** signature after
flipping fuses. This uses no certificate or credentials and does not grant
Gatekeeper trust. A literally unsigned ARM64 executable is killed by macOS;
"unsigned" here means without Developer ID signing or notarization.
This ad-hoc signature has no hardened runtime and no entitlements; only the
`JUNO_RELEASE=1` build applies them. Without Developer ID signing, the first
launch after each update makes macOS ask for the "Juno Safe Storage" keychain
item: once if the owner chooses Always Allow, twice per launch if they choose
Allow ("Keychain prompts" above).

The engine and agent use Electron's built-in `node:sqlite`, so there is no SQLite
addon to rebuild. `npmRebuild` is enabled for future native dependencies; `.node`
files and koffi are explicitly unpacked. koffi (main's screen watch, ADR 0015) is
a Node-API module, so it needs no rebuild per Electron version; its prebuilt
binary comes from `@koromix/koffi-darwin-arm64`, its install script is denied in
`pnpm-workspace.yaml`, and its C++ sources and docs are left out of the app.
Only `electron-updater`, koffi and their runtime dependencies ship as node_modules; application dependencies are bundled by Vite.
Source maps are excluded. Codex uses the separately installed `codex` executable;
its unused vendor binaries do not ship.

Only English Chromium locale packs ship (`electronLanguages: [en, en_GB]` in
`electron-builder.yml`). Electron 44 has 220 `*.lproj` folders in its framework
(55 languages, each also in `_FEMININE`, `_MASCULINE` and `_NEUTER` forms) and
55 empty ones in the app's `Resources`, which tell macOS which languages the app
has. Juno's UI is English only. Measured on 10-18 with unsigned packages of
`65f9d7fd`:

| | All languages | English only |
| --- | --- | --- |
| `Juno.app` | 308.3 MB | 259.0 MB |
| Electron Framework `Resources` | 76.4 MB | 27.2 MB |
| DMG | 129.5 MB | 117.1 MB |
| ZIP | 129.5 MB | 116.8 MB |

What the packs held: Chromium's own strings (form validation messages, the
defaults for `<input>` and `<select>`, accessibility labels), and through them
the app locale, which sets `navigator.language`, the default `Intl` locale and
the spellchecker's default dictionary. Juno's menus, dialogs and context menus
use its own English labels and format dates with an explicit `en` locale, so
they do not change. Launched with `-AppleLanguages` and a fresh profile:

- **English (US) or another language with no pack** (German was checked): the
  app locale falls back to `en-US`, and Chromium's strings are in English, not
  blank. Before, a German Mac got German validation messages and German default
  formats (`So., 20:35`, `1.234.567,5`) inside an English app.
- **English (UK)**: `en_GB` is kept, so default formats stay British (`Sun 20:35`).
- AppKit's own items (the Services menu, Start Dictation, Emoji & Symbols, open
  and save panels) follow the app's languages too, so they are now English.
- The spellchecker on macOS is the system one and is not given a language, so
  it still checks what the user types in any language.

macOS never loads the gendered packs (`ui/base/resource/resource_bundle_mac.mm`
looks up only `<locale>.lproj`), so they are not kept. To add a language, add
its folder name to `electronLanguages`.

What else is in the bundle, kept on purpose: the Electron Framework binary
(201.5 MB); `libvk_swiftshader.dylib` and `vk_swiftshader_icd.json` (16.6 MB), the
software GPU used when the GPU is unavailable or blocked; `libffmpeg.dylib`
(2.3 MB) for audio and video; `icudtl.dat` (10.9 MB) for `Intl` and text
breaking; `resources.pak`, `chrome_100_percent.pak` (non-Retina screens),
`chrome_200_percent.pak` and the V8 snapshot; and Squirrel, Mantle and
ReactiveObjC, which the updater needs. Juno's own code is about 8 MB
(`app.asar` 6.8 MB, koffi's unpacked binary 1.2 MB).

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
- The updater's read token, `JUNO_UPDATE_TOKEN` at package time (Actions secret
  `UPDATE_READ_TOKEN`). It is a **fine-grained personal access token** with
  resource owner `triptu`, repository access **Only select repositories:
  `triptu/juno-releases`**, and repository permissions **Contents: Read-only**
  and **Metadata: Read-only** (Metadata is added automatically); nothing else,
  no account permissions. Give it no expiry, or a long one: installs carrying
  an expired token stop updating. `build/package.cjs` refuses a classic token,
  writes the token into the app's `update.json` and never prints it. Without it
  the app is built with updates unavailable. Keep it in a password manager or
  the Actions secret, never in a file in the repository. `JUNO_UPDATE_REPOSITORY`
  overrides the repository (default `triptu/juno-releases`).
- For CI uploads only: a release destination (`RELEASE_REPOSITORY=triptu/juno-releases`
  in Actions) and a token with **Contents: write** on it (`RELEASE_GITHUB_TOKEN`).
  Without a destination, CI only uploads Actions artifacts. Local publishing
  uses your own `gh` login instead.

Keep all credentials in the environment or repository Actions secrets. Never
commit certificates, keys, passwords or tokens. No secrets are needed for PR
lint/typecheck. Heavy checks run through `pnpm affected` on Namespace.

### Steps

1. Install Node 26, pnpm 12.11.2 and Xcode (including its command-line tools).
   Run `pnpm install --frozen-lockfile` and `pnpm affected`.
2. Set the version with `pnpm release:version` ("Versions" below). Build and smoke the
   local package with `pnpm package` and `pnpm test:package`. The smoke launches
   the executable directly, signs in to fake Slack, waits for sidebar rows,
   starts the agent against fake OpenRouter, and relaunches the cached account.
   It uses temporary data and never reads a real Slack session. Without a Developer
   ID signature, it applies `codesign -s -` locally and verifies the result. It
   measures five cached-account launches from process spawn to the renderer's
   first sidebar-row paint marker, reporting median and range. These are warm
   filesystem-cache runs with CDP attached, not a cold-disk benchmark.
3. For a local signed release, provide the variables above, then run
   `JUNO_RELEASE=1 JUNO_UPDATE_TOKEN=… pnpm package` (read the token from your
   password manager into the variable; do not type it into a file). electron-builder
   uses `notarytool` and staples the ticket. Partial release credentials fail the
   build. Verify with
   `codesign --verify --deep --strict apps/desktop/release/mac-arm64/Juno.app`
   and `xcrun stapler validate apps/desktop/release/mac-arm64/Juno.app`, then
   run `pnpm test:package` again. An unsigned release is the same without
   `JUNO_RELEASE=1`.
4. Publish with `pnpm release:publish --notes <file>` (below).
5. For CI, configure those repository secrets, commit the version, and create
   and push the matching `v<version>` tag. `.github/workflows/release.yml` runs
   on `macos-26`. Complete credentials enable signing and notarization;
   otherwise it builds unsigned artifacts. It uploads artifacts to a **draft**
   GitHub release in the configured distribution repository and will not modify
   an already published release. A CI draft has no changelog entry; add it to
   `CHANGELOG.md` in the releases repository before publishing the draft.
6. With a signed build, on another Mac install the prior signed build, opt into
   updates in Settings › About, publish the newer signed release, and check
   **Restart to update**. This cross-version check requires the owner's ID and
   cannot be verified by the unsigned smoke.

### The releases repository

`triptu/juno-releases` is private and holds only what the app may read: one
GitHub Release `v<version>` per version with the DMG, its block map and
`latest-mac.yml`, and `CHANGELOG.md`. The app reads it with the shipped
read-only token, so anyone with the app can read this repository; put nothing
else in it (ADR 0016).
Signed releases also carry the ZIP and its block map for in-place updates.

`CHANGELOG.md` has one section per version, newest first:

```
## 0.2.0 - 2026-10-20

- Peek shows the last reply.
- Fixed a crash on sign out.
```

The app shows these lines as plain text under "What's new"
(`apps/desktop/src/main/releaseNotes.ts` parses them). Write them for the person
using Juno, in the style of SPEC section 17.

### Versions

Versions are semver, kept in `apps/desktop/package.json` and tagged `v<version>`
in the releases repository. Set the next one with
`pnpm release:version patch|minor|major` (or an exact `x.y.z`) and commit it.
Before 1.0: **patch** for fixes only, **minor** for anything new or changed
that a user would notice. From 1.0, **major** for changes that drop data or
settings, or need a newer macOS. A pre-release (`0.3.0-beta.1`) is for testing
a build and is never offered to installs. Versions only go up: the updater
offers a release only when it is newer than the installed version, and
`release:publish` refuses a version that is not newer than every published one.

### Publishing

`pnpm release:publish --notes <file>` publishes the build in
`apps/desktop/release/` to the releases repository, with your own `gh` login
(`gh auth login`, with write access to the repository). No token is read or
written by the script. `<file>` holds this version's changelog lines, one per
line. The script:

1. checks `latest-mac.yml` is for the version in `apps/desktop/package.json`,
   that every file it names is there, and that the app contains `update.json`
   (a build without `JUNO_UPDATE_TOKEN` would never update again);
2. checks the version is newer than every published release and not already
   tagged;
3. creates a draft release `v<version>` with the DMG, its block map and
   `latest-mac.yml` (plus the ZIP and its block map if signed);
4. adds the section to `CHANGELOG.md` with today's date;
5. publishes the draft and marks it latest. Installs see it from now on.

`--dry-run` checks and prints the plan without changing anything.
`--prerelease` publishes a pre-release, which the updater never offers, and
leaves `CHANGELOG.md` alone; use it to test the upload, then delete it with
`gh release delete v<version> --repo triptu/juno-releases --cleanup-tag --yes`.

A normal publish uses a passing full-run record for the build commit or an
ancestor. Records live under the shared `.juno-status/verify-main/commits/`;
`verify-main.json` remains the latest summary for existing readers. A newer red
run does not erase an older green record. Only docs, tests and the app version
may change after the verified commit. The publish checkout must be clean.
`node scripts/release-gate.mjs <commit>` checks this without a build or upload.

The optional shared `.juno-status/release-waivers.json` is a short JSON array:

```json
[{ "id": "test-id-from-juno-tests", "reason": "Known intermittent focus race", "date": "2026-10-18" }]
```

Every waived failure is printed during publish. Legacy red records without a
complete test report cannot use waivers. Never infer a green record from a log.

Use `--urgent` only for a fix to a problem hurting the
owner now, such as a CPU spin, data loss or a crash on launch. It runs local
typecheck and lint, remote unit tests, and `pnpm test:package` against the
packaged app before publishing. It adds an `urgent` marker to the GitHub release
notes metadata and writes `.juno-status/ci-keeper-request.json`. The CI keeper
must run the requested full `pnpm verify:main --ref <commit>` immediately,
record the result, and clear the request; do not wait for the usual six-hour interval. An urgent publish is still a normal visible release.

`pnpm release:version`, `pnpm package` and `pnpm release:publish` print their
step durations and append them to `.juno-status/release-timings.json` (local,
gitignored): version bump, JS build, deploy, electron-builder, DMG, notarize
or skip, and upload. The electron-builder total includes the DMG phase.

### Scheduled releases

Schedule `pnpm release:scheduled` on the release Mac every six hours. Use
`pnpm release:scheduled --dry-run` to inspect the current refs, records and
GitHub release without fetching, building, committing or publishing.

The command fetches `origin/main` and chooses its newest commit covered by an
eligible full run. It does nothing if that source is already released, the last
release is under six hours old, or there are no user-facing changes. It refuses
to release an ancestor of the last released source. GitHub release metadata
records both the source and build commits; older releases use their
`Release x.y.z` commit on main.

A release gets a patch version newer than both the source and published version,
a worktree on the scratch volume, a version commit, packaging through the heavy
lock, and the packaged smoke with `JUNO_E2E_AI_JOBS=1`. Packaging uses release
priority when the installed heavy lock supports it. Notes use commit subjects
since the last release, omit test and merge maintenance, and group changes by
area. Keep product commit subjects plain enough to read as release notes.

The command uses the existing `gh` login and requires `JUNO_UPDATE_TOKEN` in its
environment. Supply it through the existing secure release setup, never in a
command log. It does not push main. The version commit remains on a local
`scheduled-release-x.y.z` branch; future versions use GitHub as their source.
A failed checkout and notes remain for the keeper to inspect. A successful run
removes its checkout. Only failures need keeper attention. After an interrupted
run, check the PID in `.juno-status/release-scheduled.lock` and GitHub before
removing a stale lock or resuming a draft.

Do not build or publish on every green run. Build an extra preview DMG only on
request. Milestone reviews remain at milestones; a pre-shipping review means a
minor release or 1.0, not every patch.

### Updates in the app

Updates are off by default and unavailable in a build without the token, in
development, and in tests (a test can point the app at a local fake with
`JUNO_E2E_UPDATE_SERVER`; see `apps/desktop/e2e/updates.spec.ts`). An enabled
install checks 30 seconds after launch and every six hours. Closing the app
does not install an update; only **Restart to update** does. Turning the setting
off cancels a download and hides the update line. Errors retry quietly later.
"What's new" fetches `CHANGELOG.md` only when asked and keeps it for an hour.

The token is used only in main (`apps/desktop/src/main/releaseFeed.ts`). It is
sent only to the API's origin: asset downloads redirect to a signed URL on
another host, and that request carries no token. electron-updater's logger is
off, update errors are swallowed without logging, and Juno has no crash
reporter, so the token cannot reach a log or report. A `GH_TOKEN` in the
environment is never used.

### Signing and what happens without it

macOS installs an update in place through Squirrel.Mac, which checks that the
new app has the same code-signing identity as the running one. An app with only
the local ad-hoc signature has no stable identity, so Squirrel.Mac rejects every
update: electron-updater can download the ZIP, but the update can never be
installed. Unsigned builds therefore do not try. When a newer version is
published, Settings › About says "Juno {version} is available" with
**Download the new version**, which downloads the DMG with the token into
Downloads and opens it. The owner drags Juno to Applications, replacing the old
copy; the data in `~/Library/Application Support/Juno` stays. macOS then asks
once for the "Juno Safe Storage" keychain item, and Gatekeeper asks before the
first launch of an app downloaded this way. A signed build falls back to the
same line if its in-place download fails.

Signed in-place updates need, all from the owner, all supplied privately:

- a **Developer ID Application** certificate with its private key, exported as
  a `.p12`, and the export password (`CSC_LINK`, `CSC_KEY_PASSWORD`);
- the Apple Developer **Team ID** (`APPLE_TEAM_ID`);
- for notarization, either the Apple ID with an **app-specific password**
  (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`) or an **App Store Connect API
  key**: the `.p8` file, its key ID and issuer ID (`APPLE_API_KEY`,
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`).

The first signed release must still be installed by hand from its DMG, since
the unsigned build before it cannot install it in place. From then on, signed
updates install with **Restart to update**.

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
hairlines pass. A `color-mix(` with a literal share is a raw colour; one whose
shares are tokens passes. A module constant used in a style is checked as its
value (a number used as a factor inside a template is not a length). Runtime
style parameters are not evaluated. For a real geometry exception, put
`// tokens-allow: reason` after the declaration on the same line (for a
constant, after the constant); an empty reason does not pass.
Run the rule tests with `node --test scripts/check-tokens.test.mjs`.

Measured on the shared Mac (2026-10-15), the token check alone took 0.36 s
median (0.35–0.50 s, five successful runs including Node startup). Five
alternating full lint runs with and without the check took 3.59 s
(3.42–4.88 s) and 3.85 s (3.11–4.95 s) respectively. Other worktrees were
active, so that full-lint difference is noise; budget about 0.36 s extra
for parsing the StyleX source files, not a lint speedup.

## Delayed-load layout checks

At `d0876483`, all 18 cases passed in 38.5 seconds on one `linux/amd64:4x8` remote runner with two workers. This is test time, excluding allocation, image pull and build. Use `pnpm remote --machine linux/amd64:4x8 test:desktop layout-shift.spec.ts` for the same runner size.

`pnpm remote test:desktop layout-shift.spec.ts` runs the desktop shift checks against fake Slack. They are ordinary desktop e2e tests, so `pnpm affected` picks them when they cover a change directly; the first-sync cases are `@heavy` and run when sync code changes, and always in the scheduled full run. No Mac timing or filmstrip recording is required.

`expectStableAnchor` in `apps/desktop/e2e/shiftProbe.ts` samples a retained DOM anchor's screen coordinates every animation frame and asserts exactly zero movement. It also requires Chromium's Layout Shift observer and rejects entries without recent input. The anchor check includes the recent-input interval, which otherwise hides jumps for 500 ms. Start it before releasing delayed data, and wait for the resulting UI inside its action. A missing anchor fails.

Use `fake.holdNext({ method, reason: 'open' })`, assert the call is held, then `fake.release({ method })` to exercise partial caches. Use silent fake posts followed by one socket message to reproduce history missing above the latest message. Do not substitute a settled gallery fixture for this case. Repeat with `pnpm flake apps/desktop/e2e/layout-shift.spec.ts --repeat 20 --machines 1`. Keep `JUNO_REMOTE_MAX_VCPU` at its default or lower.

## Scheduled full run

Run `pnpm verify:main --ref origin/main` every six hours after fetching main.
It checks out that commit in a temporary worktree on the scratch volume and
runs unit tests, Quint checks, conformance, gallery and desktop tests as
one plan on one remote 8x16 machine. Heavy sync tests and `@flaky` tests stay in
this run. Random Quint simulations run each time; deterministic Apalache and
typecheck results use the cache. Changes to sync or outbox code also trigger selective protocol checks.

Once a day, use `pnpm verify:main --ref origin/main --nightly`. This implies
`--no-cache` for Quint and `--with-mac` for the Mac-only e2e tests, perf and feel,
including the fine idle-CPU budgets. The ordinary six-hourly remote run checks
only the coarse idle runaway ceiling.
Those flags also work separately. Perf and feel run sequentially after the
other suites and hold the exclusive heavy lock. Ordinary UI changes do not
require a full Mac run. Keep timing gates on a quiet Mac and inspect its load.

Results live in the main checkout's shared `.juno-status`: the latest
`verify-main.json` and `.md`, permanent per-commit JSON under
`verify-main/commits/<commit>/<run>.json`, and logs under `verify-main/<run>/`.
The summary includes tests that passed on retry. A failed suite still exits 1;
release waivers do not change CI results. The command refreshes the coverage
map in the invoking checkout; commit that map after each run.

On 2026-10-18, one full run at `6c15fbb4` before and one at `d0ecf4ab` after this lane/cache change used separate 8x16 machines. Wall time was 1,418 s before and 1,453 s after. The old unit-then-spec lane took 222 + 281 = 503 s; the new parallel unit and spec lanes took 378 and 364 s, so both finished by 378 s. Both full runs failed for the same unrelated reasons: the gallery's `RemoveCard/remove/click-then-working` shift state consumed about 13 minutes and its part timed out at 15 minutes (gallery 938 s before, 950 s after), and `updates.spec.ts` expected version `0.1.1`–`0.1.6` while the app was `0.1.7` (desktop 413 s before, 427 s after). The gallery timeout dominated total time, so the 125 s shorter unit/spec path did not reduce this pair of full runs. The gallery hang was fixed on main after these runs.
