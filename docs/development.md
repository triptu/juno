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
| `pnpm remote <script>` | Runs a Linux-safe root script (`test`, `specs:check`, `specs:conformance`, `test:agent*`, `test:gallery`, `test:e2e`) on the shared SSH runner and streams the output. `--dry-run` shows what would be sent and run. See ADR 0013. |
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
| `JUNO_LIVE=1 pnpm forward:live` | The live forward check: in your self-DM only, posts a message and a reply, forwards them with `chat.shareMessage` with and without a note, tries a user id as the destination and a missing message, reads the history and deletes everything it made. Field names and codes only (research `slack-forward.md`). |
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

`add` checks out `<branch>` (default `<name>`; an existing branch is reused, a new one starts at `--base`, default `origin/main`; `--detach <ref>` checks out a commit with no branch, as for a DMG build), runs `pnpm install --frozen-lockfile` and prints the path. Worktrees go in `/Volumes/AgentWork/worktrees/juno/` when that volume is mounted (file event logging and Spotlight are off there), else in `.claude/worktrees/`. `scripts/worktree-folder.mjs` decides the folder (the volume counts as mounted when `/Volumes/AgentWork/.fseventsd/no_log` exists) and is shared by the helper, `batch-merge.mjs` and packaging. It names the folder after the main checkout, also when run from a linked worktree such as `t3-1234`; `JUNO_WORKTREE_DIR` overrides it. Older worktrees under `.claude/worktrees/` stay until their branches merge. The helper writes `.metadata_never_index` into that folder so Spotlight skips it, and waits to install while the load average is above 8. `remove` removes the worktree and, with `--delete-branch`, deletes its branch if it is merged.

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
shared results cache. The full suites are not part of a batch (see "Testing").
When the SSH runner is unavailable, `--local` runs those steps on this Mac instead, through
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

The only way in is importing the installed Slack app’s session, which the engine verifies with `auth.test`
(`docs/architecture.md` section 14):

- **Use the Slack app's session** reads copies of the installed Slack app's
  `Local Storage/leveldb` and `Cookies`. macOS asks once for access to the
  "Slack Safe Storage" keychain item (the `security` tool makes the request,
  so the prompt names `security`, not Juno). "Allow" is enough: main keeps the
  password in memory until Juno quits or signs out, so pressing the button
  again in the same run does not ask again. The copies are deleted afterwards
  and the password is never written anywhere.

Secrets go to `<userData>/secrets.bin`, encrypted with `safeStorage`. Under
`JUNO_E2E=1` the file is plain JSON and the three test seams are read from the
environment: `JUNO_FAKE_SLACK_URL` (the fake API and socket
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

The packaged smoke uses Chromium's `--use-mock-keychain` with its temporary fake-Slack profile, so cookie storage cannot wait on a macOS permission dialog. Installed apps use the real keychain.

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
6. **MCP credentials** (`juno-mcp`) and **backup secrets** (`juno-backup`) are
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

`apps/gallery/shift.spec.ts` checks hover, keyboard focus, blur, press, release and leave with motion on. Every state gets a cursor check. The interaction walk takes up to eight controls per state, the first five and last three when there are more, and skips only screenshot-only states whose rendered DOM signature was already checked. It keeps the existing negative controls and injects both a hover size change and a delayed chunk size change into a real Button fixture to prove the walk rejects them. The Avatar late-load and failed-load checks remain. Desktop e2e can import the same guard.

State readiness waits for chunks, fonts, visible images, the theme and finite entrance motion. These browser checks share one driver call after chunks are ready. After each action, a pending chunk is watched for DOM changes rather than polled every frame; the guard still settles for two frames and waits for layout motion before reading both shift entries and geometry. The walk saves its initial markup while computing the DOM signature, and keeps full reloads whenever a touch changed that markup. It reports states, screenshot duplicates, elements and reloads per part, and saves Playwright JSON beside its failure report.

The guard and focus-ring walk use `walkPages()` in `apps/gallery/support.ts`, which moves to a fresh browser context every 20 states to bound renderer memory. Each state has a 30 s deadline. Focus and blur run before press and release, while a control that disables itself on press is still interactive. Cleanup closes the page before its context, bounds each close at 5 s and closes the worker browser if its context cannot close.

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
- **`ws` in the bundled engine.** `ws` loads the optional native `bufferutil` inside a
  try. In the main build that require became an empty stub, so `ws` called a missing
  `mask` and died on every outgoing socket frame of 48 bytes or more (a `tickle` is 47,
  so only `presence_sub` showed it, 10-21). `electron.vite.config.ts` defines
  `process.env.WS_NO_BUFFER_UTIL` for the main build, which keeps `ws` on its own
  JavaScript masking. Engine tests under plain Node never saw it.
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
  externalises production dependencies. Keep workspace packages and `effect` in
  the desktop manifest's `devDependencies` so they are bundled. Workspace packages
  ship TypeScript; packaged Electron cannot load that source from `node_modules`.
  `electron.vite.config.ts` rejects workspace packages in production dependencies
  and checks that every external import has a packaged runtime dependency.
  Bundling `effect` cut the launch to first window from 416 ms to 314 ms.
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
- **Renderer bundle size.** The budget is 1.1 MB of initial JS and 155 KB of CSS
  (`docs/performance.md`); `pnpm build` runs `scripts/check-bundle-size.mjs` and fails
  over it. The M1 shell is 426.1 KB of JS (138.6 KB gzip) and 68.7 KB of CSS, minified.
  electron-vite does not minify by default, so the config sets `minify: 'esbuild'` for
  all three targets; without it the same code was 1,097 KB.

Effect and StyleX pitfalls are in their skills: `.claude/skills/effect/SKILL.md` ("Pitfalls") and
`.claude/skills/stylex/SKILL.md`.

## Faster test runs

- **Spec cache.** `pnpm specs:check` stores each passing Quint run in the system temp folder (`juno-cache/specs`), keyed by its arguments, what is checked on its output, the spec file and what it imports, and the Quint and Apalache versions. Every worktree shares it. A run whose key matches is not repeated: its saved output goes through the same checks and its trace is written back to `specs/traces/`. A changed spec reruns only its own checks. `SPECS_CACHE=off pnpm specs:check` or `--no-cache` runs everything; `SPECS_JOBS=<n>` sets how many typechecks and simulations run at once (default 3). The Apalache checks run after them, one at a time, on one Apalache server started for the run, so a check no longer pays for starting a JVM. Bump `cacheVersion` in `specs/check.mjs` when you change how a result is checked.
- **Build skip.** `test:e2e`, `perf`, `test:feel`, `test:gallery` and `gallery:shots` build through `scripts/build-cached.mjs`. It hashes the app, packages, scripts, root configuration and lockfile, build command, Node version, platform, architecture and build flags (including Vite variables and local `.env` files). Desktop e2e files, app-level specs, Playwright configs, package/app `test/` and `tests/` directories, and `scripts/*.test.mjs` do not affect the build key. Seed definitions and other helpers under `src/` still do. It verifies output bytes before reuse. Remote runs also restore matching output from a persistent cache; a changed input, missing output or failed checksum rebuilds. `JUNO_REBUILD=1` forces a build. `pnpm build` and `pnpm dev` always build.
- **Shift guard.** The gallery's guard waits only for running transitions and animations that can move a box, skips only equivalent screenshot-only states, and its parallel parts take states from one queue in the temp folder, so they finish together. Remote runs use one part per gallery worker. The parts also check the cursor rule on each state they open. `GALLERY_SHIFT_ONLY=Button,Chip pnpm test:gallery` checks a few components while you iterate.
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

Agents run selective checks before reporting. A scheduled task runs the full suites on main once a day with `pnpm verify:main` ("Full runs"). The agent that runs it commits the refreshed coverage map and merges it. A release follows `.claude/skills/do-release/SKILL.md`. Remote jobs share the laptop through tstack, including jobs from other projects.

**Agents.** Before reporting, an agent runs `pnpm affected`: the local Bun check and lint, then, as one remote plan with separate SSH jobs, the unit files its change reaches, the specs it added or changed, the specs it names with `--spec`, and at most 10 more desktop specs that cover the change most directly ("Affected tests"). Heavy tests run only when the change is in their area, and the Quint checks only when the code the specs model changed. `pnpm affected --plan` first shows what it would run and why. `--wide` runs every spec the change can reach, for the rare change that needs it. One remote run at a time per agent. To run a few unit test files by hand, use `pnpm remote test --passWithNoTests <files>` (paths relative to their package); one spec, `pnpm remote test:desktop <files>`.

**Signed-in desktop tests.** Use `syncedTest` or `test.use({ synced: true })` for a default-seed flow whose first sync is only setup. Each test boots a fresh Electron process from a worker's verified snapshot and starts a matching fresh fake. Sign-in, first-sync, convergence, boot, AI-job and custom-seed scenarios keep a real sign-in. Snapshot keys, guards and the remaining exceptions are described in [Desktop e2e](../apps/desktop/e2e/README.md#synced-start). Timings and the rejected app-reuse experiment are in [Test speed round 4](test-speed-4.md).

**Merging.** Finished branches merge into main in batches (`scripts/batch-merge.mjs`, "Batch merges") after typecheck, lint and the unit tests pass on the merged tree. The full suites do not gate a merge.

**Full runs.** `pnpm verify:main --ref origin/main` runs every suite on main, including heavy sync tests; `--nightly` adds uncached Quint and the Mac suites ("Full runs" below). Run Quint uncached when its specs or checker change too. Conformance is in the full plan. Do not repeat `test:agent` separately; the unit suite already includes it.

**Flakes.** Remote Playwright runs retry once. Tests that pass only on retry remain listed as flaky in the console and full-run summary. A failed test fails the gate. Fix intermittent failures without weakening assertions or running retry loops to obtain green results. Use `pnpm flake` to investigate them ("Hunting a flaky test" below).

**Remote plan shape**: `pnpm affected` and `pnpm verify:main` use separate unit, gallery, desktop and specs jobs on the SSH runner. The desktop job builds the app once and does not shard desktop e2e. See "Remote runs" and "Machine shapes".

**Test selection by coverage** (landed 10-17): `pnpm affected` picks desktop e2e specs by a coverage map that `pnpm verify:main` refreshes, and gallery behaviour specs by the components they open. See "Desktop specs by coverage".

**Narrow plans** (10-18): every spec boots the whole app, so the coverage map linked the median source file to 64 of 103 specs, and 125 of the 181 merges of 10-16 to 10-18 would have run 100 or more desktop specs. `pnpm affected` now ranks the specs and runs at most 10 besides the changed and named ones, skips heavy tests outside the change's area, and runs conformance only for the code the specs model. A full run covers the rest. Replayed over the 30 branch merges up to `993f2375` (`pnpm affected --plan --json --range`, old planner against new, both without the results cache): 2,503 desktop specs became 296, plans that ran 100 or more desktop specs went from 22 to none, shift-guard components from 1,326 to 546, conformance from 18 plans to 9, and the remote time, estimated from the per-spec times of the 10-17 and 10-18 full runs, from 13,873 s to 6,071 s (median plan 512 s to 189 s). `--wide` planned the same steps as the old planner for all 30. See "Affected tests".

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

**Further unit tuning** (10-19). Store now overlaps files on remote workers because every test owns a private temporary directory and database handles. The mutation scenarios use a smaller 20,000-message fixture while keeping 300 conversations, all 150 activity targets and the exact repair budgets; the 100,000-message performance fixture stays intact. The send flush check advances retry deadlines with TestClock. Home's AI-off setup now precedes its job startup, and quick-start's Automated hold is advanced explicitly, so both work under load. Five paired Agent pool/isolation samples found no consistent improvement, so its defaults stay unchanged. Wall-clock and CPU budgets are excluded from normal unit runs and `affected`: `pnpm perf --unit` runs the Agent, Engine and AI performance configurations on the Mac. Mixed tests keep their correctness assertions in the normal suite; query-count and payload limits remain normal checks. The Agent no longer has a separate timing project in `pnpm test`. Profiling commands and measurements are in [Unit suite timing](unit-suite-timing.md#round-3-smaller-repair-fixtures-and-independent-store-workers).

**Desktop scheduling and persistent builds** (10-19). The desktop fixture now selects the engine unit harness's fast scheduling for ordinary fake-Slack launches. Both e2e mode and a fake URL are required. Thumbnail recovery keeps four attempts at the same ratios; production still waits 1, 3, 10 and 30 seconds. The fast profile disables periodic discovery, uses explicit catch-ups, and preserves real socket hello/pong safety deadlines. Tests of real timing opt out with `test.use({ timing: 'production' })` or `launchApp(dir, { timing: 'production' })`; presence spacing and reaction-versus-edit backoff do so. Paced sync, idle, perf, feel and `@mac` launches retain production timing automatically. `juno.workPass(name)` waits for an engine job pass started after its request, so negative AI and Automated assertions no longer sleep for several seconds. `JUNO_E2E_TIMINGS=1` reports separate fake-start, Electron-launch, sign-in, sync-wait and close times. Related checks with the same starting state share one launch and use labelled `test.step` calls. Each flow owns its fake and user data. Cold starts, different initial fixtures and destructive failure cases stay separate. Timing budgets run on the Mac through `pnpm perf`; normal e2e waits only establish readiness or fail a hung step.

The subsequent flow pass combines 50 checks into 17 labelled flows across 17 specs, saving 33 launches. The portable idle walk replaces three launches with one. The [round 4 report](test-speed-4.md) records the assertion inventory, timings, injected CPU/leak failures and unresolved flakes. No exact duplicate test was removed.

The earlier fast-profile and persistent-build comparisons below used one run per side on the same SSH runner on 10-19, with no overlapping remote runs from this branch. Desktop reserved four cores, with two workers before and three after; gallery reserved three cores, with three workers before and four after. These are observations under shared load, not repeated statistical estimates. Script time includes the build but excludes transfer and installation.

| Run | Before script time | After script time | Result |
| --- | ---: | ---: | --- |
| Desktop sample, ten filename filters | 211 s | 169 s | 61 passed on each side, no retries |
| Full desktop | 1,483 s | 1,197 s | Before: 435 passed, 42 skipped. After: 434 passed, 42 skipped, one title-assumption failure |
| Gallery slice, Button/Chip/TopicHeader | 80 s | 75 s | 70 then 72 passed, no retries; one extra queue part and one new guard test |
| Full gallery | 1,204 s | 1,044 s | Before: 293 passed, three sweep parts timed out and passed on retry. After: all 298 passed without retries |

Gallery CPU rose from 90% to 98% of three cores; peak container memory rose from 3.13 to 3.69 GB. The fourth worker and the DOM changes were measured together, so this pair does not isolate their contributions. The four sweep parts finished in 14.1–14.3 minutes under the existing 15-minute limit. The full walk now has a 20-minute batch limit to give smaller or busier plans headroom; each state retains its 30-second limit. This changes only when an unfinished walk fails, not how long a successful walk waits. The baseline's retry results are kept in the table rather than presented as a clean run.

The desktop failure was `settled-review.spec.ts`: the faster title job had changed the sidebar title from `p95` to `P95`, while the test still looked for the fallback title. Commit `aeac0f83` waits for the exact AI title before the flow; both review checks then passed locally. The 1,197 s is the observed full run including that failed attempt and retry, not a clean all-pass benchmark. No test was merged or removed. The new gallery guard check moves a nested offset parent between snapshots so a stale position cache would fail.

The extra desktop worker uses idle capacity: average CPU rose from 53% to 71% of four cores. Individual launches get slower. Component medians in the full runs were fake start 36 → 48 ms, Electron launch 610 → 801 ms, sign-in 662 → 792 ms, sync wait 702 → 1,066 ms and close 68 → 76 ms. These are separate component medians, not the median of their sum. The ordinary fake is cheap enough to keep each test isolated. Gallery already reduces motion outside its motion checks; the full shift guard still checks real transitions.

Removing production waits is visible per file despite that contention: media checks fell from 60.6 to 17.5 s summed, attachments from 87.7 to 57.8 s, and the API-key flow from 21.6 to 9.6 s. Thumbnail exhaustion alone changes from 44 s of scheduled waits to 2.2 s. These file totals overlap in wall time and must not be added to the full-run saving. The unchanged large idle journey remains the desktop floor: about 14 minutes.

Cold candidate builds took 32.69 s for desktop and 22.70 s for gallery. The following fresh remote workspaces restored the same outputs in 0.03 s and 0.01 s. Cache tests cover fresh archives and Git checkouts, changed and deleted inputs, build flags, damaged output, damaged cache entries and failed builds. The gallery sweep also keeps exact markup comparisons in the browser and reads each shared offset parent once per synchronous snapshot; it still measures every selected element and all six touches.

The final `pnpm affected` invocation initially failed the health limits on the added test hooks. Extracting the main/engine test helpers fixed that: Bun, desktop TypeScript, all 11 lint checks and 17 local AI/Automated/Home/review checks then passed. Its unit lane stopped at the unchanged `packages/agent/test/serve/chat-cache.bench.test.ts:43`: event-to-window p95 was 62.1 ms against a 50 ms budget, while the query budget passed. That left planned unit files unrun; the benchmark and its limit were left for the separate unit/plan work. The protocol checks passed, conformance passed 80 cases with 12 existing skips, and all 62 repository-tool tests passed. The same plan passed all 297 gallery checks in 1,149 s and 17 selected desktop checks in 56 s, without retries. Its three sweep parts took 16.2–16.3 minutes, so they needed the increased batch limit. With the root script registration changed, this plan selected the ten smallest desktop specs; the changed job/review flows were checked separately in the 17-test local batch above. The overall affected result remains failed because of the recorded initial health failure and the unit benchmark; the health checks were subsequently rerun successfully.

Reproduce the samples with:

```sh
pnpm remote test:desktop app.spec.ts topic.spec.ts send.spec.ts actions.spec.ts automated.spec.ts ai-key.spec.ts art.spec.ts home.spec.ts mirror-reads.spec.ts presence.spec.ts
pnpm remote --env GALLERY_SHIFT_ONLY=Button,Chip,TopicHeader test:gallery shift.spec.ts behaviour.spec.ts topic-art.spec.ts
```

The full commands are `pnpm remote --env JUNO_E2E_TIMINGS=1 test:desktop` and `pnpm remote test:gallery`.

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

`pnpm affected` works out which tests the change can reach and runs only those. After local Bun checking passes, the remote suites run as one plan: separate SSH jobs through tstack (`pnpm remote test:plan`, see "Remote runs"), and the local steps (lint, the Node checks) run on the Mac beside it. Each step's result comes back separately, so the results cache records the steps that passed (`--local` runs every step one after another through the local root scripts; `--plan` only prints the plan, and `--plan --json` prints it as JSON; `--files a,b` plans for given files; `--spec <spec>` also runs that desktop or gallery spec, repeated or comma-separated; `--max-specs <n>` allows more coverage-picked desktop specs than 10; `--wide` plans every spec the change can reach, heavy tests included, as before 10-18; `--batch` is the batch gate's plan, below). The change is every file that differs from the merge base with `origin/main` (or `main` when there is no remote), committed or not, plus new files. Agents use it while iterating and for their report; a scheduled task runs the full suites on `main` once a day.

An import graph over `apps/` and `packages/` decides what each change reaches, and for desktop e2e specs a coverage map narrows it ("Desktop specs by coverage" below). The graph follows relative imports, `@juno/*` through each package's `exports`, and named imports followed through barrel files (`export * from` and `export { } from`) to the module that declares the name. The rules:

| Changed | Runs |
| --- | --- |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the root `package.json`, `tsconfig.base.json` | every unit test, `specs:check`, conformance, and a sample of each e2e suite: the 10 smallest desktop specs and 10 gallery components (no spec can be told apart) |
| `scripts/affected.mjs`, `scripts/affected-select.mjs`, `scripts/affected-run.mjs`, `scripts/affected-tests.mjs`, `scripts/test-areas.mjs`, `scripts/import-graph.mjs`, `scripts/coverage-map.mjs`, `scripts/remote*`, `scripts/heavy.mjs`, `scripts/build-cached.mjs`, `scripts/without-run-as-node.mjs` | the tool tests (`test:health`, `test:repo-tools`, `test:runner`) and `e2e/app.spec.ts`, as a check that a run still works |
| A vitest file, a file one reaches, or a package's `package.json`, `vitest.config.ts` or `tsconfig.json` | those vitest files (`pnpm test --files <repository paths>`). A vitest file is any file a package's or app's `vitest.config.ts` includes (every project's `include`, `test/**/*.test.ts` by default), in `packages/` and `apps/` alike: `apps/desktop/test/`, `packages/agent/eval/` |
| A script under `scripts/` that a Node test imports, or the test itself | the root script that runs that test with `node --test` (`test:repo-tools`, `test:health`, `test:runner`); every `scripts/**/*.test.mjs` belongs to one (`scripts/affected.test.mjs` checks) |
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

**Unit file selection.** Each test runs only when its import closure contains a changed file, or its package configuration changed. Engine tests often import the whole engine through their shared harness, so an engine edit can legitimately select most engine tests. The runner keeps each selected path's package, starts only those packages, and excludes nested namesakes that Vitest's substring filters would also match. A package config change still runs that package's tests; root config and lockfile changes still run every unit file. In desktop selection, they keep changed specs and specs importing a changed private helper mandatory, then add the usual sample of other specs. Full `pnpm test` and the older package-relative filters keep their existing behaviour.

Replaying the 15 first-parent merges ending at `f601148d2` with `--plan --json --no-cache --range <merge>^1..<merge>` selected 1,113 unit files before and after. The old package-relative filters matched 1,196 files; the new commands run the selected 1,113. Examples: `home-muted-levels` matched 74 files for 62 selected, `newchat-toasts` 25 for 19, and `sync-sweep-cheaper` 73 for 57. These are file-match counts against the same checkout, not historical test executions. The JSON output is written synchronously so a large replay remains complete when piped.

`--wide` keeps the rules from before 10-18: everything runs for the files in the first two rows, every spec the coverage map picks runs, shared e2e support and style sheets run every desktop spec, `packages/tokens/` runs the whole gallery, conformance runs for any of the 425 files its replay reaches, and heavy tests always run.

**Heavy tests.** Some tests are slow because of what they check, and their code rarely changes: the small idle CPU and memory smoke check (about 53 seconds on the pinned runner), the first-sync cases in `layout-shift.spec.ts`, every test in `quick-start.spec.ts`, the 429 storm in `realtime.spec.ts`, and the gallery's shift guard over every component. Each is tagged `@heavy` and its area's tag (`{ tag: ['@heavy', '@heavy-sync'] }`). `HEAVY_AREAS` in `scripts/test-areas.mjs` is the one place that says which code each area covers: sync (`packages/sync/`, the engine's session and start, the Slack client's pacing, the large seed and the three specs), idle (the process monitor, the engine's workers, the agent's schedulers, `idle-cpu.spec.ts`) and the gallery harness. The idle spec's portable gate uses a 2,000-message seed, four states, 2 s settling and 10 s samples: every process stays below 25% of one core, below 96 MB peak/end memory growth, and below 32 MB growth if every interval grows by more than 2 MB. A focused run uses `--machine linux/amd64:2x4` (one physical core, two threads, 3 GB); full app runs retain their normal two-core allocation. Its fine per-process budgets and long large-seed walk stay in the Mac run (`pnpm verify:main --with-mac`). App diagnostics remain the primary way to find field spins; this smoke check does not cover slow leaks or every deferred worker path. A plan runs an area's heavy tests only when a changed file, or a spec named with `--spec`, is in that area. Otherwise it sets `JUNO_SKIP_TAGS` (for example `@heavy-sync,@heavy-idle`), which each suite's Playwright config adds to its `grepInvert`, and leaves out a spec whose every test is heavy. The remote full run includes the coarse idle check. Fine idle budgets run in the `--with-mac` lane and on demand on the Mac; they do not run in remote plans or remote full runs.

**Batch gate.** `pnpm affected --batch --base <ref>` (what `scripts/batch-merge.mjs` runs after its own typecheck and lint) plans only the unit files and script tests the batch reaches, `specs:check` when `specs/` changed, and conformance when the code the specs model changed. It does not run the gallery or desktop e2e.

**Results cache.** Each unit test file, gallery component, gallery behaviour spec file and desktop e2e spec file is an item with a key: a hash of every file it reaches, its package and suite configs, and the lockfile. After a step passes, its items' keys are recorded in the system temp folder (`juno-cache/results`), shared by every worktree, whether the step ran here or remotely. An item whose key passed before is skipped and counted in the plan; `--no-cache` runs everything. `specs:check` keeps its own cache per Quint run. A failing step records nothing.

`perf` and `test:feel` never run here, but `pnpm verify:main --with-mac` (or `--nightly`) runs both on the Mac after the other suites. Run a matching perf scenario for new per-row, per-frame or startup work, and a matching feel scenario for a change to that interaction. Use the last `--with-mac` result as the baseline. The plan names matching perf and feel scenarios from `PERF_INTERACTIONS` in `scripts/test-areas.mjs` when their files change. The graph errs towards running more: a module imported whole (`import x from`, `import * as`) brings everything it imports. A test whose behaviour depends on a file it does not import (a fixture read from disk, an environment variable) is not seen; a full run on `main` catches that.

### Desktop specs by coverage

Nearly every file reaches the whole desktop app through the import graph, so the graph alone would run every desktop spec for any app change. Instead, `pnpm affected` reads `apps/desktop/e2e/coverage-map.json`, which records, for each spec file, the source files under `apps/` and `packages/` whose functions ran while one of its tests had the app open.

**Recording.** `JUNO_COVERAGE=1` turns it on for a desktop run. The build then writes hidden source maps (`electron.vite.config.ts`; `build-cached` rebuilds when the variable changes). `apps/desktop/src/coverage.ts` is the first import of main, the engine and the agent: with `JUNO_E2E_COVERAGE` set to a directory, each process starts precise function coverage on its own inspector and writes the start offsets of the functions that ran. Main also attaches to each renderer over the DevTools protocol before its page loads. The fixtures give each launch its own directory under the spec it belongs to, and ask main and the renderers to write before they close the app. The engine and the agent write every two seconds and on SIGTERM. The run's teardown (`e2e/coverage.ts`) runs `node scripts/coverage-map.mjs reduce`, which maps the offsets to source files with the source maps and writes `apps/desktop/coverage/map/partial-<shard>.json`; `pnpm remote` brings it back with the reports. A module's top level does not count: in a bundle it runs at load in every test, so it says nothing about a spec.

**Refreshing.** `pnpm verify:main` runs the desktop suite with `JUNO_COVERAGE=1` and writes the joined map (`node scripts/coverage-map.mjs merge <partials> --commit <sha>`) to `apps/desktop/e2e/coverage-map.json` in the checkout it ran from. A failed test still ran its code, so failures do not stop the refresh. A scheduled task runs a full run on main once a day; the agent that runs it commits the refreshed map and merges it, as "Refresh the e2e coverage map". The map is a few hundred kilobytes, one source file per line, so a refresh reads as a diff.

**Selecting.** `scripts/affected-select.mjs` picks the candidates, and the plan prints each spec's strongest reason:

- for a change to the shared e2e support (the driver, the fixtures, the fake Slack, the fake OpenRouter), the specs that use a changed class member or function, or a support part that uses one (`reachSpecs`). A spec uses `Palette.section` when it names `.section` and can get a `Palette`: it names the class or an accessor that builds or returns one. A change outside every named part (a class's own line) counts as a change to everything the file exports, and a Slack method a changed line names (`'conversations.history'`) picks the specs that name it. Where nothing can be placed (a config, a page), every spec is a candidate and the smallest stand in. `--wide` keeps the old rule: every spec for support other than the driver, and for a driver change outside a named part;
- a changed app file outside the JavaScript bundles (a style sheet, a page, an asset) picks nothing; the gallery and a full run check it (`--wide`: every spec);
- the specs that ran a changed file;
- a changed spec, and the specs that import a changed helper;
- for a file with module-level code only (`moduleOnly` in the map: bundled, but no spec ran a function from it, such as schemas, RPC routes and prompts) or a file that is new since the map's commit, the specs that ran the files importing it, walking up through importers that did not run; none when nothing that imports it ran (`--wide`: every spec);
- the specs that ran a file importing a changed file, when that importer itself changed since the map's commit (it may call the changed file now);
- specs the map has no coverage for (new or never recorded), whenever the app changed.

A changed app file that was in no bundle when the map was recorded (types only, or not used by the app) picks no spec.

**Ranking.** The plan runs every changed spec and every spec named with `--spec`, then at most 10 candidates (`--max-specs`), the highest score first (`rankSpecs`). A spec scores, for each changed file it ran, the log of how many specs there are over how many ran that file: a file every spec runs (app boot, the shared harness, `Palette.tsx`, which the shell mounts) adds almost nothing, and one three specs run adds a lot. A support change adds more the nearer the spec is to what changed. A helper adds more the fewer specs import it. A spec named like a changed file (`palette.spec.ts` for `Palette.tsx`) adds a little. A tie goes to the spec that ran fewer files, which is usually the quicker one. The plan says how many more specs ran a changed file; a full run covers them. Gallery components for the shift guard are ranked the same way, by how few components a changed file reaches and a component named like a changed file.

**Measured** (10-17, map from `d15f27ee`, replaying merges with `pnpm affected --plan --range <merge>^1..<merge>`). Of the 20 merges on main up to `25e9b5f7`, 17 touched the app, and for each the import graph picked every desktop spec. The coverage map picked 6 of 69 for palette-pages, 44 for thread-root and 1 for a batch fix; the other 14 still ran everything, because of the lockfile or root `package.json` (4), the fake Slack, the fake OpenRouter or the fixtures (5), or core files every spec runs (5: navigation, the send worker, sync boot). 123 files are run by every spec and the median file by 40. File by file it is narrower: palette files pick 5 specs, the message window 44. It picked the failing spec for all six real desktop failures of 10-16 (mirror-reads, tabs, both break-pass specs, avatars-unfurls, stick-bottom), whether given the whole merge or only the files that caused the failure. Gallery behaviour specs: 3 of 14 for palette-pages, slack-import-paths and automated-reason, 8 for send-checks-c, 13 for broad UI merges.

**Staleness.** The map lags main by the time since the last full run whose map was committed. The rules above cover the two ways it goes stale: new files, and importers edited since the map. What they miss is a call that became reachable through a file that did not change, which is rare; a full run on main catches it. A map more than three days old, from a commit this repository does not have, or missing, is not used: every spec runs when the app changed, as before. `pnpm affected --graph` ignores the map.

**Limits.** Code that runs only in the test process (the fake Slack, the driver) is not recorded; that is why changes there are picked by the names specs use, not by the map. The renderer writes its coverage when the test closes the app, so a renderer that crashed or a window that closed before that is not counted. Tests tagged `@mac` do not run remotely and are not recorded. The gallery is not recorded: its behaviour specs are narrowed by the component names they open (`galleryComponents`), and a spec that reads every route without filtering them runs for any component.

## Remote runs

`pnpm remote <script> [args...]` runs on the SSH laptop through tstack's shared
host allocator. Install tstack with `/tstack:setup`; its checkout is
`$TSTACK_HOME` (default `~/Documents/code/tstack`). Juno owns the test plan,
workload sizes, workers, toolchain image, workspace install and result parsing.
tstack owns reservations, pinned containers, leases, heartbeats and cleanup.
See [Juno runner configuration](self-hosted-runner.md); use `/tstack:runner`
for machine setup, lessons and troubleshooting.

Standalone jobs wait up to 60 seconds for capacity; split plans default to one hour so a job can wait for another job in the plan to release its cores (`--wait <seconds>` or
`JUNO_RUNNER_WAIT` changes this). An unavailable or full runner fails. Use
`pnpm remote --local <script>` or `pnpm affected --local` to run the steps on
this Mac through the heavy lock. No automatic local fallback is enabled.
Namespace, if needed again, is available only through `/tstack:runner`.

`test:plan` splits unit, gallery, desktop and specs steps into independent SSH jobs.
Steps within each job run in order; conformance stays with specs. Gallery and
desktop can overlap within the existing allocator limit. Each uses the verified
persistent build cache for its own output; they do not share a workspace. Each job
gets a separate install and report directory, and releases its cores when it
finishes. `JUNO_RUNNER_PLAN=single` keeps one job; `JUNO_PLAN_SERIAL=1` also
runs every step in order. `KEY=VALUE` before a step overrides its environment.

```sh
pnpm runner:check
pnpm remote test --passWithNoTests test/messages.test.ts
pnpm remote test:plan test --passWithNoTests test/messages.test.ts + test:desktop e2e/app.spec.ts
pnpm remote --cores 2 --wait 120 test:gallery shift.spec.ts
```

The worktree snapshot includes tracked and unignored files, with non-Markdown
design assets under `docs/` excluded. It refuses files that look like credentials
or contain real Slack tokens or cookies. Ignored dependencies and build output
stay on the client. Never put secrets in the workspace.

Juno's toolchain image is built on the runner through tstack's shared build
lock. Dependencies install per run against `/cache/pnpm-store` with
`--frozen-lockfile --prefer-offline`; lockfile changes do not rebuild the image.
Electron downloads and verified app builds persist under `/cache`. Spec cache
entries travel with the job and return with its results. Reports and logs land
in `.remote/`, with `plan.log` for the coordinator and `run.log` for each child.
`pnpm remote:usage` summarizes the retained logs across worktrees.

The Mac client stays awake with `caffeinate -i -w <pid>` for the remote run.
Heartbeat loss or a closed connection makes tstack stop the job and free its
cores. A killed coordinator closes its children's pipes so their jobs stop too.

`perf`, `test:feel` and `gallery:shots` stay on the Mac. Tests tagged `@mac`
are skipped on Linux and included in `pnpm verify:main --with-mac` runs. For idle CPU changes,
run the fine budgets through the heavy lock with
`pnpm test:desktop idle-cpu.spec.ts --grep @mac`.

## Hunting a flaky test

`pnpm flake <spec...> [-g <title>] [--repeat 40] [--machines 2] [--workers n]` runs the specs (all under `apps/desktop/e2e` or all under `apps/gallery`) through `pnpm remote` with Playwright's `--repeat-each`, no retries and traces kept on failure. The repeats are split across the machines (at most two, so other agents keep theirs), and each machine runs its usual number of workers, so the tests run under the load of a normal remote run; `--workers` raises it. It ends with one line, `flake: 2 of 160 failed`, and the names of the failing tests. Traces are in `.remote/<run>/`; `pnpm exec playwright show-trace <trace.zip>` opens one. For the gallery's shift and focus-ring walks, each repeat walks every state again, and `GALLERY_SHIFT_ONLY=MediaViewer pnpm flake apps/gallery/shift.spec.ts --repeat 20 --machines 1` limits the walk to those components.

Package tests under `packages/` use Vitest's `--repeats` with retries off. Their summary counts test cases, each failed if any repetition failed, and states the number of executions per case. For example, `pnpm flake packages/engine/test/sidebar-state.test.ts -g "four people" --repeat 200 --machines 1` runs that case 200 times on one small machine. Every repetition runs its setup and teardown.

```sh
pnpm flake apps/desktop/e2e/sidebar.spec.ts -g "list scrollbar" --repeat 120
pnpm flake apps/gallery/behaviour.spec.ts -g "rewritten Home" --repeat 400 --workers 32
```

Measure the failure rate before a fix and prove the fix with the same count and load. A test that fails a few times in a hundred needs a hundred or more runs to show it. To see what the app was doing when a test failed, add a temporary `console.log` of what the test cannot see in its assertion (what `:hover` matches, which Slack calls arrived) and repeat; the line reporter prints it.

Causes found so far (2026-10-20):

- **A sidebar click measured before a caused move.** The People flow injected a DM and opened its row before waiting for the activity reorder. A replay that delivered the DM between `SidebarRow.select`'s box measurement and mouse move clicked `m:C0HIRING` and opened that same topic in all three runs. The app used the row under the pointer. The test now waits for Maya at the top of Recent before the driver measures her row, and checks the active tab before the message. A caller that causes a reorder must wait for its expected order (`expectTop`) before a coordinate-based row open.

- **Settings edits built from an old page.** Each hours control sent a complete hours object from the last engine answer, so pressing Saturday could restore the old start time over a recent edit. Tidy up controls did the same with their shared preference. Both pages now send only edited fields, and each hours day button sends only its own day; the engine merges hours under its settings lock and Tidy up inside one writer transaction. Keep rapid-edit persistence checks fast, without waiting for a save between controls.

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

- **A retry that walked no states.** The shift and focus-ring walks share their states through a claim queue (`claimQueue` in `apps/gallery/support.ts`) keyed by run and repeat, not by retry. A retried part found every state already claimed, walked none and passed, so a failure that happened on every walk showed as flaky: `AttachmentCard/shared-video` and `shared-files-quiet` gave the text cursor to their video box, video and file names without making them selectable (80 of 120 at `GALLERY_SHIFT_ONLY=AttachmentCard pnpm flake apps/gallery/shift.spec.ts --repeat 40 --machines 1`, every repeat; a retry logged 0 states walked). A retry now walks again the states its test took on the first attempt. The files in a shared card keep the arrow and its file lines are selectable text (0 of 120 at the same command).

## Machine shapes

Juno requests physical cores from the laptop's shared `4-11` allocation:

| Job | Cores | Memory cap |
| --- | ---: | ---: |
| Narrow unit, agent tests, cached spec check | 1 | 3 GiB |
| Wide unit, uncached spec check, gallery, app | 2 | 6 GiB |
| Conformance, trace generation, other scripts | 4 | 12 GiB |

Wide units have no named files or more than 20. `--cores` overrides the request;
default sizes shrink to fit smaller hosts. Explicit oversized requests fail.
The older `--machine linux/amd64:NxM` and `JUNO_REMOTE_MACHINE` spellings round
N threads up to whole two-thread cores. On quota hosts a narrow job gets one
CPU, with no burst to two.

The shared host maps sibling CPUs and sets the actual thread quota. Workers
use its `RUNNER_THREADS`, forwarded as `JUNO_RUNNER_JOB_CORES`; they never infer
threads from the request. At four threads wide units run four Vitest workers
in each of two packages, desktop runs three workers (two in sequential plans),
and gallery runs four. Quint uses one simulation per two threads and one
Apalache checker per four, at least one each. Explicit worker settings win.

The host caps memory without swap and mounts `/tmp` and `/work` as tmpfs.
Each tmpfs is 2 GiB, or 4 GiB for requests of four or more cores; tmpfs consumes
the memory cap. Split plans release each job's cores independently.
One remote run at a time per agent; other projects use the same allocator.
Use `runner list` to see their combined usage.

## Heavy jobs share one queue

Tests, e2e runs, gallery shots, benchmarks and spec checks spawn many processes. Several agents often work in separate worktrees on the same machine, so the root scripts (`pnpm test`, `pnpm test:e2e`, `pnpm test:feel`, `pnpm test:gallery`, `pnpm gallery:shots`, `pnpm specs:check`, `pnpm test:agent-contracts`, `pnpm test:agent-testing`) run through `scripts/heavy.mjs`. It takes a machine-wide lock in the system temp folder, shared by every worktree, and waits for a free slot. There are two slots by default (`JUNO_HEAVY_SLOTS` changes it). On the Mac, `--electron` also takes a single shared app-launch slot. `test:desktop`, `test:e2e`, `test:gallery` and `gallery:shots` use it, so only one of these jobs runs at once. Ordinary jobs can still use both slots, or run beside one app job. An app job waiting for the app-launch slot holds no general slot. Timing runs (`pnpm perf`, `pnpm test:feel`) pass `--exclusive`, which takes every slot and stops new jobs from starting while it waits, so their numbers are not skewed by another run. Release packaging passes `--priority release` with `--exclusive`: it moves ahead of all queued jobs while it waits for active jobs to finish, without interrupting them. Use `node scripts/heavy.mjs --status` to see holders and queued commands, PIDs and wait times. The wrapper sets `JUNO_HEAVY_HELD` for its child; nested heavy commands run within the parent's reservation and cannot deadlock waiting for a slot the parent holds. Running a package's tests directly bypasses the queue, so prefer the root scripts. `pnpm test:health` and `pnpm test:runner` skip the queue: they are small Node tests that should not wait behind perf or package runs.


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
lint/typecheck. Heavy checks run through `pnpm affected` on the SSH runner.

### Steps

1. Install Node 26, pnpm 12.11.2 and Xcode (including its command-line tools).
   Run `pnpm install --frozen-lockfile` and `pnpm affected`.
2. Set the version with `pnpm release:version` ("Versions" below). Build and smoke the
   local package with `pnpm package` and `pnpm test:package`. The smoke launches
   the executable directly, signs in to fake Slack, waits for sidebar rows,
   starts the agent against fake OpenRouter, stages multi-chunk ZIP and empty-MIME DMG files in a topic composer, and relaunches the cached account.
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
5. publishes the draft and marks it latest. Installs see it from now on;
6. sets the released version on the current `origin/main` tip with a version-only
   commit, `Set version to x.y.z after release`, unless main already has that
   version or a newer one. It never pushes the release checkout onto main.

The main update uses a normal push, fetching and rebasing on concurrent changes
for up to four attempts. It never force-pushes. If it fails after publication,
the command exits non-zero. Rerun the same publish command to finish only the
main update; an already published stable version is not uploaded again.

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

A failed test fails the release gate. Never infer a green record from a log.

Use `--urgent` only for a fix to a problem hurting the
owner now, such as a CPU spin, data loss or a crash on launch. It runs local
typecheck and lint, remote unit tests, and `pnpm test:package` against the
packaged app before publishing. It adds an `urgent` marker to the GitHub release
notes metadata. No full run covers an urgent release yet, so run
`pnpm verify:main --ref <commit>` for it next; the command prints the commit. An urgent publish is still a normal visible release.

`pnpm release:version`, `pnpm package` and `pnpm release:publish` print their
step durations and append them to `.juno-status/release-timings.json` (local,
gitignored): version bump, JS build, deploy, electron-builder, DMG, notarize
or skip, and upload. The electron-builder total includes the DMG phase.

### Scheduled releases

`pnpm release:scheduled` picks and publishes a release on the release Mac.
Nothing runs it on a schedule. An agent runs it when Tushar asks for a release,
following `.claude/skills/do-release/SKILL.md`, which also covers the update token. Use
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
command log. After publication it uses the main-version update described above.
The build version commit stays in the release checkout; only its version field
is replayed on the current main tip, preserving newer work. This version-only
change remains covered by the release gate. If the release bump is already on
main, no second bump is added. Before selecting another release, a rerun repairs
main from the latest published stable version and exits without publishing.
This recovery needs the `gh` login but no update token or build artifacts.
A failed run keeps its checkout and notes for inspection. A successful run
removes its checkout. After an interrupted
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

`pnpm remote test:desktop layout-shift.spec.ts` runs the desktop shift checks against fake Slack. They are ordinary desktop e2e tests, so `pnpm affected` picks them when they cover a change directly; the first-sync cases are `@heavy` and run when sync code changes, and always in a full run. No Mac timing or filmstrip recording is required.

`expectStableAnchor` in `apps/desktop/e2e/shiftProbe.ts` samples a retained DOM anchor's screen coordinates every animation frame and asserts exactly zero movement. It also requires Chromium's Layout Shift observer and rejects entries without recent input. The anchor check includes the recent-input interval, which otherwise hides jumps for 500 ms. Start it before releasing delayed data, and wait for the resulting UI inside its action. A missing anchor fails.

Use `fake.holdNext({ method, reason: 'open' })`, assert the call is held, then `fake.release({ method })` to exercise partial caches. Use silent fake posts followed by one socket message to reproduce history missing above the latest message. Do not substitute a settled gallery fixture for this case. Repeat with `pnpm flake apps/desktop/e2e/layout-shift.spec.ts --repeat 20 --machines 1`. Keep one remote run at a time; all jobs share the laptop’s configured cores.

## Full runs

`pnpm verify:main --ref origin/main` runs every suite on main; fetch main first.
The scheduled task runs it once a day on main. It checks out that commit in a temporary worktree on the scratch volume and
runs unit tests, Quint checks, conformance, gallery and desktop tests as
one plan of separate unit, specs, gallery and desktop SSH jobs on the laptop.
Gallery and desktop each request two physical cores; desktop can start when
unit releases its two cores, without increasing Juno's lent allocation. Heavy sync tests stay in
this run. Random Quint simulations run each time; deterministic Apalache and
typecheck results use the cache. Changes to sync or outbox code also trigger selective protocol checks.

`pnpm verify:main --ref origin/main --nightly` implies
`--no-cache` for Quint and `--with-mac` for the Mac-only e2e tests, perf and feel,
including the fine idle-CPU budgets. A run without them checks
only the coarse idle runaway ceiling.
Those flags also work separately. Perf and feel run sequentially after the
other suites and hold the exclusive heavy lock. Ordinary UI changes do not
require a full Mac run. Keep timing gates on a quiet Mac and inspect its load.

Results live in the main checkout's shared `.juno-status`: the latest
`verify-main.json` and `.md`, permanent per-commit JSON under
`verify-main/commits/<commit>/<run>.json`, and logs under `verify-main/<run>/`.
The summary includes tests that passed on retry. A failed suite or coordinator
exits 1, including report collection failures after successful steps. The command
refreshes the coverage map in the invoking checkout; commit that map after a run
on main.

On 2026-10-20, the successful baseline at `f5d3854e4` took 2,079.332 s
wall time. One split-job candidate at `4260ce84e`, after merging main at
`67cffc883`, took 1,330.647 s, including a 748 s allocator wait for specs.
Step times were unit 192 → 265 s, Quint 347 → 418 s, conformance 15 → 19 s,
gallery 1,139 → 1,055 s and desktop 933 → 1,317 s. Gallery passed 312 tests
against 297 before; desktop passed 457 against 418. Both had no flakes or
failures. Four gallery workers peaked at 3.90 GiB under the existing 6 GiB
cap, so that setting stays. This is one observed pair across intervening app
and flake fixes, not a controlled worker benchmark. Desktop now dominates.
[Full-run measurements](test-speed-5.md) record each job's wall time, queues,
guard controls, coverage merge and the unimplemented selective-state estimate.
