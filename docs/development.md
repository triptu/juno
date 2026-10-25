# Development

How to build and run Juno, and how the repo is put together.

## Prerequisites

- Node 24 or newer (Node 26 is what this was built with), for the few tools that stay on Node (see "Runtimes").
- The Bun canary build that `packageManager` in `package.json` names: `1.4.4-canary.20261023.1`, commit `5c6d4e24c`. Canary builds have `bun lint`. Every canary of a release prints the same `bun --version`, so check the build with `bun --revision`, which prints `1.4.4-canary.1+5c6d4e24c`. `bun upgrade --canary` installs the newest canary, which may be another build, so install this one from npm: `npm pack @oven/bun-darwin-aarch64@1.4.4-canary.20261023.1`, `tar -xzf oven-bun-darwin-aarch64-1.4.4-canary.20261023.1.tgz package/bin/bun`, then move `package/bin/bun` to `~/.bun/bin/bun`. The root `preinstall` script (`scripts/check-bun.mjs`) stops an install with any other build. The remote image and CI install the same build with `npm install -g bun@<version>`.
- macOS for the window chrome and e2e tests. Nothing else is platform-specific yet.
- Playwright's Chromium headless shell (`bunx playwright install chromium --only-shell`), for gallery tests and screenshots.
- Git LFS (`brew install git-lfs`, then `git lfs install` once), for the images and videos under `docs/`.
- On macOS, Homebrew's SQLite (`brew install sqlite`), for the store's unit tests on Bun (see "Pitfalls", `node:sqlite`). `JUNO_SQLITE=<libsqlite3.dylib>` names another full build.

No Playwright browser download is needed for the desktop e2e tests. Electron is the browser. The
gallery projects use Playwright's pinned Chromium headless shell. Set
`GALLERY_BROWSER=chrome` to diagnose a problem with the installed Google Chrome instead.

### Git LFS

Images and videos under `docs/` (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.mp4`, `.webm`, `.mov`) are stored in Git LFS, as `.gitattributes` lists. They were about 240 MB of the 265 MB checkout on 10-18, and they made most of the repo's growth. Nothing the app, the tests or CI reads is under `docs/`, so a checkout without LFS gets pointer files there and still builds and tests. The app icon in `apps/desktop/build` stays a normal file.

- `git lfs install` adds the `pre-push` hook that uploads new images. Without it, a push leaves pointers on GitHub with nothing behind them. Worktrees share their clone's hooks, so once per clone is enough.
- `bun run lint` runs `scripts/check-lfs.mjs`, which fails when a file under `docs/` that should be in LFS is stored as the file itself. It also warns when the clone has no LFS `pre-push` hook.
- To clone without the images: `GIT_LFS_SKIP_SMUDGE=1 git clone ...`, then `git lfs pull --include="docs/design/home/**"` for the ones you need.

**A branch from before the move.** A branch that added or changed images before docs moved to LFS (10-18) stores them as normal files. After it merges or rebases onto main, `git status` lists those images as modified and `check-lfs` fails. Run `git add --renormalize docs` and commit; nothing in the images changes. A conflict on an image means both sides changed it: keep the branch's version with `git checkout --theirs <path>` during a merge (`--ours` during a rebase), then renormalize.

**History is not rewritten yet.** History from before 10-18 still holds the images as normal files, so a full clone still downloads them once (about 220 MB). A shallow clone (`--depth 1`) does not. A rewrite (`git lfs migrate import --everything` over the same patterns, then a force-push of main) is planned for a time when no other work is happening, because it changes every commit hash: every clone, worktree and open branch has to move to the new history. Before it runs, merge or close every open branch and stop every agent. Afterwards, re-clone, or `git fetch` and `git reset --hard origin/main` in each checkout, then delete the old worktrees.

## Runtimes

The repo's scripts, its tool tests, the evals and most live scripts run on Bun. The root and package scripts call `bun`, and a script that starts another uses the running Bun (`process.execPath`). Bun runs TypeScript directly and resolves `./sync` to `./sync.ts`, so these need no resolve hook. These stay on Node:

- **Scripts that open the store:** `bun run web`, `sync:live`, `sync:timeline`, `bench:sync`, `react:live`, `notif:replay`, `scripts/idle-live.ts` and the agent benchmarks in `packages/agent/bench`. `@effect/sql-sqlite-node` opens every database with `allowExtension: true`. Bun's `node:sqlite` on macOS uses the system SQLite, which is built without extension loading, so the open fails. These scripts start Node with `--import ./scripts/ts-resolve-hooks.mjs`, a small `module.registerHooks` resolver that tries `.ts`, `.tsx` and `/index.ts`.
- **Knip**, in `bun run health` and lint. It asks the runtime which imports are built in, and Bun's `module.isBuiltin` counts `ws` and `undici`, so knip under Bun reported `ws` and `@types/ws` as unused in three packages. Knip takes the same 1.6 s on either runtime.
- **electron-builder**, which supports only Node: `bun run package` runs `apps/desktop/build/package.cjs` with Node.
- **Playwright's test runner.** `bun run` starts `playwright test` through the CLI's own `node` shebang. Playwright's library works under Bun (`huddle:live` and `build-icons.mjs` use it).
- **Electron**, which runs its own Node 24 for main and the engine, and the unit tests' child scripts that use the resolve hook (the agent's crash and recovery fixtures).

The tool tests (`test:repo-tools`, `test:runner`, `test:health`) run under `bun test`. Their files import `node:test` and `node:assert`; Bun runs them, including `t.after`, `timeout` and `skip`. They use real commands against temporary Git repositories and fake external tools, with no module or console mocks. `scripts/tool-test-fixture.mjs` supplies private homes, Git configuration and temporary directories. Run individual files locally; run the full group or parallel checks on the laptop with `bun run remote test:repo-tools`, `test:runner` or `test:health`.

## Commands

Run these from the repo root.

| Command | What it does |
| --- | --- |
| `bun install` | Installs everything, linking packages from Bun's global store (see "Worktrees and installs"). |
| `bun run dev` | Starts electron-vite with HMR for the renderer and reload for main and preload. |
| `bun run build` | Builds main, preload and renderer into `apps/desktop/out/` (main and preload in one process, the renderer in another, at the same time: `scripts/build-desktop.mjs`), then checks the renderer bundle size. |
| `bun run typecheck` | Fast local check of all Bun-compatible projects with the pinned Bun; see "Typecheck". |
| `bun run typecheck:tsc` | Manual TypeScript check of every project. |
| `bun run typecheck:parity` | Manual comparison of Bun and TypeScript diagnostics across projects; bypasses result caches. |
| `bun run lint` | Runs `bun lint` with the rules in `.oxlintrc.json` and refuses warnings, plus cursor and token checks, dependency and fixture checks, and the health ratchet, all at once (`scripts/lint.mjs`; see "Typecheck"). |
| `bun run check-deps` | The package graph and the import rules in `docs/architecture.md` section 3. Part of `bun run lint`; run it alone for a quicker loop. |
| `bun run health` | Reports unused code and dependencies, duplication, and large files and functions. Writes `.juno-status/health.json`. |
| `bun run test` | Runs every package's unit tests in one `bun test --parallel --no-isolate` from the root (`scripts/unit.mjs`), in a shuffled order whose seed it prints. `--files <repo paths>` runs only those files; `--seed <n>` repeats an order; `--isolate` gives each file a fresh global. |
| `bun run test:dom` | Runs the DOM lane (`apps/desktop/dom/`): user flows in happy-dom against the engine host and fake Slack, under one `bun test --parallel --no-isolate` (`scripts/dom-tests.mjs`). Builds `apps/desktop/dom/dist/` through `build-cached` first. `--files <repo paths>` and `--seed <n>` as for `bun run test`; run it remotely (`bun run remote test:dom`). |
| `bun run test:e2e` | Builds, runs the Playwright tests against the built app, then the gallery behaviour tests. |
| `bun run perf` | Builds and runs the perf scenarios (`apps/desktop/e2e/perf.spec.ts`, config `playwright.perf.config.ts`), which fail over the budgets in `docs/performance.md`. A scenario that did not run, because its group's setup or an earlier scenario failed, fails the run too (`e2e/no-skips.ts`). `-g "<name>"` runs some of them; `JUNO_PERF_TRACE=<dir>` also writes traces for `scripts/perf-trace.mjs`. Passing `--reporter` replaces that check, so do not. |
| `bun run test:gallery` | Builds the gallery and runs only its behaviour tests (mouse-down activation, cursor rule, state switcher, layout-shift guard). |
| `bun run test:feel` | Builds, then records the feel suite against the fake Slack: slow-motion videos, filmstrips and frame checks in `apps/desktop/feel-report/`. See "The feel suite". |
| `bun run gallery` | Starts the fixture gallery at http://localhost:4174 (browser only, no Electron). |
| `bun run web` | Starts the web shell: the real app in a browser against a fake Slack, for UI-only work. No build, no Electron. `--host` listens on the LAN. See "Web shell". |
| `bun run gallery:shots` | Builds the gallery and screenshots every state in light and dark into `apps/gallery/shots/<Component>/<group>/<state>-<theme>.png`. |
| `bun run specs:check` | Checks every Quint spec in `specs/`, including the broken and corrected pairs for Juno Agent. Runs simulations three at a time, the Apalache checks on one shared server, and skips checks that passed before with the same inputs (see "Faster test runs"). `--memory`, `--actions` or `--recovery` selects one agent spec. See `specs/README.md`. |
| `bun run specs:conformance` | Generates Quint traces of `specs/outbox.qnt` and replays them against the engine and the fake Slack (`specs/README.md`, "Conformance"). About 30 s on a remote machine when its traces are cached. |
| `bun run remote <script>` | Runs a Linux-safe root script (`test`, `specs:check`, `specs:conformance`, `test:agent*`, `test:gallery`, `test:e2e`) on the shared SSH runner and streams the output. `--dry-run` shows what would be sent and run. See ADR 0013. |
| `bun run flake <spec>` | Repeats desktop e2e, gallery or package tests many times on remote machines (`-g <title>`, `--repeat 40`, `--machines 1\|2`, `--workers n`) and reports how many runs failed, with traces of the failures. See "Hunting a flaky test". |
| `bun run test:agent-contracts` | Runs the `agent-cards` and `agent-contract` property tests: card identities, digests, retries, the RPC codecs and the chat projection. |
| `bun run --cwd packages/agent-memory test` | Runs the pure memory rules' property tests. Its script takes the heavy-job lock itself. |
| `bun run --cwd packages/engine test` | Runs one package's suite (here the engine's: the port protocol over an in-memory MessageChannel, live query serving). |
| `bun run pictures:build`, `bun run pictures:upload` | Make the two WebP files of each of Home's pictures from their open-licence originals, and upload them to the R2 bucket `juno-art` (`scripts/pictures/README.md`). |
| `bun scripts/build-icons.mjs` | Rebuilds `apps/desktop/build/icon.icns` and `icon.png` from `assets/icon.svg`. See "App icon". |
| `bun run package` | Builds an unsigned DMG with electron-builder into `apps/desktop/release/`; signed builds also make a ZIP for in-place updates. The tag workflow builds these too; see "Releasing". |
| `JUNO_LIVE=1 bun run smoke:live` | The read-only live smoke against your real workspace (see "Sign-in and the live smoke"). `bun run smoke:live --fake` runs the same script against an in-process fake. |
| `JUNO_LIVE=1 bun run presence:live` | The live presence check (`scripts/presence-live.ts`): polls `users.getPresence` for you while Juno's socket is closed, open, tickling every 19 s, then idle, and prints presence values and seconds. Sends only `ping` and `tickle`. Research section 3, Presence. |
| `JUNO_LIVE=1 bun run sync:live` | The read-only sync dry run: the real `@juno/sync` cold boot against your workspace into a temporary directory, numbers only (see "The live sync dry run"). `bun run sync:live --fake` runs it against an in-process fake. |
| `JUNO_LIVE=1 node --import ./scripts/ts-resolve-hooks.mjs scripts/idle-live.ts` | The live idle check: the whole engine on the cached session, read-only as the timeline below, synced into `--dir` (kept, so a second run is a relaunch on the same cache) or a temporary folder, then left alone. Once no call has been made for 30 s it prints the share of one core every 10 s over `--idle` seconds (180 by default), the calls and the SQL statements run meanwhile (Juno's SQL text, never a value); `--profile DIR` writes a CPU profile of that window, `--fake-ai` runs the AI jobs on the engine's fake model, `--fake` uses the large fake seed. See performance.md 8.12. |
| `JUNO_LIVE=1 bun run sync:timeline` | The first sync timeline (`scripts/first-sync-live.ts`): the whole engine signed in from an empty data folder on the cached session, read-only (every write refused before it leaves, no AI key). Prints when the sidebar, Home and every conversation first show, when unread counts settle (all, and those of unread DMs and mentions), where each kind of conversation fell in the history order, history ends and the sync ends; Slack calls by method with retries, 429s and `Retry-After`; CPU and SQLite time. `--out FILE` writes the timeline as JSON (method names, counts and times only). `-- --fake` runs it on the large fake seed with the app's pacing, `--fake --small` on 16 conversations. See performance.md, "First sync timeline". |
| `JUNO_LIVE=1 bun run react:live` | The live reaction check: the whole engine on the cached session, reacting in your self-DM through the outbox, then removing and cleaning up. Writes only reactions and two test posts in the self-DM. `-- --probe-get` instead asks `reactions.get` (read-only) for stored messages of every kind. Shapes and codes only (research section 10, "Live reactions"). |
| `JUNO_LIVE=1 bun run forward:live` | The live forward check: in your self-DM only, posts a message and a reply, forwards them with `chat.shareMessage` with and without a note, tries a user id as the destination and a missing message, reads the history and deletes everything it made. Field names and codes only (research `slack-forward.md`). |
| `JUNO_LIVE=1 bun run broadcast:live` | The live check of sending an existing reply to the channel: in your self-DM only, posts a message and two replies, sends one to the channel with `chat.update` and `reply_broadcast`, tries it again, on the root and with text, reads Main and the thread, records the socket frames, and deletes everything it made. Field names and codes only (research `slack-data-access.md`, "Send an existing reply to the channel"). |
| `JUNO_LIVE=1 bun run huddle:live` | The huddle spike (`docs/plans/huddles.md`, phase 2): joins a huddle in the private test channel `juno-huddle-test` on the cached session with `rooms.join`, runs the answer through the Chime SDK in a local Chromium page with a fake microphone, prints a status line every 10 s for `--minutes N` (default 5), and always sends `rooms.leave`. `--create-only` finds or creates the channel and exits; `--socket` also prints room frames from the socket; `--headed` shows the window so you can hear the huddle. Writes only that channel's create, join and leave. Field names, codes and counts only. `-- --fake` stops after `rooms.join`. |
| `JUNO_LIVE=1 bun scripts/dnd-live.ts` | Reads Slack's notification schedule (the `dnd_*` prefs) on the cached session and prints it. `--apply` writes Juno's notification hours into it once (`--days 1,2,3,4,5 --from 540 --to 1140`, defaults otherwise) and reads them back; `--restore '<json>'` writes a printed schedule back. Calls only `users.prefs.get` and `users.prefs.set`, and writes only schedule prefs. Your own account only (research section 7, "Live write"). |
| `bun run ai:eval` | Runs every AI task on invented examples with the fake provider and prints the outputs. `JUNO_AI=live bun run ai:eval` uses OpenRouter through pi-ai with `OPENROUTER_API_KEY` (environment or `.env`) and prints outputs, latency and cost; without a key it says so and exits. `bun run ai:eval routeCheck` runs one task. See `packages/ai/README.md`. |
| `bun run notif:replay run\|sample\|label\|report` | Measures the notification decision against your own messages: replays the last N days from a copy of the app's store through the real classifier, samples about 300 for you to label on a local page, and reports agreement and a sweep of each notification constant. Real content stays under `/Volumes/AgentWork/scratch/`. See `scripts/notif-replay/README.md`. |
| `bun run agent:eval` | Runs the Juno Agent eval cases on the real turn engine with the scripted model and prints the report (CI runs the same through `bun run test`). `bun run agent:eval --live` uses OpenRouter with `OPENROUTER_API_KEY` (environment or `.env`), costs money, and saves the report under `packages/agent/eval/reports/`; `--model haiku` picks another family, `--case <id>` one case. See `packages/agent/eval/README.md`. |

`GALLERY_SHOTS_ONLY=Sidebar,Workspace bun run gallery:shots` refreshes only those components and leaves other shots untouched. Add `GALLERY_SHOTS_ACCENT=teal` to shoot them in another accent as `<state>-<theme>-teal.png`, beside the default accent's shots.

The switcher, key and index tests use `GalleryTestComponent`, declared in `apps/gallery/src/testFixtures.tsx`. It is registered only when the page is opened as `/?test-fixtures#/...`, so it never shows in the normal gallery or the screenshots. Each test run serves the built gallery on an ephemeral port and starts its own preview server. It never reuses another run's server.

Before calling work done: `bun run affected`, which covers typecheck, lint and the tests the change reaches (see "Affected tests").

Copy `.env.example` to `.env` for local secrets. `.env` is ignored by git.

## Worktrees and installs

Agents work in their own git worktrees. Create and remove them with the helper:

```sh
bun scripts/worktree.mjs add <name> [--base <ref>] [--branch <branch>] [--detach <ref>] [--no-install]
bun scripts/worktree.mjs remove <name-or-path> [--force] [--delete-branch]
```

`add` checks out `<branch>` (default `<name>`; an existing branch is reused, a new one starts at `--base`, default `origin/main`; `--detach <ref>` checks out a commit with no branch, as for a DMG build), runs `bun install --frozen-lockfile` and prints the path. Worktrees go in `/Volumes/AgentWork/worktrees/juno/` when that volume is mounted (file event logging and Spotlight are off there), else in `.claude/worktrees/`. `scripts/worktree-folder.mjs` decides the folder (the volume counts as mounted when `/Volumes/AgentWork/.fseventsd/no_log` exists) and is shared by the helper, `batch-merge.mjs` and packaging. It names the folder after the main checkout, also when run from a linked worktree such as `t3-1234`; `JUNO_WORKTREE_DIR` overrides it. Older worktrees under `.claude/worktrees/` stay until their branches merge. The helper writes `.metadata_never_index` into that folder so Spotlight skips it, and waits to install while the load average is above 8 on a local machine. Inside an allocated remote container it installs immediately: host-wide load includes other jobs outside its reserved CPU budget. `remove` removes the worktree and, with `--delete-branch`, deletes its branch if it is merged.

**The global store.** `bunfig.toml` sets the isolated linker with `globalStore = true`. Each package is written once into `~/.bun/install/cache/links/`, keyed by its version and its dependencies, and a project's `node_modules` holds only symlinks into it: about 1,100 entries per worktree. Many entries per worktree flood macOS's `fseventsd` when worktrees are created and deleted (about 260% CPU on 10-17, with pnpm's old per-worktree store of about 50,000 entries), so keep this setting. Measured on 10-24 with a warm store: `bun install` took 0.4 s into an empty `node_modules` and 0.05 s with nothing to change. Worktrees on the AgentWork volume link into the same store on the main disk.

What changes with it:

- **A package resolves only what it declares.** Inside the store, a package sees its own dependencies and peers, not the workspace's packages. Three packages need help: `@phosphor-icons/react` imports React's types without depending on `@types/react`, Playwright's Electron API imports `electron`, and Quint's Apalache client requires `protobufjs` and `semver`. `packageExtensions` in the root `package.json` declares them. Add an entry there when something fails only because a dependency cannot see a package it does not declare.
- **Install scripts are blocked.** Bun runs dependencies' install scripts only for packages in `trustedDependencies`, which is empty. None is needed: esbuild and Bun pick their platform binary from optional dependencies, koffi's prebuilt binary comes from `@koromix/koffi-<platform>`, and the Google and gRPC SDKs pulled in by pi-ai are not used. A trusted package also stays out of the global store, so trust one only when it cannot work otherwise.
- **Electron's binary is shared.** Electron 44 has no install script: the first `require('electron')` downloads and unpacks it (about 600 files, 300 MB) next to the package. With the global store that happens once per Electron version, not once per worktree.
- **Packaging copies its dependencies.** electron-builder cannot find the dependencies of dependencies in the shared store. `apps/desktop/build/package.cjs` first copies the app's `files` and its installed production dependencies, with theirs, as real files into a temporary folder (`deploy`), and packages from there. That folder is under `/Volumes/AgentWork/tmp` when the volume is mounted, else in the system temp folder. electron-builder's native rebuild then writes only into that copy, never into the shared store.
- **The app under test gets no `NODE_PATH` or `NODE_OPTIONS`.** The e2e fixture (`apps/desktop/e2e/fixtures.ts`) drops both, as the packaged app has neither; with a resolve hook left in, a Home send to a DM did not arrive in one e2e test.
- **New releases wait a day.** `minimumReleaseAge` in `bunfig.toml` holds back versions published less than a day ago. To take one sooner, add it to `minimumReleaseAgeExcludes` there.
- **Remote runs** install in their image the same way, against the runner's persistent Bun cache.

Regenerate the standard emoji catalog and search keywords with `bun scripts/emoji-catalog.mjs` (pinned sources; local input paths are documented at the top of the script); its CLDR notice ships in `apps/desktop/THIRD_PARTY_NOTICES.txt`. The everyday phrases it adds come from `scripts/emoji-intent.json`; `bun scripts/emoji-intent.ts` asks the model (OpenRouter, `OPENROUTER_API_KEY` from the environment or `.env`) for emoji the file lacks, `--all` for every emoji. Fix a bad phrase in `intentOverrides` in `emoji-catalog.mjs`, then rerun it.

## Decision log

Add one file per decision under `docs/decisions/log/`, named
`YYYY-MM-DD-HHMM-slug.md` using local IST time and a distinct descriptive slug.
Keep the existing one-line format, for example:

```md
- 10-17 00:55 · orchestrator · Record decisions in separate fragments to avoid merge conflicts.
```

Run `bun scripts/decision-log.mjs` and commit both the fragment and generated
`docs/decision-log.md`. Never edit the generated log by hand. Lint checks that it
matches the fragments. The builder sorts newest first, then by filename for ties;
`~` in a reconstructed entry's time stays in its text. The status page reads the
built file. Historical fragments use a numeric prefix in the slug to preserve
their original order when timestamps match.

## Batch merges

Run `bun run test:repo-tools` for the CLI checks using temporary Git repositories (batch merges and the migration order check).

Fetch `origin/main`, then run from the repository root:

```sh
bun scripts/batch-merge.mjs branch-one branch-two
bun scripts/batch-merge.mjs --continue batch-1
bun scripts/batch-merge.mjs --continue batch-1 --push
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
merges, the script installs with `bun install --frozen-lockfile`, rebuilds the
decision log, runs `bun run health:baseline`, and commits generated changes. Review
the baseline diff: regeneration records the merged tree's current health,
including any increases. Then it runs `bun run typecheck`, `bun run lint` and
`bun run affected --batch --base <batch base>`: the unit test files the merged
change reaches, plus `specs:check` and `specs:conformance` when the code the
specs model changed ("Affected tests"), on one machine. Files that passed with
the same inputs, in an agent's run or an earlier batch, are skipped through the
shared results cache. The full suites are not part of a batch (see "Testing").
When the SSH runner is unavailable, the batch waits for it; `--local` runs those steps on this Mac
through the machine lock, and is only for when Tushar asks, since heavy runs make the Mac hang. A failed command retains the worktree;
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

Run `bun run health` for a summary and the largest clone pairs, files, and functions.
`bun run lint` runs the same scan with `--check` against `health-baseline.json`.
Knip and jscpd run concurrently; neither uses a cached result. Knip runs on Node
(see "Runtimes"), jscpd and the size scan on Bun. Lint runs the scan through
the heavy-job lock ("Heavy jobs share one queue"), so many agents' lints cannot
scan at once; `bun run health` does not take it. Tool errors fail both reporting and lint.

- **Knip** checks unused files, value exports, type exports, dependencies, and unlisted dependencies across all workspaces, scripts, and test entries. `bun run health:knip` prints every finding. Private package exports are included, so a barrel export with no consumers is a finding even if its implementation is used internally.
- **jscpd** checks `packages/*/src` and `apps/*/src`, including fixtures and CSS. Clones need at least 100 tokens and eight lines. Comments and whitespace do not count as matching tokens. The percentage is duplicated lines divided by scanned source lines. `bun run health:clones` writes the full clone report.
- **Size** checks tracked and new code files in apps, packages, scripts, and specs, including tests and configs. It reports files over 400 physical lines and functions over 80 lines using the TypeScript parser. Functions include methods, generators, and callbacks, with comments and blank lines inside their span; the test callback of a `*.flow.test.ts` file is left out, since it is one journey on one engine boot with named steps, and so is a desktop e2e test callback that names its steps with `test.step` (one launch per journey). Nested functions can overlap. `bun run health:size` prints every result.

`.juno-status/health.json` contains a timestamp, counts, duplication percentage, top offenders, and full Knip and size findings. `complete: false`, a null count, and an `errors` entry mean a tool failed, not that it found zero issues. Each external tool (`scripts/health-run.mjs`) gets 20 s on an idle machine, scaled by the one-minute load per core (at a load of 16 on 8 cores it gets 40 s) and capped at 120 s. A tool that runs out of time is tried once more with twice the limit. If it times out again, its `errors` entry has `timedOut: true` and lint says the tools timed out and no finding was checked: run `bun run lint` again when the machine is less busy. It still fails, because nothing was checked. Raw reports are in `.juno-status/knip-report.json` and `.juno-status/jscpd-report.json`; all reports are gitignored.

Knip exceptions are commented in `knip.config.mjs`. Fontsource dependencies are loaded by CSS `@import`, which Knip does not parse. The default exports of the Knip and electron-vite configs are tool entry points. The icon script resolves Playwright through desktop's manifest with `createRequire`, where it is declared. Exports used inside their own module are omitted because that code is live; unused barrel re-exports remain visible. Playwright's alternate configs, packaging hooks, agent evals and benchmarks, research spike scripts,
the agent's opt-in profiling setup file (`JUNO_UNIT_PROFILE=1`) and the engine's compile-time body compatibility check are explicit entries.
Knip finds the tool tests through its Bun plugin (`bun test` in the root scripts), which takes only
`*.test.*` and `*.spec.*` files as test entries, so any other file under a `test/` folder counts only
if something imports it. The `tracking`
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

To change the baseline deliberately, first run `bun run health` and inspect the full
reports. Fix false positives with a narrow, explained Knip entry or annotation.
Then run `bun run health:baseline`, review `git diff -- health-baseline.json`, and commit
it with the change and its reason. This command records current counts and lists,
including improvements. It refuses to record a failed scan. Do not hand-edit counts
to hide a tool failure. `bun run test:health` checks regression detection and stable
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
  web                   The web shell (bun run web): host/ in Node, page/ in the browser. Never in the app.
  electron.vite.config.ts
  renderer.vite.ts      The renderer's Vite plugins, shared by the app build and the web shell.
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
`assets/mark.svg` sit next to it). `bun scripts/build-icons.mjs` renders every iconset size
(16 to 1024, with @2x pairs) from the SVG in Chrome through Playwright, runs `iconutil`, and
writes two files that are committed:

- `apps/desktop/build/icon.icns`, used by electron-builder (`mac.icon` in `electron-builder.yml`).
- `apps/desktop/build/icon.png` (1024px), set as the Dock icon in development
  (`app.dock.setIcon` in `src/main/index.ts`), so `bun run dev` does not show Electron's icon.

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
4. `@stylexjs/unplugin` in `renderer.vite.ts` compiles every `stylex.create`
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

- Default arrow cursor, never `cursor: pointer`. `bun run lint` fails on it.
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
under plain Node and Bun too: the `bun test` suite in `packages/engine/test` connects the real
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
`OPENROUTER_API_KEY=… bun run dev`). To start again with no provider, delete both items
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

`JUNO_LIVE=1 bun run smoke:live` (`scripts/smoke-live.ts`) is the manual, read-only
check against your real workspace. It imports the session the same way (keychain
prompt), prints its call list, calls `auth.test`, `client.userBoot`,
`client.counts`, `subscriptions.thread.getView` and one `conversations.history`
on a channel you are a member of, connects the socket and reads 30 s of events
(`--seconds N` for longer), decodes everything through `@juno/slack-schema` and
reports failures by path only. Redacted shapes land in
`packages/slack-schema/test/fixtures/recorded/` (one file per method, one per
socket frame type), `packages/slack-schema/test/recorded.test.ts` decodes them,
and `bun run lint` runs `scripts/check-fixtures-redacted.mjs` over them so no id,
URL, email, timestamp or free text can be committed. The smoke refuses any
method outside its allow-list. `bun run smoke:live --fake` runs it against an
in-process fake, which is how it is checked in development.

Skipping the keychain prompt on later runs: `JUNO_LIVE=1 bun run smoke:live --
--cache-session` imports the session once (the Slack prompt appears) and keeps
the token, `d` cookie and team URL in a generic password of your login keychain
named `juno-dev-slack-session` (`security add-generic-password`, value passed on
stdin). Every later run finds it with `security find-generic-password` without a
prompt, because `security` itself created the item. `bun run smoke:live --
--forget-session` deletes it. Delete it when the session stops working
(`auth.test: SlackAuthRequired`) and cache again, or before handing the machine
to someone else. The desktop app never reads this item.

`JUNO_LIVE=1 bun run probe:live` (`scripts/probe-live.ts`) answers questions the smoke does not:
the cost of the M7 recheck, what `conversations.history` and `conversations.replies` return
around threads, the search response, file objects and thumbnail auth, and the notification
prefs. It reuses the cached session, refuses methods outside its own read-only allow-list, starts
calls 1.5 s apart, and honours `Retry-After` once. It prints counts, key censuses and
milliseconds only, and writes redacted shapes to `--out DIR` (a temporary directory by default);
copy a shape into the recorded fixtures by hand and run `bun scripts/check-fixtures-redacted.mjs`.
`-- --only search2` runs the Search tab checks with its own read-only allow-list, a 75-call hard cap, starts at least 3 seconds apart, and an immediate stop on any rate limit (no retry). It writes counts and fully redacted shapes under `/Volumes/AgentWork` by default, or `--out DIR`. `--section detail` is a separate targeted pass for word queries, date boundaries, saved filtering, count 101 and attachment links; it is not an automatic retry. The 10-24 research used 58 initial calls and 21 detail calls. The current full pass also samples human messages for word queries, so do not run both passes under one 80-call budget. No raw response or query value is written, and unexpected errors are suppressed.
`-- --only files` checks the newest self-DM image via an exact history re-read, probes `files.info`, and compares thumbnail GETs with and without the cookie. It prints booleans and statuses and writes no shapes. `-- --only search` runs the search part alone (four calls). `-- --only users` asks the edge
`users/info` about every person the newest conversations reference and reads one page of each
users list (about 14 calls). `-- --only external` reads one history page of the most recently active Slack Connect channels (six, or `--channels N`) and asks the edge `users/info` about their senders and joiners, with and without Slack's flags, and the Web API `users.info` about the ones the edge fails. `-- --only emoji` reads every edge `emojis/list` page and prints its key census (about 5 calls). `-- --only reactions` reads one history page of the 30 most recently active conversations and five of the general channel, counts reactions that list fewer people than their count, and asks `reactions.get` without and with `full` about three messages (about 43 calls). A full run is about 34 calls. The
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

`JUNO_LIVE=1 bun run sync:live` (`scripts/sync-live-dry-run.ts`) runs the real `@juno/sync`
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
background pass over the followed threads of the window is counted too (raise `--seconds` for it). `bun run sync:live --fake` runs the same script against an in-process fake, which is how
it is checked in development.

Both live scripts open the store, so they run under plain Node (see "Runtimes").
`@juno/sync`, `@juno/store` and `@juno/engine` use bundler-style relative imports (`./sync`
for `./sync.ts`), which Node does not resolve on its own, so `bun run sync:live` starts Node
with `--import ./scripts/ts-resolve-hooks.mjs`.

## IPC with main

`packages/contract/src/shellRoutes.ts` defines `ShellRoutes`: a channel name (from
`channels.ts`), an input schema and an output schema each. Only main reads it, so
it has its own module and the renderer's start bundle leaves it out; the schemas
live in `shell.ts`. Main registers handlers
through `handle()` in `src/main/ipc.ts`, which checks the sender is the main frame
of one of our windows showing `juno://app/` (or the Vite dev URL), decodes the
input and encodes the output. The preload turns each route into one function on
`window.juno`. The renderer decodes the answer again (see `packages/state/src/shell.ts`)
and exposes it as an atom.

`packages/contract/src/channels.ts` has no runtime imports. The preload bundles only
that file so it stays under a kilobyte.

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
   `src/fixtures.ts` and exported from `index.ts`. Check it in `bun run gallery`, one state at a time. Props in, callbacks out;
   no state, Effect or `window.juno`.
6. **Test.** `apps/desktop/e2e/<feature>.spec.ts` follows the user flow against the built app (and the
   fake Slack server once sign-in exists). Add engine or domain unit tests only for a rule that is actually tricky.

## Tests

| Kind | Where | Run |
| --- | --- | --- |
| Store, Slack client, Slack-app import, merge rules, engine protocol, session and sync; the Juno agent's flows (turns, cards, connections, T3 and Codex, backup, crash recovery, memory, settings), the AI provider (`PiAiProvider` against pi-ai's scripted faux provider), the agent libraries, and the pure rules of domain, rich text, state, huddle and the small libraries | `packages/<name>/test/`, `apps/desktop/test/` (`bun test`; each file passes alone, in any order, and after any other file in the same process) | `bun run test`, or `bun test --timeout=30000 <files>` in the package |
| Engine idle CPU, and the sidebar, topic and search queries on the large seed, failed on their budgets | `packages/engine/test/perf/*.perf.ts` | `bun run perf --unit` (Mac) |
| User flows that check what the app shows and sends, with no layout: the real renderer in happy-dom against the engine host and fake Slack | `apps/desktop/dom/` (`bun test`; [README](../apps/desktop/dom/README.md)) | `bun run test:dom` |
| User flows that need layout, scroll, paint, real focus or pointer coordinates, against the engine host; native Electron integration | `apps/desktop/e2e/` (Playwright browser and Electron projects) | `bun run test:browser`, `bun run test:electron`, or both with `bun run test:desktop` |
| Mouse-down activation, state switcher, in a real browser | `apps/gallery/activation.spec.ts`, `apps/gallery/behaviour.spec.ts` | `bun run test:gallery` |
| Sidebar row text contrast, each level in both themes and every accent | `apps/gallery/contrast.spec.ts` | `bun run test:gallery` |
| No layout shift on hover, press or focus, and the cursor rule, in every state | `apps/gallery/shift.spec.ts` (helper: `packages/testing`) | `bun run test:gallery` |
| Topic art: fades on screen, whole when an off-screen row scrolls in | `apps/gallery/topic-art.spec.ts` | `bun run test:gallery` |
| Sidebar rows as views: a DM's preview, the group DM tile, the row's description, the title tooltip, the list scrollbar | `apps/gallery/sidebar-rows.spec.ts` | `bun run test:gallery` |
| Screenshots of every state | `apps/gallery/shots.spec.ts` | `bun run gallery:shots` |
| Feel: no shift, jump, flicker, empty frame or late feedback, frame by frame, in the built app | `apps/desktop/e2e/feel/*.feel.ts` | `bun run test:feel` |

Unit tests run on `bun test` with the preload in `packages/testing/src/preload.ts` (Node-compatible SQLite, a 30 s test timeout).

**Order and isolation.** Every `bun test` run is shuffled: the files, and the tests in each file. `bun run test` picks a seed, prints it first (`unit: test order seed <n>`) and passes it to Bun; `bun run test --seed <n>` (or `JUNO_TEST_SEED=<n>`) repeats that order, with `--files` too. `verify:main` keeps the seed in its record (`testSeed`, and a line in `verify-main.md`) and `affected` in the unit step's arguments. Elsewhere `randomize = true` in each `bunfig.toml` and `--randomize` in each package's `test` script shuffle the order, and Bun prints `--seed=<n>` at the end. A test that fails only in some orders has a fault: fix its cause, do not pin an order.

The unit run uses `--no-isolate`: each worker keeps one global and module registry across the files it runs, so the preload, the engine's migrated-store template and its synced workspace are built once per worker, not once per file. A file must leave nothing behind: stop its engines, servers and timers, put back any global it replaced, and remove its folders. `bun run test --isolate` (or `JUNO_TEST_ISOLATE=1`) gives each file a fresh global again; when a failure goes away with `--isolate` and the same seed, an earlier file in that worker left something behind.

A preload runs once per Bun process, and its `setDefaultTimeout` reaches only the first file that process runs; later files get Bun's 5 s. So `scripts/unit.mjs`, each package's `test` script and the tool test scripts pass `--timeout=30000`. Run a package's files by hand the same way (`bun test --timeout=30000 <files>`); `bunfig.toml` has no timeout setting.

### Unit run measurements, 2026-10-24

All 166 files and 2,386 tests on the SSH laptop, two physical cores (four threads, four workers), each run its own job. Time is Bun's own total; CPU is the runner's average busy share of the four threads.

| Mode | Runs | Bun time | CPU busy | Result |
| --- | --- | --- | --- | --- |
| `--isolate`, fixed order, slowest first (before) | 2 | 77.1, 77.0 s | 84%, 85% | all passed |
| `--no-isolate`, fixed order | 2 | 61.6, 62.7 s | 76%, 74% | all passed |
| `--no-isolate`, shuffled, seeds 11, 22, 33, 44 | 4 | 59.3, 67.2, 59.8, 57.6 s | 80%, 78%, 82%, 83% | seed 44 failed one test: a 5 s timeout, below |
| New default: `--no-isolate`, shuffled, `--timeout=30000` | 3 | 66.4, 64.9, 64.7 s | 87%, 87%, 79% | all passed |
| `--isolate`, shuffled, `--timeout=30000` | 1 | 73.4 s | 90% | all passed |

No-isolate takes about 15% less time and about 15% less CPU (busy share × time: 255 → 202–230 thread-seconds); against a shuffled `--isolate` run it saves about 9 s. Shuffling loses the slowest-first start; within these runs it cost no clear time. The one failure was `huddle-recovery.flow.test.ts` timing out after 5 s: with `--no-isolate` the preload's 30 s default reached only the first file of each worker. The same happens to any multi-file `bun test` without `--parallel`, such as `cd packages/engine && bun test`, so the timeout is now on the command line. No failure in these seven shuffled runs came from another file's state or from the order of tests. These are single runs per seed under shared load, not medians. Tests that need the Effect test clock use `itEffect` from `@juno/testing/effect`, which provides `TestClock` and runs the effect; to time out a call that is in flight, fork it, wait until the request reaches the fake (a promise the fake resolves), then `TestClock.adjust` (`packages/ai/test/pi.test.ts`). Wait on a real signal (a Deferred, a subscription, a fake's call log); where there is none, `eventually` from `@juno/testing/eventually` retries a check. See the effect skill.

### Unit run measurements, 2026-10-25

All 168 files on two physical cores of the SSH laptop (four threads), the same seed (3952231788), one run each, so single observations under shared load. Before is the 10-24 full run; after is commit `0ff93659e`.

| Run | Workers | Bun time | Summed test time | Result |
| --- | --- | --- | --- | --- |
| Before | 4 | 79.4 s | 306 s | all passed |
| After | 4 | 54.3 s | 208 s | all passed |
| After | 8 | 65.6 s | | one timing-sensitive markdown test failed |

The run is CPU-bound (CPU 95–99% busy), so four workers, one per thread, stay the default. What changed: the crash tests start each agent program from a bundle built once per test process (`runAgent`), not from source (`recovery.test.ts` 25.0 → 5.6 s, `backup-crash.test.ts` 13.5 → 6.0 s); the mutation repair seed is 1,500 messages over two days (the large-seed test 18.9 → 5.2 s); periodic sweeps in the flow tests run on test-driven time; rate-limit tests use sub-second Retry-After values with a short `slackInteractiveMaxWaitMillis` (14.3 s → off the slowest list); first-sync, agent-host and reads start from smaller seeds or the synced template. A warm engine boot costs about 90 ms of CPU and waits on no timer, so the rest is the tests' own work; about 40 s needs a third core.

### Desktop lane measurements, 2026-10-24

The full measurement at `7aa940589` passed both desktop lanes on the SSH laptop: **222 s browser, 73 s Electron, 295 s combined**. It used four physical cores (eight allocated threads), eight browser workers and eight Electron workers, in sequence. Coverage and traces were off, CPU timing was on, and there were no retries, failures or skips. The job averaged 89% CPU busy (99% median), with 6.64 GB peak container memory including file cache.

These are command wall times, including each build or cache check, excluding SSH upload, allocation wait and install:

| Run | Physical cores / threads | Browser | Electron | Combined | Result |
| --- | --- | ---: | ---: | ---: | --- |
| Inherited branch | 2 / 4 | 711 s | 187 s | 898 s | AI activity failed |
| CPU baseline, four workers per lane | 4 / 8 | 387 s | 111 s | 498 s | Code-highlight row click failed |
| Final, eight workers per lane | 4 / 8 | 222 s | 73 s | 295 s | Both lanes passed |

The initial allocation was smaller, so 898 → 295 s is not a controlled speedup. The CPU baseline and final browser builds were cached; the baseline Electron setup rebuilt in 32.3 s, while both final setup steps checked cached outputs in about 0.1 s. A preceding run rebuilt the web renderer in 22.3 s and took 246 s for browser, before the last fixture-size reduction. These are individual observations, not repeated performance trials.

Counts exclude build setup cases and count a canary once in each lane:

| Lane | Before: spec files / cases | After: spec files / cases |
| --- | --- | --- |
| Browser | 123 / 450 (449 executed, one skipped) | 124 / 419, all passed |
| Electron | 39 / 122 (71 executed, 51 skipped) | 32 / 63, all passed |

The agent-flow consolidation on main removed 35 cases. Remaining renderer flows moved from mixed native files, notification-hours checks joined the notification flows, and duplicate diagnostics, key-limit, session and engine-restart checks joined existing flows. Manual screenshot tools and Mac performance specs are outside ordinary Electron discovery. Every surviving non-agent BROWSER-class file in the audit is registered. One canary remains in both lanes; [Browser lane](../apps/desktop/e2e/README.md#browser-lane) lists them and the native responsibilities retained in Electron.

Across 387 matching measured browser flows, mean CPU cost per test was:

| Process | Before | After |
| --- | ---: | ---: |
| Host: engine/agent, including boot and sync | 1,984 ms | 856 ms |
| Renderer | 1,812 ms | 1,760 ms |
| Chrome browser, utility and GPU | 533 ms | 452 ms |
| Playwright worker, including fake Slack | 398 ms | 378 ms |

Host CPU summed to 767.94 → 331.09 s across those flows; renderer 701.34 → 681.12; Chrome browser/utility/GPU 206.27 → 175.05; worker plus fake 153.93 → 146.25. Median host cost fell from 1,870 to 710 CPU-ms, renderer from 1,680 to 1,630, and worker plus fake from 350 to 330. A controlled 26-flow sample at four workers also cut summed flow time from 105.26 to 64.14 s and host CPU from 47.66 to 27.65 s, while renderer CPU stayed at 43.68 → 42.63 s.

The savings come from reusing loaded host processes and immutable browser assets, with a fresh engine, page, fake and data folder per test; clearing context storage and permissions; using synced snapshots for ordinary flows; and sizing the title-layout seed to its measured scroll range. Clock-installing tests request a fresh context. Renderer work now dominates. Process counters cover the running fixture and omit processes that already exited. The host counter does not split boot from sync, and fake Slack shares the Playwright worker, so its separate CPU is bounded by that worker total, not independently profiled.

Reproduce with `bun run remote --cores 4 --env JUNO_E2E_CPU=1 --env JUNO_E2E_TIMINGS=1 test:plan test:browser + test:electron`. The final artifact is `.remote/juno-1792827331204-36052-d37acacc/`; the per-test counters are in `run.log`. The IST work log and parsed before/after counters are under `/Volumes/AgentWork/scratch/test-revamp/` (`browser-lane-log.md`, `browser-lane-4-green-cpu.json`).

Later layout and focus repairs passed 178 selected unit tests, 230 gallery checks, 272 desktop cases, health and 18 runner checks. The remaining release-fixture failure came from a worktree install waiting on host-wide load inside its allocated container; the fix passed the affected repair gate (47 repository-tool tests passed, one Mac-only case skipped). Typecheck and lint passed. These repairs through `e9d1f11c9` did not rerun the full lane timing above.

### Text-menu spelling checks

Electron uses the native macOS spellchecker, which detects the language itself.
`session.setSpellCheckerLanguages` has no effect there. Windows and Linux use
Hunspell dictionaries. See [Electron's spellchecker guide](https://www.electronjs.org/docs/latest/tutorial/spellchecker).

On macOS, right-clicking immediately after automated typing can select the word
before the asynchronous checker marks it. Electron then sends an empty
`misspelledWord` and `dictionarySuggestions`, even when the system checker knows
the word. Reopening the menu alone can keep returning empty spelling data.
This also occurs in a plain Electron textarea outside Juno.

`e2e/text-menu.spec.ts` retries the real menu. After a macOS attempt without the
expected guess, it moves the caret to the end and inserts then deletes a space
to trigger another check before the next attempt. Moving the caret alone does
not suffice. The test still requires the guess, Learn Spelling, menu order and
replacement of the misspelled word on every platform. Keep these assertions;
do not skip spelling on macOS or substitute a synthetic context-menu event.

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
`bun scripts/heavy.mjs bun run --cwd apps/desktop playwright test e2e/app.spec.ts -g "second launch" --repeat-each=10 --retries=0`.
`bun run flake` runs remotely. Set `DEBUG=pw:browser` to capture the first app's
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

`bun run gallery` serves every primitive and view at http://localhost:4174. A component page shows one state at a time, with the states listed beside it under group headings (a select above the frame in a narrow window). The list is plain system styling on purpose, so it is never mistaken for product UI.

- **Addresses.** `#/Button?__state=variant/primary&theme=dark&accent=claret`. `__state` is `<group>/<state>` (just `<state>` for a state declared without a group); no `__state` opens the first state. `theme` and `accent` are left out when they are the defaults. States draw in Compact density, the app's default; a state declares `frame.density: 'comfortable'` to draw in Comfortable, and `density=comfortable` or `density=compact` in the address overrides both. `#/` is the index, which lists each component with its groups and states. The old `#/Button/primary` still opens the first state with that key.
- **Keys.** `j` / `k` or the down / up arrows move between states; `[` and `]` switch components (wrapping). Keys are ignored while typing in a field, and the arrows are left to the component while focus is inside the frame.
- **Declaring states.** Group them under headings in product words (`Data`, `Session`, `Failure`, `Interaction`, `Overview`). See `packages/ui/README.md`. List only states the component's code can reach, add no branch to a component to make a state possible, and keep pending states still: nothing resolves on a timer. An unreachable fixture is removed, not kept for show.
- **Screenshots.** `bun run gallery:shots` writes `apps/gallery/shots/<Component>/<group>/<state>-<theme>.png`.
- **Behaviour specs.** The `behaviour` project in `apps/gallery/playwright.config.ts` runs every `*.spec.ts` in `apps/gallery/` except `shots.spec.ts`, so a new spec file runs without editing the config. `bun run affected` passes a changed spec as `/<name>.spec.ts`; the slash keeps `geometry.spec.ts` from also matching `list-geometry.spec.ts`.


### The layout-shift guard

Nothing may move when the pointer or the keyboard touches it. `expectNoLayoutShift(page, action)` from `@juno/testing/layout-shift` (`packages/testing`) runs `action` and fails with a report (the node, the old and new box, the delta) if anything shifted. It starts a `PerformanceObserver` for `layout-shift` entries just before the action, waits two frames and then until every transition or animation running under the frame has finished (one iteration of an endless one the action started; with `motion: 'layout'` only those of properties that can move a box, which the gallery uses), and counts every entry with a value above 0, including those Chromium marks `hadRecentInput`, except a `<video>`'s own controls (sources with no node inside a video's box, or an entry with no sources while a video with controls is under the frame). As a fallback it compares the layout box of every element in the frame (`offsetLeft`, `offsetTop`, `offsetWidth`, `offsetHeight`, relative to the frame) before and after. Those ignore transforms, so the press scale is not a shift but a change of size, border or position is, and nothing has to be excluded. The one allowance is `grows`, a selector of elements whose width may change while their left, top and height stay, for content that takes room a neighbour left (a sidebar row's preview once its count goes).

`apps/gallery/shift.spec.ts` hovers, leaves, presses, releases, focuses from the keyboard and blurs up to eight interactive elements per state, sampled from both ends of a longer list, with motion on. It also checks that an Avatar photo arriving late or failing moves nothing (the `photo/pending` state points at `/__fixture/pending.png`, which the gallery server never answers; the test answers it). The desktop e2e can import the same helper for sidebar hover, tab switches, live messages and image loads.

A fast sweep checks the same touches in every state without real input: `bun run remote --env GALLERY_SHIFT_COMPUTED=1 test:gallery computed-shift.spec.ts`. `checkForcedInteractions` (`@juno/testing/forced-shift`) rewrites `:hover`, `:active`, `:focus`, `:focus-visible` and `:focus-within` in the loaded sheets into attribute selectors of the same specificity, turns transitions off, sets those attributes where the browser would match and dispatches the pointer, mouse, key and focus events React listens to, all in one `page.evaluate` per state, and compares every box after each step with the guard's own comparison (both share `packages/testing/src/inPage.ts`). States open in one document through the gallery's hash. It took about 0.21 s a state on two cores (1,835 states in about 96 s at four workers), against about 2 s for the real walk. It cannot see a shift that exists only while a transition runs, one that waits for an animation frame or a ResizeObserver, or browser defaults of real input other than focus on press, so it does not replace the walk. Ordinary runs skip it: the walk's records already re-walk every state whose inputs changed, and on 10-25 an ordinary gallery job took 100 s with the sweep off and would take about twice that with it on. Its self-tests (`the computed tier itself`: hover padding, border and parent rules, a hover transition, a focus ring that takes room, `:focus-within` padding, a press and a mouse focus that change size, a root handler that renders on pointer over, a late chunk, and a gallery button with an injected rule) run every time. With the walk's regressions put back on current code (a hover margin on Button, TopicRow's time in flow on hover, Show result without its reserved width, the review explainer in the sheet's head, the review outcome slot sized by its label, the review key hints without their reserve) it failed on each.

The broad shift walk caches each successful state. A key holds only what can move that state's boxes:

- the state and its fixture's transitive workspace imports, and the gallery shell (the registry, frame and theme code, not `compositions.tsx` or `testFixtures.tsx`), its styles, assets and bundled fonts;
- the values of the design tokens those files read, in every theme, and of the tokens those values read. Tokens whose every value is a colour or a box shadow are left out: such a value is valid only where it paints, so it cannot move a box. A file that indexes a token group with a variable (`text[role]`) reads the whole group. The rest of the two token files (imports, constants, the theme lists) counts for every state; comments do not;
- stylesheets without comments and paint-only declarations (`color`, `background-*`, `box-shadow`, `opacity` and the like);
- the walk itself: `apps/gallery/shift-walk.ts` and what it imports, which includes `open-state.ts` (how a state is opened and when it is ready) and the guard in `packages/testing`. The rest of `shift.spec.ts` (delayed loads, the guard's self-tests), the queue and page recycling in `support.ts`, the Playwright config and other specs do not count for the shift walk;
- the locked versions of the packages those files import and the gallery builds with, and what those depend on, and the manifest fields that decide how imports resolve. Scripts, other workspaces' dependencies and an unrelated lockfile change do not count;
- the actual Playwright/Chromium version, OS release, architecture and browser options.

`apps/gallery/layout-tokens.mjs` decides which tokens and declarations paint. Named imports through barrels keep unrelated components independent; unknown fixture registrations conservatively include all source. A failed or incomplete state gets no record. Matching DOM alone never skips interactions: two fixtures can draw the same DOM with different callbacks.

Records are shared across worktrees in the system temp folder's `juno-cache/results/gallery-walk-v1`. With `JUNO_BUILD_CACHE_DIR` they live in its `gallery-walk-v1` child, beside build entries; the remote runner sets this to `/cache/builds`. Writes use temporary files and atomic rename. `GALLERY_SHIFT_ALL=1 bun run test:gallery` bypasses both walk caches and refreshes successful records. `verify:main --nightly` and `verify:main --no-cache` set it automatically. Ordinary verification reuses matching states. Playwright `--repeat-each` also bypasses the caches, so every repeat exercises the states.

`GALLERY_SHIFT_ONLY=Button,Chip` limits the shift walk; `GALLERY_SHIFT_PARTS` controls the number of queue consumers and defaults to the worker count. A remote job that runs only the gallery gets four workers per three allocated threads (eight on a full run's six), since the walk mostly waits for frames and motion; `scripts/remote/workers.sh` sets this. Existing remote shard selection remains supported. The queue is unique per run and repeat. Targeted interaction and delayed-load regressions run every time, even when all broad-walk states are cached.

Each test owns one browser context. A walk opens a new document for each state, resetting fixture module state, selection, focus and scroll. It replaces its page after 20 states while keeping that context's HTTP cache. Fonts, visible images, lazy chunks and finite entrance motion must settle before measurement; a readiness deadline fails the state instead of silently treating it as ready. Scrolling an interaction target settles before the guard starts, so remembered off-screen row sizes are not charged to the following input. Motion stays enabled during the shift walk.

The shift walk budgets three seconds per selected state, divided by the active worker count, with a 20-minute minimum for a full walk (15 minutes for a component selection). The fixed 20-minute limit cut off an otherwise progressing uncached Mac walk. Each state, including its document reset, still has a 30-second limit. Playwright tears down each test's context after success or failure.

Tests run in parallel with zero retries, using Playwright's pinned Chromium headless shell. Install it once with `bunx playwright install chromium --only-shell`. `GALLERY_BROWSER=chrome` is an explicit diagnostic override. Every test run selects a free preview port and starts its own server with a strict bind; it never reuses a server from another run. The interactive `bun run gallery` command remains on port 4174.

The suite keeps checks for interaction stability, delayed loads, keyboard activation and focus, cursor behavior, readable contrast, clipping and overlap. Fixed design dimensions and decorative screenshot probes belong to gallery review rather than the behavior gate. [The gallery README](../apps/gallery/README.md) records the spec audit and retained coverage.


### Gallery measurements, 2026-10-24

Single completed observations using the pinned Chromium headless shell. The runner had two physical cores and four workers; the Mac baseline used three workers.

| Host and mode | Root script time | Result |
| --- | --- | --- |
| Runner, original, warm build | 903 s | 359 passed, 6 platform skips |
| Runner, revised, full walk | 1,231 s | 237 passed |
| Runner, revised, cached walk | 73 s | 237 passed |
| Mac, original, warm build | 967.4 s | 373 passed |
| Mac, revised full/cached | No completed measurement | Interrupted by shared-host overload and restarts |

These are individual runs, not medians. The revised full runner run includes a 21.85 s build; the original restored its build in 0.01 s. Peak container memory was 4.15 GB before and 4.58 GB for the revised full walk, including file cache. Full verification checks 1,810 shift states and 774 focus states. It costs more because every state gets a fresh document and the original's 171 identical-DOM skips are now checked independently. Nightly and no-cache verification use this mode.

The fully cached run restored its build in 0.01 s and reused all 1,810 shift and 774 focus states; targeted regressions still ran. Peak container memory was 2.13 GB. Its observed script time was 91.9% shorter than the original. A separate recovery run checked the 423 states left unfinished by a host reset and passed in 246 s; it is not the warm-cache timing.

The first revised Mac full run reached the former fixed 20-minute part deadline; the workload-based budget replaces that fixed cutoff. Later comparison attempts were interrupted by load above eight or machine restarts and are excluded. Verification stayed on the remote runner after the 10:32 IST reset. No revised Mac speedup is claimed.

### Gallery workers, 2026-10-25

Single runs of `bun run remote --cores 3 --env GALLERY_SHIFT_ALL=1 --env GALLERY_WORKERS=<n> test:gallery` at `1e776b39c`, on the full run's gallery allocation (three physical cores, six threads, a 9 GB container limit). Each shift part ran its share of the full walk; the four focus-ring parts are fixed.

| Workers and shift parts | Script time | CPU busy, average | Peak container memory | Shift part durations | Result |
| --- | --- | --- | --- | --- | --- |
| 4 (the old default) | 1,101 s | 62% | 4.85 GB | 950–954 s | 225 passed |
| 6 | 776 s | 84% | 5.96 GB | 623–702 s | 227 passed |
| 8 (the new default) | 705 s | 94% | 6.73 GB | 506–637 s | 229 passed |

No run failed or retried a test. More workers slow each focus-ring part (79 s at 4 workers, 114 s at 6, 157 s at 8) because they share the CPU, but the shift walk sets the length of the job. With six threads 94% busy, more than eight workers would mostly queue for CPU and bring memory close to the limit, so it was not tried. The laptop's own memory use, with other jobs running beside these, peaked at 16.2–18.5 GB used, with 11.9–14.3 GB still available.

### Frame clock and page pool, 2026-10-25

Single runs of `bun run remote --cores 4 --env GALLERY_SHIFT_ALL=1 test:gallery shift.spec.ts` at `8febc617c` (before the eight-worker default), each on four physical cores (eight threads, six shift parts, a 12 GB container). About 1,830 states each.

| Variant | Frame interval | Shift part durations | Script time | CPU busy, average | Peak container memory | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Default | 16.7 ms | 579–582 s | 612 s | 65% | 5.81 GB | 51 passed |
| `--disable-frame-rate-limit --disable-gpu-vsync` | 17.3 ms | 572–576 s | 605 s | 78% | 6.28 GB | 51 passed |
| Three pages per shift part | 16.7 ms | 450 s | 480 s | 94% | 9.42 GB | 51 passed |

The headless shell keeps its 60 Hz frame clock with those flags, so the guard's two-frame wait is unchanged and the flags are not used. Three pages per part were faster only because the CPU had room; with eight workers the gallery allocation is already 94% busy, so the pool was not kept.

## Web shell

`bun run web` runs the real renderer in a browser, for UI-only work, with no build and no Electron. One Node process holds three things:

- a fake Slack with the default seed the e2e and feel tests use;
- the engine on a fresh temporary data folder, already signed in to the fake;
- Vite in dev mode (HMR) serving the renderer.

The page reaches the engine over a WebSocket that carries the same `effect/rpc` routes as the Electron port. It answers `window.juno` itself (`apps/desktop/web/page/bridge.ts`). The command prints one line with the app's address and the fake Slack's control API. Post to `<control>/<name>` to send messages, reactions and socket events while you look at the page; the controls are listed in `packages/fake-slack/README.md`.

- **Ports.** Each web-shell worktree gets its own port, derived from its path, with a strict port check to catch collisions. `JUNO_WEB_PORT` overrides it. The shell listens on 127.0.0.1; `--host` listens on the LAN, and the fake Slack stays on this Mac.
- **Stopping.** Ctrl-C stops everything and deletes the data folder. So does the end of the process that started it. A shell killed before it can clean up leaves its folder, and the next `bun run web` deletes it. Each shell holds a few hundred MB, so stop it when you are done.
- **Code.** `apps/desktop/web`: `host/` runs in Node, `page/` in the browser. The socket transport is `packages/state/src/socket.ts` and `packages/engine/src/protocol/socket.ts`. Nothing in `apps/desktop/src` imports the shell (`check-deps`), so it never reaches the Electron app.
- **Test.** `apps/desktop/e2e/web/web-shell.spec.ts` runs in the desktop suite’s `web` Playwright project, starts the CLI and checks in Chrome that a channel's Main reads, a message sends, a reaction lands, a context menu item works and the page reconnects after the socket drops. `bun run affected` runs it when the shell, the socket transport or the engine changes.

What it cannot do:

- Native menus and window chrome. Context menus are a plain HTML list. App-menu shortcuts work only where the browser does not keep the key for itself.
- Huddles, the Juno Agent's providers and Codex, notifications, the web panel, Quick Look, folder pickers, Open in Slack and updates. These answer "unavailable" or do nothing.
- Files from anywhere but the fake Slack. Other images show a grey placeholder.
- Perf and feel numbers. It is a dev build with React in development mode and no Content Security Policy, so those come from Electron only (`bun run perf`, `bun run test:feel`).

Desktop verification runs the browser and Electron lanes. The browser lane uses a production renderer build against a per-test engine and agent host; the web shell above stays a development tool. See [Desktop e2e](../apps/desktop/e2e/README.md#browser-lane).

## The feel suite

`bun run test:feel` records scripted interactions in the built app against the fake Slack and checks them frame by frame. It is separate from `test:e2e` (its own config, `apps/desktop/playwright.feel.config.ts`) because it records video and takes a few minutes.

- **Recording.** `e2e/feel/recorder.ts` takes every compositor frame through the CDP screencast, and on every animation frame reads a few DOM probes (a rectangle, the scroll position, the rows at the top and bottom edges of the view, header text, an element's computed look), plus `layout-shift` and `long-animation-frame` entries and the input events.
- **When probes read.** Once per frame, in a ResizeObserver created in that frame's `requestAnimationFrame`, so it is delivered after layout and after the app's own observers, just before paint. Reading in `requestAnimationFrame` itself sees states the app corrects before painting (the topic view pins its scroll position in a ResizeObserver), and reported jumps that never reached the screen. When a check and the images disagree, trust the images and fix the probe.
- **Checks.** `e2e/feel/checks.ts` turns a recording into verdicts: an element lands and stays, the list stays at the bottom, the row in view holds still, feedback shows in the first frame after the event, a popover opens whole at its anchor, the pane switches from the old state to the new one with nothing between, no blank or flickering region (pixel diffs between frames), no long frames. They count frames and compare geometry, so a loaded machine slows a run down without failing it. Only the long-frame check uses durations: a frame over 100 ms with the page's own work in it fails; other frames over 50 ms only warn.
- **Scenarios.** One `*.feel.ts` file per area: opening topics and what arrives while reading (`topic`), hover, press and popovers (`interaction`), a 300-message thread with late images, the divider, scrolling and reactions (`long`), tab restore (`tabs`), the Juno tab and panel and Juno images (`chat`), Home's review sheets (`reviews`), the sidebar's order hold (`sidebar-hold`), density and Settings (`settings`), the Home icon and Home's first sync (`home`), the lazy parts' first open after a launch (`lazy`), the picture page opening from Home and stepping (`pictures`) and the welcome card (`welcome`). A scenario that skips fails the run (`e2e/no-skips.ts`) unless it is a placeholder recorded with `recordSkipped`, which adds a `placeholder` annotation. Add a scenario with `feel.run({ name, title, probes, regions, checks }, action)`; mark steps with `rec.mark('press')` so checks can start there.
- **Artefacts.** `apps/desktop/feel-report/` (gitignored, emptied each run): per scenario `frames/NNNN.jpg`, `filmstrip.png` (labelled tiles, failed frames outlined in red), `video.webm` (4× slow motion) and `result.json`; and `index.html`, the contact sheet with every scenario's checks, video and filmstrip, failures first. Open it with `open apps/desktop/feel-report/index.html`.
- **Needs.** The installed Google Chrome draws the filmstrips and computes the pixel diffs (`FEEL_BROWSER=chromium` uses Playwright's build instead). ffmpeg encodes the videos (`brew install ffmpeg`); without it the run still checks and writes filmstrips, and says there is no video.

## Milestone reviews

At the end of each UI milestone, run these reviews in parallel and turn the findings into fix packages with disjoint files. Each writes to `docs/reviews/<milestone>/`.

1. **Design review.** The `interfaces:better-interface` skill on the built app and the gallery shots, as in `docs/reviews/m3/design-review.md`.
2. **Code and performance review.** The performance skill's review questions and `docs/performance.md` 7.4, with measured numbers against every budget, as in `docs/reviews/m3/code-perf-review.md`.
3. **Feel review.** The `feel-review` skill (`.claude/skills/feel-review/`): run `bun run test:feel`, read the contact sheet and the filmstrips, and report what shifts, jumps, flickers, flashes empty or answers late, with frame numbers.

## Pitfalls met while setting this up

- **`ELECTRON_RUN_AS_NODE=1` in the shell.** Editors built on Electron export it to
  child shells. With it set, Electron starts as plain Node and never opens a window.
  `scripts/without-run-as-node.mjs` strips it for `dev`, `start` and `test:e2e`, and
  `playwright.config.ts` deletes it again.
- **Electron's binary appears on first use.** Electron 44 has no install script:
  `apps/desktop/node_modules/electron/dist` appears the first time something requires
  `electron` (`node -e "require('electron')"` in `apps/desktop` fetches it).
- **`ws` in the bundled engine.** `ws` loads the optional native `bufferutil` inside a
  try. In the main build that require became an empty stub, so `ws` called a missing
  `mask` and died on every outgoing socket frame of 48 bytes or more (a `tickle` is 47,
  so only `presence_sub` showed it, 10-21). `electron.vite.config.ts` defines
  `process.env.WS_NO_BUFFER_UTIL` for the main build, which keeps `ws` on its own
  JavaScript masking. Engine tests under plain Node never saw it.
- **`node:sqlite` on Electron, Node and Bun.** Electron 44 runs Node 24.21 with SQLite
  3.53.4; the system Node is 26 (SQLite 3.54); Bun 1.4.4 uses the system SQLite on macOS
  (3.51) and its own on Linux. `@effect/sql-sqlite-node` uses `isTransaction`, `columns()`,
  `setReturnArrays` and `backup`, and the store uses FTS5, WAL and a read-only open of a
  WAL file; all were checked in Electron's own Node. Unit tests run on Bun, whose
  `node:sqlite` differs: the system SQLite cannot open a WAL database read-only without
  its `-shm` file and has no extension support, and Bun refuses booleans as bind values.
  The test preload (`packages/testing/src/preload.ts`) loads Homebrew's SQLite on macOS
  (`brew install sqlite`, or `JUNO_SQLITE=<libsqlite3.dylib>`), drops the `allowExtension`
  option, and binds booleans as 1 and 0 as Node does; `undefined` is refused on both.
  `packages/store/test/node-sqlite.test.ts` pins this. The desktop e2e suite runs the
  real store on Electron.
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
- **Renderer bundle size.** The budget is 1.1 MB of initial JS and 200 KB of CSS
  (`docs/performance.md`); `bun run build` runs `scripts/check-bundle-size.mjs` and fails
  over it. The M1 shell is 426.1 KB of JS (138.6 KB gzip) and 68.7 KB of CSS, minified.
  electron-vite does not minify by default, so the config sets `minify: 'oxc'`, Vite 8's
  minifier, for all three targets; without minifying the same code was 1,097 KB. Vite 8 does
  not install esbuild, so `minify: 'esbuild'` fails the build. Vite's CSS minifier does not
  reach the sheet StyleX writes, so the StyleX plugin minifies it itself
  (`lightningcssOptions: { minify: true }`); without it the same styles were 157.9 KB
  instead of 130.3 KB (10-20).

- **Vite 8 and Rolldown.** Build options are `rolldownOptions`, not `rollupOptions`. Knip's
  Vite plugin reads only `rollupOptions.input`, so `knip.config.mjs` lists main's inputs
  itself. The renderer keeps its first screen in one file with a `$initial` chunk group
  (`rendererOutput` in `apps/desktop/renderer.vite.ts`); without it the first screen was 65
  files. That group follows static imports before tree shaking, so a first-screen module that
  imports a lazy-only module puts it on the first screen even when nothing there calls it.
  `juno:inline-token-reads` turns a token read such as `colors['--background-subtle']` into its
  `var()` value, since Rolldown keeps a whole token group that a chunk imports
  (`docs/performance.md`, "Vite 8 first screen").

Effect and StyleX pitfalls are in their skills: `.claude/skills/effect/SKILL.md` ("Pitfalls") and
`.claude/skills/stylex/SKILL.md`.

## Faster test runs

- **Spec cache.** `bun run specs:check` stores each passing job in the system temp folder (`juno-cache/specs`). Keys include its arguments, output checks, spec and imports, Quint and Apalache versions, Bun/runtime version, OS and architecture. Worktrees share the cache. Saved output goes through the same checks and restores the same ITF trace. A changed spec reruns its jobs. The default seed is reproducible; `SPECS_SEED=<integer>` selects another. Full runs reuse unchanged checks; nightly runs choose and record a fresh seed. `SPECS_CACHE=off` or `--no-cache` bypasses all entries. Bump `cacheVersion` when result checks change.
- **Spec execution.** Run Quint on the laptop: `bun run remote specs:check --no-cache`. Each spec’s single-sample schedules share one Quint process and parse/typecheck. Each still gets a fresh evaluator, its original arguments, all output checks and its own ITF trace. Multi-sample runs retain their CLI processes. `SPECS_JOBS` controls concurrent simulation groups and typechecks. Independent Apalache servers run beside them, one check per server. The default is half the allocated threads, capped by cgroup memory after reserving 2 GiB for simulations/tmpfs and 2 GiB per JVM. Heaps default to 1,536 MiB. `--env SPECS_APALACHE=<n>` requests lanes within that memory cap; `SPECS_APALACHE_HEAP` overrides the heap. Local execution retains one server after simulations. The checker reports wall time, summed job seconds, logical job/cache counts and Quint process count (excluding evaluator children and JVM servers). Per-job results are in `specs/traces/check-results.json`.
- **Spec measurements (10-24).** Uncached checks took 632.6 s before on four physical cores and one JVM lane, and 353.0 s after on two cores and two JVM lanes. Both completed 383 jobs. Summed job time was 2,941.6 → 1,263.8 s; single-sample schedules were 2,005.7 → 165.8 s; Quint processes were 383 → 76. End-to-end remote time was 636.6 → 358.0 s. A warm run on one core took 0.3 s in the checker (7.3 s end to end), revalidated all 383 cached results and restored their traces, launching no Quint process. These are single observations under shared load with different allocations. [Every schedule’s outcome and fixed trace comparison](research/quint-schedule-equivalence.json) is retained.
- **Build skip.** `test:e2e`, `test:dom`, `perf`, `test:feel`, `test:gallery` and `gallery:shots` build through `scripts/build-cached.mjs`. Each output keys on what it bundles (`scripts/build-inputs.mjs`): the files its entry points and build configs reach through imports (relative and `@juno/*` imports, `?url` assets, `new URL(…, import.meta.url)` workers, CSS `@import` and `url()`, and the page's `<script>` and `<link>` tags), whole modules rather than the names taken from a barrel, the public folder Vite copies, every `package.json`, `tsconfig*.json`, `bunfig.toml` and `.browserslistrc` in those files' folders and above, the root manifest's resolution fields, and the locked versions of the outside packages they import and the bundler they run (`scripts/locked-packages.mjs`, shared with the gallery walk cache). The key also holds the build command, Node and Bun versions, platform, architecture and build flags (Vite variables, `JUNO_UNMINIFIED`, `JUNO_COVERAGE`, `NODE_ENV`, local `.env` files). Tests, e2e specs, docs, repo scripts and root scripts are outside every graph. A computed `import()`, `import.meta.glob`, a local import that names no file, or an output with no entry list keys on all source but tests, and the build prints `keying <dir>/ on all source` with the reason. `scripts/build-inputs.test.mjs` checks that each build follows its graph without widening, that a change to its configs or a sample of its sources changes its key, and that tests, docs and tools do not. `build-cached.mjs --key <dir> <command>` prints the key without building. Output bytes are verified before reuse. Remote runs also restore matching output from a persistent cache; a changed input, missing output or failed checksum rebuilds. `JUNO_REBUILD=1` forces a build. `bun run build` and `bun run dev` always build.
- **React Compiler cache.** The React Compiler's Babel pass was about 60% of every cold renderer, web and gallery build on the runner (10-25, CPU profiles: the compiler 8.5 s, Babel's traverse, parser and generator 6 s of a 36 s desktop build); minifying was 2 to 3 s. `apps/desktop/react-compiler.vite.ts` runs the same transform `@vitejs/plugin-react` 5 ran and stores each file's result under a hash of its path, source, the Vite root, the compiler options, `NODE_ENV`, `BABEL_ENV`, `globalThis.__DEV__` and `bun.lock`. The mode matters: under `NODE_ENV=development` the compiler adds code that resets each memo cache on edit, and on 10-25 a dev web shell's results read back by a build put the first bundle 18 KB over its budget (`apps/desktop/test/react-compiler-cache.test.ts`). A new commit changes few files, so a build that misses the build cache still reads nearly every file from it. Entries live in `react-compiler-v1` under `JUNO_BUILD_CACHE_DIR` (the runner's `/cache/builds`, shared by every job) or the system temp folder's `juno-cache`; entries not written for a week are removed. `JUNO_REACT_COMPILER_CACHE=0` turns it off, and `bun run package` does, so a release compiles every file. The desktop, web and gallery outputs were byte-identical with and without it.
- **Build measurements (10-25).** On 3 physical cores of the runner, outside Playwright, each build run twice with the React Compiler cache full and twice with it off (`JUNO_REACT_COMPILER_CACHE=0`), interleaved. Vite 8 and Rolldown, cache full: desktop `out/` 5.2 s, web 5.2 to 5.3 s, gallery 4.7 to 5.1 s, DOM lane 5.2 to 5.7 s. Cache off: 17.8 to 20.4, 20.2 to 20.9, 15.8 to 16.2 and 18.8 to 21.8 s. On Vite 7 the same runs took 13.1 to 14.0, 12.2 to 12.7, 8.9 to 9.7 and 11.9 to 12.9 s with the cache, and 27.6 to 28.2, 26.0 to 27.7, 18.7 to 19.9 and 27.0 to 27.3 s without it. The compiler's Babel pass is most of a build without the cache, so the cache stays. With an empty build cache on Vite 7, desktop took 35.6 s before the compiler cache and the parallel targets. An unminified build saved little, so test builds stay minified, like the app. After the merge with main on 10-26, single runs on 3 runner cores with the cache full (each build run twice, the second shown): Vite 8 desktop `out/` 5.5 s, web 5.3 s, gallery 4.9 s, DOM lane 5.6 s; main on Vite 7 12.6, 11.4, 8.9 and 12.3 s. The first screen was 1,087.6 KB in one file, against 1,098.7 KB on main.
- **Shift guard.** The gallery caches successful states by their layout inputs and browser runtime. Its parts take uncached states from a shared queue and check interactions and the cursor rule with motion enabled. `GALLERY_SHIFT_ALL=1` forces the shift walk. `GALLERY_SHIFT_ONLY=Button,Chip bun run test:gallery` checks a few components while you iterate.
- **Changed tests only.** `bun run test --changed=main` runs only the `bun test` files affected by changes since `main` (Bun follows imports across packages).
- **One parallel unit run.** `bun run test` runs every `bun test` package in one `bun test --parallel --no-isolate` from the root, `JUNO_TEST_WORKERS` worker processes at once (default half the cores), each keeping its globals and modules across the files it runs, in a shuffled order ("Order and isolation" under "Tests").
- **Remote runs.** `bun run remote <script>` takes no local slot. See "Remote runs" below.

## Typecheck

TypeScript 7.0.2 remains installed for the manual `bun run typecheck:tsc` path and parity comparison. Routine checks use the Bun that runs the scripts, the canary build `packageManager` in `package.json` pins (see "Prerequisites").

`bun run typecheck` runs `bun check -b` over every project that Bun supports, locally. The checker reads the project inventory and dependency hashes from `scripts/typecheck.mjs`, builds a temporary solution config, and stores passing results separately in the shared system temp folder (`juno-cache/typecheck-bun`), keyed by `bun --revision`, so another Bun build checks everything again. `--no-cache` checks every supported project. Bun has no incremental build cache. Projects with unsupported compiler settings produce one warning naming the project and are skipped; there is no TypeScript fallback. Today all 35 project configs support Bun.

`bun run typecheck:tsc` is the manual TypeScript-only check. No automatic check, hook, or scheduled run invokes it. `bun run typecheck:parity` is also manual; it compares Bun and `tsc -b --force`, bypasses result caches, and fails if any project cannot be compared. Neither command is part of routine verification.

**Type stripping.** Node runs some TypeScript from source by stripping types: the scripts that open the store (see "Runtimes") and the agent's crash and recovery fixtures, which reach the engine and most packages under it. Node cannot strip syntax that emits code, such as parameter properties (`constructor(private readonly x)`), enums or namespaces, and fails at load time. So every package such code reaches sets `erasableSyntaxOnly` in its `tsconfig.json`, and `bun run typecheck` reports that syntax: all of `packages/` except `ui`, `views`, `tokens` and `testing`, and `scripts/tsconfig.json`. The desktop app, `ui` and `views` are bundled by Vite and may use it. A package that Node starts to run from source needs the flag too; the flag applies to every file in a project's program, so a bundled package it imports must follow the rule as well.

`bun run lint` runs its eleven checks at once through `scripts/lint.mjs`: `bun lint`, the decision log, the cache epoch, the migration order, the cursor rule, the duotone icons (`check-duotone.mjs`), tokens, `check-deps`, the fixture check, the LFS check and the health ratchet. None depends on another. Each check's output is printed as one group, under a line with its name, result and time, when it finishes. Lint fails if any check fails, and its last line names the ones that did.

Measured on 10-17 on this Mac, eight alternating runs of each while other agents kept the load at 5.5 to 7.3 on 8 cores, so the numbers vary a lot. The checks one after another with `&&` took 5.5 s median (fastest 3.0 s). At once they took 4.8 s median (fastest 2.2 s). In the parallel run every check except health finishes within 0.7 s. Health takes 2.6 s, and knip alone takes 1.9 to 2.0 s, so knip sets the floor. Making lint faster than that means making knip faster.

`bun lint` reads `.oxlintrc.json` (the oxlint format) and honours `oxlint-disable` comments. It runs with `--no-script`, since without it `bun lint` runs the root `lint` script, and with `--deny-warnings`, so a warning fails the check. Every enabled rule is an error; `consistent-function-scoping` and `no-shadow` are off because they are pure style and their 309 existing findings did not justify code churn. In the 10-24 runtime comparison, Bun reported the same 419 warnings as oxlint 1.87.0 over the same 2,238 files and 148 rules, in 0.08 s against oxlint's 0.21 s (medians of five alternating runs). `--type-aware` stays off: it took 1.4 s and reported 266 errors and about 2,500 more warnings from 25 rules that need types, mostly `no-unsafe-type-assertion`, `no-floating-promises` and `unbound-method`. Moving the rules into `bunfig.toml` dropped 22 React rules, because Bun enables React rules only when the root `package.json` lists React, so the rules stay in `.oxlintrc.json`.

`bun run lint` stays whole: `bun lint`, the cursor rule, `check-deps` and the fixture check take about 3 s together even on the loaded Mac, and `check-deps` needs the whole package graph to see a bad edge.

## Local Bun checks

`bun run affected` uses the same local Bun check before starting remote test suites. It checks pending projects with `bun check -b --no-pretty --all`; a type error stops the run before remote suites start. Unsupported configs are warned about and skipped. It never runs TypeScript.

## Testing

Agents run selective checks before reporting. Full runs (`bun run verify:main`, "Full runs") are not scheduled; they run when Tushar asks or a release needs one. The agent that runs one with `--nightly` commits the refreshed coverage map and merges it. A release follows `.claude/skills/do-release/SKILL.md`. Remote jobs share the laptop through tstack, including jobs from other projects.

**Agents.** Before reporting, an agent runs `bun run affected`: the local Bun check and lint, then, as one remote plan with separate SSH jobs, the unit and DOM lane files its change reaches, the specs it added or changed, the specs it names with `--spec`, and optional desktop specs that cover the change most directly within a 300-second estimated test budget ("Affected tests"). Heavy tests run only when the change is in their area, Quint only when its inputs changed, and conformance only when outbox inputs changed. `bun run affected --plan` first shows what it would run and why. `--wide` runs every spec the change can reach, for the rare change that needs it. One remote run at a time per agent. To run a few unit test files by hand, use `bun run remote test --passWithNoTests <files>` (paths relative to their package); one spec, `bun run remote test:desktop <files>`.

**Signed-in desktop tests.** Use `syncedTest` or `test.use({ synced: true })` for a default-seed flow whose first sync is only setup. Each test boots its lane’s isolated host or Electron process from a verified snapshot and starts a matching fresh fake. Sign-in, first-sync, convergence, boot, AI-job and custom-seed scenarios keep a real sign-in. Snapshot keys, guards and the remaining exceptions are described in [Desktop e2e](../apps/desktop/e2e/README.md#synced-start). Timings and the rejected app-reuse experiment are in [Test speed round 4](test-speed-4.md).

**Merging.** Finished branches merge into main in batches (`scripts/batch-merge.mjs`, "Batch merges") after typecheck, lint and the unit tests pass on the merged tree. The full suites do not gate a merge.

**Full runs.** `bun run verify:main --ref origin/main` runs every suite on main, including heavy sync tests; `--nightly` adds uncached Quint and the Mac suites ("Full runs" below). Run Quint uncached when its specs or checker change too. Conformance is in the full plan. Do not repeat `test:agent` separately; the unit suite already includes it.

**Flakes.** Desktop Playwright projects have zero retries. Tests that pass only on retry remain listed as flaky in the console and full-run summary. A failed test fails the gate. Fix intermittent failures without weakening assertions or running retry loops to obtain green results. Use `bun run flake` to investigate them ("Hunting a flaky test" below).

**Remote plan shape**: `bun run affected` and `bun run verify:main` use two jobs on the SSH runner: a desktop job (browser and Electron lanes, spec checks and conformance) and a unit job (unit tests, DOM lane and gallery). The desktop job builds the desktop app once and does not shard desktop e2e. See "Remote runs" and "Machine shapes".

**Test selection by coverage** (landed 10-17): `bun run affected` picks desktop e2e specs by a coverage map that `bun run verify:main` refreshes, and gallery behaviour specs by the components they open. See "Desktop specs by coverage".

**Narrow plans.** Every spec boots the whole app, so broad coverage can select most specs. The planner keeps changed and named specs mandatory, then ranks optional picks within an estimated time budget. It excludes heavy tests outside the changed area; `--wide` removes sampling and includes heavy tests. A repair also uses the import graph and bypasses the result cache. The earlier 10-18 experiment used a fixed count cap: over 30 merges it selected 296 desktop specs instead of 2,503. Those historical counts do not measure the current time-budget policy. See "Affected tests".

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

**Round 2** (10-17). The follow-ups above, measured the same way but with every suite on the standard 8x16 machine, one after another in one plan (`bun run remote --env JUNO_PLAN_SERIAL=1 test:plan test + test:gallery + test:desktop`), main at `0e8669fe` before and the `test-slim-2` branch after. Summed test time is the sum of the per-test (desktop, gallery) or per-file (unit) durations the run log prints; script time depends mostly on the slowest worker.

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

**Round 3** (10-17). Main at `c57723fc`, `bun run remote test:desktop` on one 8x16 machine: 409 passed, 1,414 s summed, 291 s script time. Round 2 had already moved the send-check limits, emoji matching and five sidebar view states, and mention parsing was unit tested, so what was left was launches:

- A test that needs a launch setting gets it from a fixture option: `test.use({ fakeAiDelayMillis })` in `grammar-pause.spec.ts` and the three slow-model tests in `send-checks.spec.ts`, `test.use({ screenShared: true })` for the capture that never stops in `privacy-sharing.spec.ts`. Each used to sign in, quit and relaunch. A relaunch stays where a test checks what survives one.
- `quick-start.spec.ts`: the flow test runs on the same fifth of the large seed as the preview test (13 s on the large seed). The budget stays on the large seed in `perf.spec.ts`.

These four specs took 88 s summed before (`send-checks` 48, `quick-start` 18, `grammar-pause` 12, `privacy-sharing` 11).

Looked at and left: the 429 storm in `realtime.spec.ts` (33 s) and `idle-cpu.spec.ts` (28 s), as in round 2; `ai-key.spec.ts` (23 s), whose three waits show nothing happens; the AI assist off tests in `send-checks`, `art` and `home`, which set the pref in `user.db` and relaunch because the app reads it at launch; the remaining mention and emoji e2e tests, each one user flow over rules already unit tested.

**Round 4** (10-18): the audit in `docs/testing-audit.md` measured what each suite costs and what it caught in a week, removed a gallery hang that cost every full run on main 13 minutes, merged desktop tests that shared their setup (474 to 408 launches), and removed or rewrote tests of internals. Its rules follow.

**Unit setup and parallel files** (10-19). The engine harness builds an empty migrated database template once per test process, closes it, then copies it into each fresh engine's private directory. It does not copy synced workspace data or share engines. Store migration tests still run from scratch. Related engine checks can share one named flow; tests of different starting states and failure cases remain independent. Large-seed repair and socket-liveness cases are separate files so existing remote file parallelism can overlap them. `bun run test` runs files on a few workers that keep their globals across files (`--no-isolate`, from 10-24), so the template and the synced workspace are built once per worker. Measurements and the assertion inventory are in [Unit suite timing](unit-suite-timing.md).

**Further unit tuning** (10-19). Store now overlaps files on remote workers because every test owns a private temporary directory and database handles. The large-seed repair scenario uses a 1,500-message fixture that keeps 300 conversations and the exact repair budgets; the 100,000-message performance fixture stays intact. The send flush check advances retry deadlines with TestClock. Home's AI-off setup now precedes its job startup, and quick-start's Automated hold is advanced explicitly, so both work under load. Five paired Agent pool/isolation samples found no consistent improvement, so its defaults stay unchanged. Wall-clock and CPU budgets are excluded from normal unit runs and `affected`: `bun run perf --unit` runs the Agent, Engine and AI performance configurations on the Mac. Mixed tests keep their correctness assertions in the normal suite; query-count and payload limits remain normal checks. The Agent no longer has a separate timing project in `bun run test`. Profiling commands and measurements are in [Unit suite timing](unit-suite-timing.md#round-3-smaller-repair-fixtures-and-independent-store-workers).

**Desktop scheduling and persistent builds** (10-19). The desktop fixture now selects the engine unit harness's fast scheduling for ordinary fake-Slack launches. Both e2e mode and a fake URL are required. Thumbnail recovery keeps four attempts at the same ratios; production still waits 1, 3, 10 and 30 seconds. The fast profile disables periodic discovery, uses explicit catch-ups, and preserves real socket hello/pong safety deadlines. Tests of real timing opt out with `test.use({ timing: 'production' })` or `launchApp(dir, { timing: 'production' })`; presence spacing and reaction-versus-edit backoff do so. Paced sync, idle, perf, feel and `@mac` launches retain production timing automatically. `juno.workPass(name)` waits for an engine job pass started after its request, so negative AI and Automated assertions no longer sleep for several seconds. `JUNO_E2E_TIMINGS=1` reports separate fake-start, Electron-launch, sign-in, sync-wait and close times. Related checks with the same starting state share one launch and use labelled `test.step` calls. Each flow owns its fake and user data. Cold starts, different initial fixtures and destructive failure cases stay separate. Timing budgets run on the Mac through `bun run perf`; normal e2e waits only establish readiness or fail a hung step.

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

The final `bun run affected` invocation initially failed the health limits on the added test hooks. Extracting the main/engine test helpers fixed that: Bun, desktop TypeScript, all 11 lint checks and 17 local AI/Automated/Home/review checks then passed. Its unit lane stopped at the unchanged `packages/agent/test/serve/chat-cache.bench.test.ts:43`: event-to-window p95 was 62.1 ms against a 50 ms budget, while the query budget passed. That left planned unit files unrun; the benchmark and its limit were left for the separate unit/plan work. The protocol checks passed, conformance passed 80 cases with 12 existing skips, and all 62 repository-tool tests passed. The same plan passed all 297 gallery checks in 1,149 s and 17 selected desktop checks in 56 s, without retries. Its three sweep parts took 16.2–16.3 minutes, so they needed the increased batch limit. With the root script registration changed, this plan selected the ten smallest desktop specs; the changed job/review flows were checked separately in the 17-test local batch above. The overall affected result remains failed because of the recorded initial health failure and the unit benchmark; the health checks were subsequently rerun successfully.

Reproduce the samples with:

```sh
bun run remote test:desktop app.spec.ts topic.spec.ts send.spec.ts actions.spec.ts automated.spec.ts ai-key.spec.ts art.spec.ts home.spec.ts presence.spec.ts
bun run remote --env GALLERY_SHIFT_ONLY=Button,Chip,TopicHeader test:gallery shift.spec.ts behaviour.spec.ts topic-art.spec.ts
```

The full commands are `bun run remote --env JUNO_E2E_TIMINGS=1 test:desktop` and `bun run remote test:gallery`.

### Rules for tests

These apply to every new or changed test. They start from Tushar's words (10-24):

> Avoid useless slop unit tests coupled with implementation; tons of 2–3 line unit tests are bad. Don't do mocks, instead use fakes for boundaries. Most unit tests are useless, unless actually testing something tricky. Mocks should be rarely used. If any change in code requires change in test, the test isn't useful. Tests which have never failed in history, and have a lot of changes with changes in code and are unlikely to provide any meaningful signal, should be removed. Few meaningful tests >>>>> tons of one line slop tests. We do need good overall tests for realistic practice behaviours though. Make things isolated, and run them on the fastest thing possible.

- **Few meaningful flows.** Prefer one realistic flow that walks a user or system journey through the real code (engine flows in `packages/engine/test/flows/`, agent flows in `packages/agent/test/`, UI flows in the DOM lane, or the browser lane when they need layout) over many small tests. Extend a flow's journey before adding a file.
- **Unit tests only for tricky rules.** A unit test earns its place by guarding something easy to get wrong: a merge or protocol rule, a parser edge case, a state machine (as a seeded model where it fits), an invariant. A table row beats a new test. Never test a mapping, a label, copy or a constant against itself.
- **Fakes at boundaries, no mocks.** The boundaries are Slack (`@juno/fake-slack`), the model and other services (`@juno/agent-testing`, the fake OpenRouter), time (a test clock or an injected sleep) and the OS (the browser host's fakes for notifications, idle and the dock). Do not replace our own modules; if a test needs a seam, add one to the code (an injected clock, a callback) and use it.
- **A test that changes with the code is a cost, not a check.** If an ordinary change to the code needs a change to the test, rewrite the test against behaviour or delete it. Delete tests that never failed, change with every code change and give no plausible signal.
- **Isolated and parallel.** No shared state between files or tests (no mutable module-level state in shared helpers), no fixed ports (port 0), no shared folders (a temp folder per test, removed even on failure), no order between tests, no `process.env` edits. A file stops what it started and puts back any global it replaced. Every file passes alone, in parallel with all others, after any other file in the same worker, and in any shuffled order.

- **Test what a user or a caller sees.** Assert on the screen, on what reached the fake Slack, on rows a live query returns, or on a command's result. Do not assert on private state (a queue's internal map, a table only the module reads), on calls between our own modules, or on the exact shape of an internal object; such a test fails on a refactor and passes on a bug. Unit tests are for pure rules; boot the engine against the fake Slack for anything else.
- **A test must be able to fail.** Before you finish, break the code it guards (return early, flip a condition) and see it fail. A check of a constant against the same literal, of what the test itself set up, or of a copy of the code (SQL pasted into the test) guards nothing. A title must match the input: "flattens list items" needs a list.
- **One check, one place.** Before adding a test, search for one that already makes the same assertion: a spec table row, another package's test, a gallery state. Extend that one.
- **One launch per journey.** A desktop test pays about 1.9 s to launch, sign in and sync before its own first step (0.63 s launch and close, 0.69 s sign-in, 0.69 s first sync). Add a small check as a `test.step` of the test whose journey already reaches that state, named for what it checks, rather than as a new test. Start a new test only when the check needs a fresh app (first sign-in, counts from zero, a pristine sidebar order), its own launch options, or a relaunch. Order steps so that none changes what a later one checks, and take a fresh baseline where a count is relative.
- **Wait for the thing, not for time.** Wait for the value you assert, the stored row (`e2e/driver/userDb.ts` reads `user.db`), `scrollend`, a call in `fake.calls`, or the answer row. A fixed sleep is allowed only to show that nothing happens when no signal marks the end of the pass, with a comment that says so. To make such a sleep short, give the product's window a test-only setting (`markDelayMillis`, `slackScheduleDebounceMillis`, `automatedWindowMillis`) and keep the app's value in the one test that checks the window itself.
- **Every wait has a bound.** A Playwright call that can wait for an element must not wait for the test's whole timeout inside a long walk: give it its own timeout, or check the element still matches first. One unbounded `locator.evaluate` cost 13 minutes per run.
- **Theme only where colour matters.** The dark theme changes colours and shadows, never a size. Geometry and overlap checks run in light; contrast and fill checks run in both.
- **Keep these, whatever they cost:** the Quint specs and conformance, privacy and secret-handling tests, the sync, read-state, follow-state and outbox tests, crash and recovery tests, regression tests named after a real bug, and the layout-shift and feel checks. Make them faster; do not drop them.

## Affected tests

`bun run affected` works out which tests the change can reach and runs only those. After local Bun checking passes, the remote suites run as one plan: separate SSH jobs through tstack (`bun run remote test:plan`, see "Remote runs"), and the local steps (lint, the Node checks) run on the Mac beside it. Each step's result comes back separately, so the results cache records the steps that passed (`--local` runs every step one after another through the local root scripts; `--plan` only prints the plan, and `--plan --json` prints it as JSON; `--files a,b` plans for given files; `--spec <spec>` also runs that desktop or gallery spec, repeated or comma-separated; `--budget-seconds <n>` sets the estimated test-seconds budget for optional desktop picks (default 300); `--wide` plans every spec the change can reach, heavy tests included, as before 10-18; `--batch` is the batch gate's plan, below). The change is every file that differs from the merge base with `origin/main` (or `main` when there is no remote), committed or not, plus new files. Agents use it while iterating and for their report; full runs on `main` are started by hand.

An import graph over `apps/` and `packages/` decides what each change reaches, and for desktop e2e specs a coverage map narrows it ("Desktop specs by coverage" below). The graph follows relative imports, `@juno/*` through each package's `exports`, and named imports followed through barrel files (`export * from` and `export { } from`) to the module that declares the name. The rules:

| Changed | Runs |
| --- | --- |
| `bun.lock`, `bunfig.toml`, the root `package.json`, `tsconfig.base.json` | every unit test, `specs:check`, conformance, gallery and desktop picks within their time budgets (no spec can be told apart) |
| `scripts/affected.mjs`, `scripts/affected-select.mjs`, `scripts/affected-run.mjs`, `scripts/affected-tests.mjs`, `scripts/test-areas.mjs`, `scripts/import-graph.mjs`, `scripts/coverage-map.mjs`, `scripts/remote*`, `scripts/heavy.mjs`, `scripts/build-cached.mjs`, `scripts/build-inputs.mjs`, `scripts/locked-packages.mjs`, `scripts/without-run-as-node.mjs` | the tool tests (`test:health`, `test:repo-tools`, `test:runner`) and `e2e/app.spec.ts`, as a check that a run still works |
| A unit file, a file one reaches, or a package's `package.json`, `bunfig.toml` or `tsconfig.json` | those unit files (`bun run test --files <repository paths>`): a package's `.test.ts`, `.test.tsx`, `.test.js` and `.test.mjs` files under its `bunfig.toml` `[test] root` (the package when it names none), including `eval/`; performance and conformance files stay excluded. This covers `packages/` and `apps/` alike |
| A script under `scripts/` that a tool test imports, or the test itself | the root script that runs that test with `bun test` (`test:repo-tools`, `test:health`, `test:runner`); each `scripts/**/*.test.mjs` is listed in one root test command |
| `specs/` (not Markdown) | `bun run specs:check`, narrowed to `--memory`, `--actions` or `--recovery` when only that agent spec changed; its cache skips checks whose inputs passed before |
| Outbox inputs (`protocolInputs` in `scripts/verify-inputs.mjs`): the engine's `outbox.ts` and `send/` and their imports, outbox specs and the conformance harness | `bun run specs:conformance` |
| A file a component's fixtures reach | `bun run test:gallery` with `GALLERY_SHIFT_ONLY` set to ranked reached components within the time budget; a component whose own source or fixture changed is required, and the other behaviour specs that open one of them |
| A gallery behaviour spec other than `shift.spec.ts` | that spec |
| The gallery harness: `apps/gallery/` (except its spec files and `shots.spec.ts`), `shift.spec.ts`, `packages/testing/` | `bun run test:gallery` for every component and spec, the heavy shift guard over every component included |
| A file the desktop app runs (`apps/desktop/src` and the packages it bundles) | `bun run test:desktop` with the specs the coverage map says ran it, ranked within the estimated time budget (below) |
| The shared e2e support: `e2e/fixtures.ts`, `e2e/driver/`, `e2e/build.ts`, `e2e/coverage.ts`, `e2e/no-skips.ts`, the Playwright and electron-vite configs, `apps/desktop/package.json`, the renderer's `index.html`, `src/coverage.ts`, and what they reach outside the app (the fake Slack, the fake OpenRouter) | `bun run test:desktop` with the specs that use what changed, ranked within the estimated time budget (below) |
| A file in a guard spec's area (`GUARD_SPECS` in `scripts/test-areas.mjs`; none now: the check that the most frequent paths paint from what Juno holds is `dom/instant-paths.test.ts`, which every renderer, host, engine or state change reaches) | that spec, always, whatever the coverage map ranks or the budget leaves |
| A DOM lane test file, a file it imports, or a file the renderer bundle (`web/page/main.ts`) or the engine host (`web/host/testHost.ts`) reaches | those DOM files (`bun run test:dom --files <repo paths>`); most app changes reach every file, which the lane's cost allows. The batch gate leaves them out |
| An e2e spec file | that spec, always |
| A helper some specs import | those specs, ranked above coverage picks |
| Any `.ts`, `.tsx` or config a typecheck project reads | `bun run typecheck` locally with pinned Bun; unsupported projects are warned about and skipped |
| Anything but Markdown | `bun run lint`, on the Mac (about 3 s, less than a remote machine's overhead) |
| Documentation only | nothing |

**Unit file selection.** Each test runs only when its import closure contains a changed file, or its package configuration changed. Engine tests often import the whole engine through their shared harness, so an engine edit can legitimately select most engine tests. The runner passes the selected repository paths to one `bun test`, so a file never selects a namesake in another package. A package config change still runs that package's tests; root config and lockfile changes still run every unit file. In desktop selection, they keep changed specs and specs importing a changed private helper mandatory, then add the usual sample of other specs. Full `bun run test` runs every package.

Replaying the 15 first-parent merges ending at `f601148d2` with `--plan --json --no-cache --range <merge>^1..<merge>` selected 1,113 unit files before and after. The old package-relative filters matched 1,196 files; the new commands run the selected 1,113. Examples: `home-muted-levels` matched 74 files for 62 selected, `newchat-toasts` 25 for 19, and `sync-sweep-cheaper` 73 for 57. These are file-match counts against the same checkout, not historical test executions. The JSON output is written synchronously so a large replay remains complete when piped.

`--wide` keeps the rules from before 10-18: everything runs for the files in the first two rows, every spec the coverage map picks runs, shared e2e support and style sheets run every desktop spec, `packages/tokens/` runs the whole gallery, heavy tests always run, and protocol checks still follow only their own inputs. Repairs also pass `--graph --no-cache`, so coverage and cached branch results cannot narrow the fix's reach.

**Heavy tests.** Some tests are slow because of what they check, and their code rarely changes: the first-sync cases in `layout-shift.spec.ts`, and the gallery's shift guard over every component. Each is tagged `@heavy` and its area's tag (`{ tag: ['@heavy', '@heavy-sync'] }`). `HEAVY_AREAS` in `scripts/test-areas.mjs` is the one place that says which code each area covers: sync (`packages/sync/`, the engine's session and start, the Slack client's pacing, the large seed and `layout-shift.spec.ts`), idle (the process monitor, the engine's workers, the agent's schedulers, `idle-cpu.spec.ts`) and the gallery harness. Every test in `idle-cpu.spec.ts` is also `@mac`, so remote plans and remote full runs never run it: its portable walk was 51 s of the Electron lane's critical path and nearly all waiting. It runs in `bun run verify:main --with-mac` (and `--nightly`) and by hand on the Mac. The portable walk uses a 2,000-message seed, four states, 2 s settling and 10 s samples: every process stays below 25% of one core, below 96 MB peak/end memory growth, and below 32 MB growth if every interval grows by more than 2 MB; the fine per-process budgets and long large-seed walk run beside it. Every run instead has `packages/engine/test/flows/idle.flow.test.ts` (work passes at rest under a test clock, including the 10-18 backoff case) and the rest check in `juno-agent/chat.spec.ts` (no looping animation or frame loop after an answer). App diagnostics remain the primary way to find field spins; none of these checks covers slow leaks or every deferred worker path. A plan runs an area's heavy tests only when a changed file, or a spec named with `--spec`, is in that area. Otherwise it sets `JUNO_SKIP_TAGS` (for example `@heavy-sync,@heavy-idle`), which each suite's Playwright config adds to its `grepInvert`, and leaves out a spec whose every test is heavy. Idle CPU and memory budgets run in the `--with-mac` lane and on demand on the Mac; they do not run in remote plans or remote full runs.

**Batch gate.** `bun run affected --batch --base <ref>` (what `scripts/batch-merge.mjs` runs after its own typecheck and lint) plans only the unit files and script tests the batch reaches, `specs:check` when `specs/` changed, and conformance when outbox inputs changed. It does not run the gallery or desktop e2e.

**Results cache.** Each unit test file, gallery component, gallery behaviour spec file and desktop e2e spec file is an item with a key: a hash of every file it reaches, its package and suite configs, the lockfile, runtime and Bun version, OS/architecture, Electron version, and heavy-test selection. Local and remote results have separate keys. After a step passes with the expected runtime identity, its items' keys are recorded in the system temp folder (`juno-cache/results`), shared by every worktree, whether the step ran here or remotely. An item whose key passed before is skipped and counted in the plan; `--no-cache` runs everything. `specs:check` keeps its own cache per Quint run. A failing step cannot populate the passing cache. Every attempt writes its commands, outcomes, logs, per-test durations and failure causes to the shared `.juno-status/affected/<run>/record.json`, including steps left unfinished by a prerequisite failure or cancellation.

`perf` and `test:feel` never run here, but `bun run verify:main --with-mac` (or `--nightly`) runs both on the Mac after the other suites. Run a matching perf scenario for new per-row, per-frame or startup work, and a matching feel scenario for a change to that interaction. Use the last `--with-mac` result as the baseline. The plan names matching perf and feel scenarios from `PERF_INTERACTIONS` in `scripts/test-areas.mjs` when their files change. The graph errs towards running more: a module imported whole (`import x from`, `import * as`) brings everything it imports. A test whose behaviour depends on a file it does not import (a fixture read from disk, an environment variable) is not seen; a full run on `main` catches that.

### Desktop specs by coverage

Nearly every file reaches the whole desktop app through the import graph, so the graph alone would run every desktop spec for any app change. Instead, `bun run affected` reads `apps/desktop/e2e/coverage-map.json`, which records, for each spec file, the source files under `apps/` and `packages/` whose functions ran while one of its tests had the app open.

**Recording.** `JUNO_COVERAGE=1` turns it on for a desktop run. The build then writes hidden source maps (`electron.vite.config.ts`; `build-cached` rebuilds when the variable changes). `apps/desktop/src/coverage.ts` is the first import of main, the engine and the agent: with `JUNO_E2E_COVERAGE` set to a directory, each process starts precise function coverage on its own inspector and writes the start offsets of the functions that ran. Main also attaches to each renderer over the DevTools protocol before its page loads. The fixtures give each launch its own directory under the spec it belongs to, and ask main and the renderers to write before they close the app. The engine and the agent write every two seconds and on SIGTERM. The browser lane records its renderer through Playwright and its engine/agent host through Node’s inspector; `vite.web.config.ts` and the host build write source maps only for this run. The run's teardown (`e2e/coverage.ts`) runs `bun scripts/coverage-map.mjs reduce`, which maps the offsets to source files with the source maps and writes `apps/desktop/coverage/map/partial-<shard>[-step-<n>].json`; `bun run remote` brings it back with the reports. A module's top level does not count: in a bundle it runs at load in every test, so it says nothing about a spec.

**Refreshing.** `bun run verify:main --nightly` runs the desktop suite with `JUNO_COVERAGE=1` and writes the joined map (`bun scripts/coverage-map.mjs merge <partials> --commit <sha>`) to `apps/desktop/e2e/coverage-map.json` in the checkout it ran from. The map records runtime/platform identity; another identity falls back to import-graph candidates within the time budget. A failed test still ran its code, so failures do not stop the refresh. No schedule runs it: the agent that runs `--nightly` when asked commits the refreshed map and merges it, as "Refresh the e2e coverage map". The map is a few hundred kilobytes, one source file per line, so a refresh reads as a diff.

**Selecting.** `scripts/affected-select.mjs` picks the candidates, and the plan prints each spec's strongest reason:

- for a change to the shared e2e support (the driver, the fixtures, the fake Slack, the fake OpenRouter), the specs that use a changed class member or function, or a support part that uses one (`reachSpecs`). A spec uses `Palette.section` when it names `.section` and can get a `Palette`: it names the class or an accessor that builds or returns one. A change outside every named part (a class's own line) counts as a change to everything the file exports, and a Slack method a changed line names (`'conversations.history'`) picks the specs that name it. Where nothing can be placed (a config, a page), every spec is a candidate and the smallest stand in. `--wide` keeps the old rule: every spec for support other than the driver, and for a driver change outside a named part;
- a changed app file outside the JavaScript bundles (a style sheet, a page, an asset) picks nothing; the gallery and a full run check it (`--wide`: every spec);
- the specs that ran a changed file;
- a changed spec, and the specs that import a changed helper;
- for a file with module-level code only (`moduleOnly` in the map: bundled, but no spec ran a function from it, such as schemas, RPC routes and prompts) or a file that is new since the map's commit, the specs that ran the files importing it, walking up through importers that did not run; none when nothing that imports it ran (`--wide`: every spec);
- the specs that ran a file importing a changed file, when that importer itself changed since the map's commit (it may call the changed file now);
- specs the map has no coverage for (new or never recorded), whenever the app changed.

A changed app file that was in no bundle when the map was recorded (types only, or not used by the app) picks no spec.

**Ranking.** The plan runs every changed spec and every spec named with `--spec`, then candidates within `--budget-seconds` (default 300 estimated test seconds), the highest score first (`rankSpecs`). Required specs are outside that budget. Estimates sum recorded test durations, including retries, from the newest matching successful full-run suite; an unmeasured spec costs 60 seconds. This is a conservative test-work budget, not a promise about wall time. All reached specs run when their estimates fit, including a cheap browser lane; there is no count cap. A spec scores, for each changed file it ran, the log of how many specs there are over how many ran that file: a file every spec runs (app boot, the shared harness, `Palette.tsx`, which the shell mounts) adds almost nothing, and one three specs run adds a lot. A support change adds more the nearer the spec is to what changed. A helper adds more the fewer specs import it. A spec named like a changed file (`sidebar.spec.ts` for `Sidebar.tsx`) adds a little. A tie goes to the spec that ran fewer files, which is usually the quicker one. The plan says how many more specs ran a changed file; a full run covers them. Gallery shift components have their own equal time budget. A component whose own source or fixture changed is required. Other components use the last matching full shift duration divided by the component count, or 30 seconds each without measurements. A gallery harness change and `--wide` run every component. The gallery's content cache can skip unchanged states.

**Measured** (10-17, map from `d15f27ee`, replaying merges with `bun run affected --plan --range <merge>^1..<merge>`). Of the 20 merges on main up to `25e9b5f7`, 17 touched the app, and for each the import graph picked every desktop spec. The coverage map picked 6 of 69 for palette-pages, 44 for thread-root and 1 for a batch fix; the other 14 still ran everything, because of the lockfile or root `package.json` (4), the fake Slack, the fake OpenRouter or the fixtures (5), or core files every spec runs (5: navigation, the send worker, sync boot). 123 files are run by every spec and the median file by 40. File by file it is narrower: palette files pick 5 specs, the message window 44. It picked the failing spec for all six real desktop failures of 10-16 (mirror-reads, tabs, both break-pass specs, avatars-unfurls, stick-bottom), whether given the whole merge or only the files that caused the failure. Gallery behaviour specs: 3 of 14 for palette-pages, slack-import-paths and automated-reason, 8 for send-checks-c, 13 for broad UI merges.

**Staleness.** The map lags main by the time since the last full run whose map was committed. The rules above cover the two ways it goes stale: new files, and importers edited since the map. What they miss is a call that became reachable through a file that did not change, which is rare; a full run on main catches it. A map more than three days old, from a different or unknown runtime/platform, from a commit this repository does not have, or missing, is not used: the import graph supplies candidates within the same time budget; `--wide` runs every reachable spec. `bun run affected --graph` ignores the map.

**Limits.** Code that runs only in the test process (the fake Slack, the driver) is not recorded; that is why changes there are picked by the names specs use, not by the map. The renderer writes its coverage when the test closes the app, so a renderer that crashed or a window that closed before that is not counted. Tests tagged `@mac` do not run remotely and are not recorded. The gallery is not recorded: its behaviour specs are narrowed by the component names they open (`galleryComponents`), and a spec that reads every route without filtering them runs for any component.

## Remote runs

`bun run remote <script> [args...]` runs on the SSH laptop through tstack's shared
host allocator. Install tstack with `/tstack:setup`; its checkout is
`$TSTACK_HOME` (default `~/Documents/code/tstack`). Juno owns the test plan,
workload sizes, workers, toolchain image, workspace install and result parsing.
tstack owns reservations, pinned containers, leases, heartbeats and cleanup.
See [Juno runner configuration](self-hosted-runner.md); use `/tstack:runner`
for machine setup, lessons and troubleshooting.

Jobs wait up to 60 seconds for capacity (`--wait <seconds>` or
`JUNO_RUNNER_WAIT` changes this). An unavailable or full runner fails. `bun run remote --local <script>` and `bun run affected --local` run the steps on
this Mac through the heavy lock; use them only when Tushar asks, since heavy runs make the Mac hang and restart. These commands have no automatic local fallback.
`bun run verify:main` fails when its runner health check reports an
unreachable host (see "Full runs").
Namespace, if needed again, is available only through `/tstack:runner`.

`test:plan` splits its steps into two independent SSH jobs of four cores each, which fit Juno's eight lent cores at once: a desktop job (`test:browser`, `test:electron`, `test:desktop`, `test:e2e`, `specs:check`, `specs:conformance`) and a unit job (`test`, `test:dom`, `test:gallery` and the rest). Each job runs its steps in order with all its threads. In a full run the two jobs carry about the same measured CPU ("Full runs"); smaller jobs each left one long suite on too few cores. A unit job without the DOM lane or the gallery keeps the size its steps ask for ("Machine shapes"). Browser and Electron desktop steps share builds. `verify:main` includes both as separate recorded steps. `affected` selects spec files and runs `test:desktop`, whose Playwright projects route each selected test to its lane (and run canaries in both). Each job
gets a separate install and report directory, and releases its cores when it
finishes. `JUNO_RUNNER_PLAN=single` keeps one job; `JUNO_PLAN_SERIAL=1` also
runs every step in order, whether set locally or passed with `--env`. An explicit `--env` value wins. `KEY=VALUE` before a step overrides its environment.

```sh
bun run runner:check
bun run remote test --files packages/engine/test/flows/topic-view.flow.test.ts
bun run remote test:plan test --files packages/engine/test/flows/topic-view.flow.test.ts + test:desktop e2e/app.spec.ts
bun run remote --cores 2 --wait 120 test:gallery shift.spec.ts
bun run remote test:plan test:browser + test:electron app.spec.ts engine.spec.ts session.spec.ts text-menu.spec.ts updates.spec.ts
```

The worktree snapshot includes tracked and unignored files, with non-Markdown
design assets under `docs/` excluded. It refuses files that look like credentials
or contain real Slack tokens or cookies. Ignored dependencies and build output
stay on the client. Never put secrets in the workspace.

Juno's toolchain image is built on the runner through tstack's shared build
lock. Dependencies install per run against the Bun cache and store in `/cache/bun` with
`--frozen-lockfile --prefer-offline`; lockfile changes do not rebuild the image, but
a new Bun pin does.
Electron downloads and verified app builds persist under `/cache`. Spec cache
entries travel with the job and return with its results. Reports and logs land
in `.remote/`, with `plan.log` for the coordinator and `run.log` for each child.
`bun run remote:usage` summarizes the retained logs across worktrees.

The Mac client stays awake with `caffeinate -i -w <pid>` for the remote run.
Heartbeat loss or a closed connection makes tstack stop the job and free its
cores. A killed coordinator closes its children's pipes so their jobs stop too.

`perf`, `test:feel` and `gallery:shots` stay on the Mac. Tests tagged `@mac`
are skipped on Linux and included in `bun run verify:main --with-mac` runs. For idle CPU changes,
run the fine budgets through the heavy lock with
`bun run test:desktop idle-cpu.spec.ts --grep @mac`.

## Hunting a flaky test

`bun run flake <spec...> [-g <title>] [--repeat 40] [--machines 2] [--workers n]` runs the specs (all under `apps/desktop/e2e` or all under `apps/gallery`) through `bun run remote` with Playwright's `--repeat-each`, no retries and traces kept on failure. The repeats are split across the machines (at most two, so other agents keep theirs), and each machine runs its usual number of workers, so the tests run under the load of a normal remote run; `--workers` raises it. It ends with one line, `flake: 2 of 160 failed`, and the names of the failing tests. Traces are in `.remote/<run>/`; `bun run playwright show-trace <trace.zip>` opens one. For the gallery's shift and focus-ring walks, each repeat walks every state again, and `GALLERY_SHIFT_ONLY=MediaViewer bun run flake apps/gallery/shift.spec.ts --repeat 20 --machines 1` limits the walk to those components.

Unit tests under `packages/` and `apps/desktop/test` run through `bun run test` with `bun test --rerun-each`. Their summary counts executions and names each failing test. For example, `bun run flake packages/engine/test/flows/follow-races.flow.test.ts -g "getView page" --repeat 200 --machines 1` runs that case 200 times on one small machine. Every repetition runs its setup and teardown.

```sh
bun run flake apps/desktop/e2e/sidebar.spec.ts -g "list scrollbar" --repeat 120
bun run flake apps/gallery/behaviour.spec.ts -g "rewritten Home" --repeat 400 --workers 32
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

- **A shift that counted only after the input window.** `expectStableAnchor` skips layout-shift entries Chromium marks `hadRecentInput` (within 500 ms of input). In the partial-thread test, the latest reply's name line goes when the same sender's replies arrive above it, and Chromium reports that row's top edge moving 20 px down with a 0.032 shift in every run, while the text stays at the same pixel in every frame. The replies render after a click, so the entry fell inside the window on a quiet runner and outside it under load (20 of 40 at 16 workers on 4 cores; at 4 workers, every pass came 189 to 409 ms after the click and every failure 538 to 1298 ms after it). The test now leaves that row to the anchor's samples (`outside`) (0 of 80). An entry that passes only because it came soon after a click is a timing result, not a pass: log `hadRecentInput` and the time since the input.

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

- **A style change read before the next frame under reduced motion.** The gallery runs with `reducedMotion: 'reduce'`, and `global.css` then gives every element `transition-duration: 0.01ms`. Their `transition-property` is `all`, so any change to a box that is already drawn becomes a transition that ends only on the next animation frame. `placeToolbar` reads the row's styles as the row turns `:hover`, so the toolbar's slot is already shown when the flip below the row is written; a read before the next frame found the toolbar still above the row, at 42 px (`toolbar-geometry.spec.ts`: 6 of 250 runs with `bun run remote test:gallery toolbar-geometry.spec.ts --repeat-each=50`, then 0 of 250 and 0 of 1,000 with `transition-property: none` on the slot). `bun run flake` did not show it in 1,300 runs: it records a trace, and the trace's snapshots wait for frames. To hunt a flake that depends on frames, run `bun run remote test:gallery <spec> --repeat-each=<n> --retries=0` without a trace. The same hunt found a real bug: the toolbar's place was decided only on `pointerenter`, so a row that scrolled under a still pointer kept it; the row now decides again on `pointermove` and the list's `scrollend`.

- **A sidebar row moved between the read of its box and the press.** Rows sort by latest activity. A test that injects a message and then opens that row read the row's box before the engine moved it to the top, so the press landed on the row that took its place: `partial thread waits for history at bottom` opened another topic (1 in a plan run at 85% busy; 0 of 20 at 16 workers, where the move came 34 to 161 ms after the inject and the pointer reached the row 107 to 406 ms after the move). `SidebarRow.select` now waits until the row's box is the same on two frames and points again if it moved under the pointer, and a test that has just moved a row waits for it (`sidebar.expectTop`). The tests that measure the first sync must also let the list settle: the quick start paints #alerts-prod and #deploys, which leave for Automated as their history lands (in 20 of 20 tour runs, 110 to 690 ms after the first paint; in 2 of 20 runs of the cold sidebar test), and the sync card leaving at the end makes the list 77 px taller. The tour waits for the sync to end before its layout check, and the cold sidebar test starts its probe once the bot channels have left.

- **A send dropped while an image was still being read.** The Juno chat reads an attached image in the renderer before its chip is ready, and its send returned without a word while any chip was in that state. The line under the files shows as soon as the file is attached, so a test (or a user) that pressed Enter right after it lost the send, and the words stayed in the composer: the text-only model test waited 15 s for a reply that never came (1 of 40 and 2 of 80 at 16 workers, 0 of 80 after; Enter came 11 ms after the line). The send now waits for the read of an image Juno takes and leaves out one that stays (`takeForJuno` in `containers/juno/junoFiles.ts`). When a send does nothing, read the page snapshot in the failure's `error-context.md`: words still in the composer mean the renderer refused it, not the agent.

- **A count that changed digits in its fixed box.** Home's syncing line right-aligns the count in a box as wide as the total's digits (`HomeSyncLine`). When the count goes from 9 to 10, the text starts one digit further left in a box that stays put, and Chromium reports a `layout-shift` entry (value 0.0000028) whose only source is that box, with the same box before and after. `expectStableAnchor` failed the Home first-sync test on it (28 of 30 at 16 workers; in 9 of them the same entry also named a sidebar row the test skips, which kept the region filter from dropping it). The probe now drops the sources inside `outside` and counts an entry only if one of the rest moved, as the feel suite's `noLayoutShift` does; an entry with no sources still counts (0 of 30 after).

- **A toast shown before the live query that a menu reads.** A command replies before its change reaches the renderer's live queries, and `runAction` showed the toast on the reply. After "#alerts-prod: Never", the test right-clicked the row while `notifications.settings` still held the old level, so Notify me showed When it matters (2 of 30 runs, 16 workers). The app now waits for the settings to hold the new level before the toast (`shown` in `runAction`, up to one second), so the toast never names a change a menu cannot show yet (0 of 30).

- **A Home send dropped by a tab switch.** Enter on Home to a channel's or a person's Main waits for the wrong-place check (at most 250 ms) before it sends. A hidden tab is an `Activity` in hidden mode, which runs its effects' cleanups, and Home's cleanup cleared the check's token, so a tab chosen before the check answered dropped the send: nothing was posted and the draft stayed in the hidden Home. The break-pass test sends a DM and at once chooses the Maya tab, so under a full suite's load the switch came first (about one affected run in four; 0 of 100 alone at 24 workers and 0 of 260 in a loaded plan). The token is now cleared only when the text or destination changes (`useHomeSendChecks`), and `home-send-tab.spec.ts` chooses another tab in the same task as Enter (5 of 5 failed before, 0 after). The send trace (`apps/desktop/e2e/README.md`) showed it: a `switch` and no `send asked`, and no post in `posts`.

- **A new tab that cancelled a topic open.** ⌘T and "+" asked for their tab as a replaceable change, so a topic still waiting to paint in the current tab was dropped and that tab stayed where it was. The same break-pass test opens #eng, then Maya with ⌘-click, then a new tab; with the Home send fixed it failed 3 of 100 at 24 workers this way, the send trace showing `tabs dropped` for #eng's open. A new tab is no longer replaceable, as a topic's new tab already was, and `show` applies a change that is not replaceable even when it waits for no topic. `tabs.spec.ts` clicks "+" in the same task as the press on a row (5 of 5 failed before, 0 after).

- **A click that found an element the next render hid.** The emoji picker searches a deferred copy of the query, so for one render after `fill` the browse grid is still shown and its `:rocket:` matches the search's button name. Under load `click()` resolved that one, far down in a skipped section. The results then rendered and the grid got `hidden`, and Playwright kept checking the node it had found, which is still connected, so it waited 30 s on "element is not visible" while the result sat on screen (`chat-reactions.spec.ts`: 7 of 20 at 16 workers; a log in the page showed the result visible within 200 ms and the locator, read again, matched only it). Tests now pick from `[data-emoji-results]` (0 of 20). A locator that can match a node a coming render hides should name the part that only exists once the render is done.

- **A card button pressed while Juno still answered.** The remove card shows with the status bubble (40 px) under it, and Juno's "Done." (56 px) takes that bubble's place about 70 to 100 ms later, so the chat, held at the bottom, scrolls 15 px. `click()` had measured the button before the scroll and pressed its old centre after it, 0.06 px below the button's new bottom edge: `pointerdown` went to the card's inner `div`, and `onCard` never ran (`memory.spec.ts`, 1 of 20, then 2, 5 and 3 of 40 at 16 workers; a log in the page showed the event's target was the `div` while `elementFromPoint` at the same point still named the button). This is a chat taking a reply under the pointer, as SPEC 13.2 asks, not a lost click. The test now waits for the second "Done." and for the status bubble to go before it presses Remove (0 of 40). To press a button in the chat, wait until the run that drew it has ended. A target that `pointerdown` names and `elementFromPoint` does not means the point was measured before a move.

- **A retry that walked no states.** The earlier shift claim queue was keyed by run and repeat without a retry boundary. A retried part found every state already claimed, walked none and passed, so a failure that happened on every walk showed as flaky: `AttachmentCard/shared-video` and `shared-files-quiet` gave the text cursor to their video box, video and file names without making them selectable (80 of 120 at `GALLERY_SHIFT_ONLY=AttachmentCard bun run flake apps/gallery/shift.spec.ts --repeat 40 --machines 1`, every repeat; a retry logged 0 states walked). Gallery retries are now disabled; a failed state remains uncached, and repeated runs walk their own queue. The files in a shared card keep the arrow and its file lines are selectable text (0 of 120 at the same command).

## Machine shapes

Juno requests physical cores from the laptop's shared `4-11` allocation:

| Job | Cores | Memory cap |
| --- | ---: | ---: |
| Narrow unit, agent tests, cached spec check | 1 | 3 GiB |
| Wide unit, uncached spec check, conformance, standalone gallery or app | 2 | 6 GiB |
| Desktop job of a split plan; unit job with the DOM lane or the gallery | 4 | 12 GiB |
| Trace generation, other scripts | 4 | 12 GiB |

Wide units have no named files or more than 20. `--cores` overrides the request;
default sizes shrink to fit smaller hosts. Explicit oversized requests fail.
The older `--machine linux/amd64:NxM` and `JUNO_REMOTE_MACHINE` spellings round
N threads up to whole two-thread cores. On quota hosts a narrow job gets one
CPU, with no burst to two.

The shared host maps sibling CPUs and sets the actual thread quota. Workers
use its `RUNNER_THREADS`, forwarded as `JUNO_RUNNER_JOB_CORES`; they never infer
threads from the request. At four threads units run four `bun test` processes.
At eight threads a split job runs eight unit, DOM, browser and Electron
workers and six gallery walkers. Quint uses one simulation group per two threads and one
Apalache checker per two threads, limited by the job’s cgroup memory ("Faster test runs").
A two-core, 6 GiB job gets two simulation groups and two 1,536 MiB JVM heaps.
Explicit worker settings win within the Apalache memory cap.

The host caps memory without swap and mounts `/tmp` and `/work` as tmpfs.
Each tmpfs is 2 GiB, or 4 GiB for requests of four or more cores; tmpfs consumes
the memory cap. Split plans release each job's cores independently.
`JUNO_RUNNER_DESKTOP_CORES` and `JUNO_RUNNER_UNIT_CORES` override the two jobs independently. These overrides change reservations, not host-derived worker quotas. One remote run at a time per agent; other projects use the same allocator.
Use `runner list` to see their combined usage.

## Heavy jobs share one queue

Tests, e2e runs, gallery shots, benchmarks and spec checks spawn many processes. Several agents often work in separate worktrees on the same machine, so the root scripts (`bun run test`, `bun run test:e2e`, `bun run test:feel`, `bun run test:gallery`, `bun run gallery:shots`, `bun run specs:check`, `bun run test:agent-contracts`, `bun run test:agent-testing`) run through `scripts/heavy.mjs`. It takes a machine-wide lock in the system temp folder, shared by every worktree, and waits for a free slot. There are two slots by default (`JUNO_HEAVY_SLOTS` changes it). On macOS it also waits, before taking a slot, while the 1-minute load is above the core count or free plus inactive memory (from `vm_stat`) is under 1 GB, and prints why it waits; `JUNO_HEAVY_IGNORE_LOAD=1` skips that wait. The Mac froze several times when many agents ran work at once, and the slots alone did not see work started outside the queue. On the Mac, `--electron` also takes a single shared app-launch slot. `test:desktop`, `test:e2e`, `test:gallery` and `gallery:shots` use it, so only one of these jobs runs at once. Ordinary jobs can still use both slots, or run beside one app job. An app job waiting for the app-launch slot holds no general slot. Timing runs (`bun run perf`, `bun run test:feel`) pass `--exclusive`, which takes every slot and stops new jobs from starting while it waits, so their numbers are not skewed by another run. Release packaging and its smoke test (`package`, `test:package`) pass `--priority release` with `--exclusive`: each moves ahead of all queued jobs while it waits for active jobs to finish, without interrupting them. Use `bun scripts/heavy.mjs --status` to see holders and queued commands, PIDs and wait times. The wrapper sets `JUNO_HEAVY_HELD` for its child; nested heavy commands run within the parent's reservation and cannot deadlock waiting for a slot the parent holds. Running a package's tests directly bypasses the queue, so prefer the root scripts. `bun run lint` takes one slot for its health scan (Knip and jscpd) only. `test:repo-tools`, `test:health` and `test:runner` skip the machine-wide queue. Queue tests reserve only their own temporary queues; `affected` sends all three tool suites to the laptop.


## Releasing

`bun run release` publishes a release from start to finish ("The release
command" below); the rest of this section describes the steps it runs.

The release target is macOS Apple Silicon. `bun run package` builds the app, rebuilds
native dependencies for Electron, and writes the DMG, its block map and
update metadata (`latest-mac.yml`) to `apps/desktop/release/`. It never
publishes; `bun run release:publish` does (below). Developer ID signing and notarization require the explicit `JUNO_RELEASE=1` switch; without it,
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
binary comes from `@koromix/koffi-darwin-arm64`, its install script is blocked
(it is not in `trustedDependencies`), and its C++ sources and docs are left out of the app.
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
lint/typecheck. Heavy checks run through `bun run affected` on the SSH runner.

### Steps

1. Install Node 26, the pinned Bun canary ("Prerequisites") and Xcode (including its command-line tools).
   Run `bun install --frozen-lockfile` and `bun run affected`.
2. Set the version with `bun run release:version` ("Versions" below). Build and smoke the
   local package with `bun run package` and `bun run test:package`. The smoke launches
   the executable directly, signs in to fake Slack, waits for sidebar rows,
   starts the agent against fake OpenRouter, and relaunches the cached account.
   It uses temporary data and never reads a real Slack session. Without a Developer
   ID signature, it applies `codesign -s -` locally and verifies the result. It
   measures five cached-account launches from process spawn to the renderer's
   first sidebar-row paint marker, reporting median and range. These are warm
   filesystem-cache runs with CDP attached, not a cold-disk benchmark.
3. For a local signed release, provide the variables above, then run
   `JUNO_RELEASE=1 JUNO_UPDATE_TOKEN=… bun run package` (read the token from your
   password manager into the variable; do not type it into a file). electron-builder
   uses `notarytool` and staples the ticket. Partial release credentials fail the
   build. Verify with
   `codesign --verify --deep --strict apps/desktop/release/mac-arm64/Juno.app`
   and `xcrun stapler validate apps/desktop/release/mac-arm64/Juno.app`, then
   run `bun run test:package` again. An unsigned release is the same without
   `JUNO_RELEASE=1`.
4. Publish with `bun run release:publish --notes <file>` (below).
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

A section is the version's highlights: 3 to 8 lines, each one plain sentence
about what a person sees or can do now, in the style of SPEC section 17. It is
not a list of commits. Leave out packages, tests, specs, refactors, budgets,
CI, internal names and commit hashes, and anything a user would not notice.
No group headings: the app shows every line as one bullet under "What's new"
(`apps/desktop/src/main/releaseNotes.ts` parses them). The release agent writes
the lines from the commits since the last release
(`.claude/skills/do-release/SKILL.md`, "Write the highlights").

### Versions

Versions are semver, kept in `apps/desktop/package.json` and tagged `v<version>`
in the releases repository. Set the next one with
`bun run release:version patch|minor|major` (or an exact `x.y.z`) and commit it.
Before 1.0: **patch** for fixes only, **minor** for anything new or changed
that a user would notice. From 1.0, **major** for changes that drop data or
settings, or need a newer macOS. A pre-release (`0.3.0-beta.1`) is for testing
a build and is never offered to installs. Versions only go up: the updater
offers a release only when it is newer than the installed version, and
`release:publish` refuses a version that is not newer than every published one.

### Publishing

`bun run release:publish --notes <file>` publishes the build in
`apps/desktop/release/` to the releases repository, with your own `gh` login
(`gh auth login`, with write access to the repository). No token is read or
written by the script. `<file>` holds this version's highlights, one per line
("The releases repository" above); the script refuses an empty file, more than
ten lines, or a line with a commit hash. The script:

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
`bun scripts/release-gate.mjs <commit>` checks this without a build or upload.

A failed test fails the release gate. Never infer a green record from a log.

Use `--urgent` only for a fix to a problem hurting the
owner now, such as a CPU spin, data loss or a crash on launch. It runs local
typecheck and lint, remote unit tests, and `bun run test:package` against the
packaged app before publishing. It adds an `urgent` marker to the GitHub release
notes metadata. No full run covers an urgent release yet, so run
`bun run verify:main --ref <commit>` for it next; the command prints the commit. An urgent publish is still a normal visible release.
It records the commit it built from as the release source, so merge that
`Release x.y.z` commit into main afterwards; the next `bun run release` refuses
a tip that does not descend from the last release source.

`bun run release:version`, `bun run package` and `bun run release:publish` print their
step durations and append them to `.juno-status/release-timings.json` (local,
gitignored): version bump, JS build, deploy, electron-builder, DMG, notarize
or skip, and upload. The electron-builder total includes the DMG phase.

### The release command

`bun run release` is the whole release in one command. Nothing runs it on a
schedule: an agent runs it when Tushar asks, following
`.claude/skills/do-release/SKILL.md`, which also covers the update token. The
agent steps in only for judgement: the highlights, and fixes when the full run
fails. `bun run release --dry-run` reads GitHub and the local records and
changes nothing; it does not fetch.

1. It fetches `origin/main` and takes its tip. It does nothing if the tip is
   already released or has no user-facing change since the last release, and
   refuses a tip that does not descend from the last released source. GitHub
   release metadata records both the source and build commits; older releases
   use their `Release x.y.z` commit on main.
2. It prints the product commits since the last release, the input for the
   highlights, and the highlights file to write
   (`.juno-status/release-<version>-notes.md`, or `--notes <file>`).
3. If no green full run covers the tip (the release gate in "Publishing"), it
   runs `bun run verify:main --ref <tip>` on the laptop. If the newest record
   for an ancestor of the tip failed and main has changed since, it runs
   `verify:main --ref <tip> --repair <record>` instead. If main has not changed
   since a failed run, it refuses to run anything. A failed run stops the
   command before any build, with each failed suite's failures, cause and log,
   and the repair command. With `--nightly` the full run is nightly, and after a
   green run the command pushes the refreshed coverage map to main. A failed nightly run saves its map in `.juno-status/release-coverage.json`; the next passing release or repair pushes it, even without `--nightly`.
4. It waits for the highlights file, which the agent writes while the full run
   goes. It reads the file once it has not changed for a second, and waits for
   a corrected file if it is invalid, up to `--notes-timeout` minutes (60).
5. It bumps the patch version in a detached worktree on the scratch volume
   (`release-<version>`), commits `Release x.y.z`, runs `bun run package` and
   `bun run test:package` there (both through the heavy lock with release
   priority), and publishes with `release:publish`.
6. It checks the GitHub release (not a draft, marked latest, with the DMG, its
   block map and `latest-mac.yml`) and that main has the version, then removes
   the worktree.

`JUNO_UPDATE_TOKEN` must be in its environment; the command checks this before
the full run. Supply it through the existing secure release setup, never in a
command log. There is no minimum gap between releases. The version is a patch
newer than both the source and the newest published version. The build's version
commit stays in the release worktree; only its version field is replayed on the
current main tip, preserving newer work, and this version-only change remains
covered by the release gate. If the bump is already on main, no second bump is
added.

Rerun the same command after any failure. Before anything else it repairs
main from the latest published stable version, after checking its assets and latest mark, and exits without publishing,
which needs the `gh` login but no build. A green record covering the tip is
reused. A failed run keeps its worktree for inspection, and a rerun refuses to
reuse it. The lock is `.juno-status/release.lock`; a lock whose process has
gone is taken over.

Step timings (full run, highlights wait, prepare, package, packaged smoke,
publish, upload and cleanup) persist in the main checkout's
`.juno-status/release-timings.json`, including failed steps, after the release
worktree is removed.

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

`bun run bench:engine` runs the large-seed benchmarks in `packages/engine/test/perf` one after another, through the exclusive machine lock. `bun run bench:sync` runs the read-only sync harness against the large fake seed with production pacing; it never opens a real session and fails if it cannot reach `live` within an hour. Both can run through `bun run remote` on a dedicated 4x8 Linux machine. Compare runs on the same shape; renderer performance budgets still run on the Mac. The fake's normal engine tests disable pacing, so their boot time does not measure the request budget.

## StyleX token check

`bun run lint` runs `bun scripts/check-tokens.mjs` over `packages/ui`,
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
Run the rule tests with `bun test scripts/check-tokens.test.mjs`.

Measured on the shared Mac (2026-10-15), the token check alone took 0.36 s
median (0.35–0.50 s, five successful runs including Node startup). Five
alternating full lint runs with and without the check took 3.59 s
(3.42–4.88 s) and 3.85 s (3.11–4.95 s) respectively. Other worktrees were
active, so that full-lint difference is noise; budget about 0.36 s extra
for parsing the StyleX source files, not a lint speedup.

## Delayed-load layout checks

Gallery image, avatar, thumbnail, replier and late-content checks run on every behavior invocation. The content cache applies only to the broad interaction walk; it does not replace delayed-load checks against fake Slack. `GALLERY_SHIFT_ALL=1` forces the broad walk too.

At `d0876483`, all 18 cases passed in 38.5 seconds on one `linux/amd64:4x8` remote runner with two workers. This is test time, excluding allocation, image pull and build. Use `bun run remote --machine linux/amd64:4x8 test:desktop layout-shift.spec.ts` for the same runner size.

`bun run remote test:desktop layout-shift.spec.ts` runs the desktop shift checks against fake Slack. They are ordinary desktop e2e tests, so `bun run affected` picks them when they cover a change directly; the first-sync cases are `@heavy` and run when sync code changes, and always in a full run. No Mac timing or filmstrip recording is required.

`expectStableAnchor` in `apps/desktop/e2e/shiftProbe.ts` samples a retained DOM anchor's screen coordinates every animation frame and asserts exactly zero movement. It also requires Chromium's Layout Shift observer and rejects entries without recent input. The anchor check includes the recent-input interval, which otherwise hides jumps for 500 ms. Start it before releasing delayed data, and wait for the resulting UI inside its action. A missing anchor fails.

Home's first sync uses `expectHomeSyncFrames` instead: SPEC 12 leaves no space for rows that have not arrived, so adding rows recentres the column. Every sampled frame keeps the composer fixed, retains painted rows in order with their greeting offsets, and shows the scene, greeting and rows without fading. Progress and readiness changes alone must not move the column.

Use `fake.holdNext({ method, reason: 'open' })`, assert the call is held, then `fake.release({ method })` to exercise partial caches. Use silent fake posts followed by one socket message to reproduce history missing above the latest message. Do not substitute a settled gallery fixture for this case. Repeat with `bun run flake apps/desktop/e2e/layout-shift.spec.ts --repeat 20 --machines 1`. Keep one remote run at a time; all jobs share the laptop’s configured cores.

## Full runs

After changing `scripts/verify-*`, `scripts/remote/*` or the release gate, commit the change and first run `bun run verify:main --ref HEAD --smoke`. This sends one small unit file through the real laptop plan, checks job identities while they stream, writes a separate `verify-smoke.json` record, and checks that the release gate refuses it. Smoke records never replace full-run evidence. Run this before a full run; it should take less than a minute on an available warm runner.

`bun run verify:main --ref origin/main` runs the full app and unit suites at that commit; fetch main first. It checks out the commit on the scratch volume and runs separate SSH jobs on the laptop. When `test:browser` and `test:electron` are available, both replace the combined desktop step. `test:dom` runs in the unit job with the same order seed as `test`, and the release gate requires it whenever the record lists it. Heavy sync tests stay enabled.

Quint runs only when a spec or one of its inputs changes, or when no matching successful result exists. When it runs, single-sample schedules share parsing/typechecking per spec and bounded checks use independent JVM lanes within the job’s CPU and memory allocation ("Faster test runs"). All schedules, witnesses, invariants, bounds and trace checks still run. Outbox conformance follows outbox code, its imports, outbox specs and the replay harness. Successful protocol results from earlier runs can be reused only with matching input hashes, Bun/runtime version, OS/architecture and Electron version. Each job reports its own runtime when its plan starts and before each suite. The first job establishes the run identity; a disagreement with another job, a repair baseline or a provisionally reused result stops every job immediately. Missing reports also fail verification. Planner image pins are diagnostic only. Input keys and records use the reported runtime, and the release gate refuses mixed identities. Every reused suite names its source record. `--no-cache` forces both protocol suites and the broad gallery walks.

**Stopping early.** Isolated test failures do not stop a full run: every suite finishes so one repair can address all failures. Setup failures (install, build, app/host launch or fake-server startup) and runtime disagreements stop every job immediately. During a suite, `scripts/verify-failures.mjs` stops only that suite when more than half of at least 20 completed tests have failed (`MIN_COMPLETED = 20`, `FAILURE_FRACTION = 0.5`), or eight failures share the same message and first stack frame (`SHARED_SIGNATURE_FAILURES = 8`; Bun uses its error message). Skipped and interrupted tests do not count. Other suites continue after a systemic suite failure. Streaming `juno-stop` records name the rule (`setup`, `failure-rate` or `shared-signature`), counts and shared signature; the suite record retains that evidence as an infrastructure failure. A failed test process that exits before reporting any completed test also counts as setup failure. The pipeline smoke check exercises this policy without running the full suites.

`bun run verify:main --ref origin/main --local` runs the plan on this Mac, only when Tushar asks. Without `--local`, an unreachable runner fails the run after the health check, and so do authentication, configuration and runner setup errors; nothing falls back to the Mac, and a failing remote suite never triggers a local rerun.

The local plan installs the detached checkout, takes the exclusive machine-wide heavy lock and runs suites sequentially. Worker limits live in `scripts/verify-execution.mjs`: two browser workers and one Electron worker on the 8 GB Mac. Before each step it waits while load exceeds 8 (`JUNO_PLAN_MAX_LOAD` overrides that threshold; fake-command tests use `Infinity` in their child environment). The ordinary app steps skip `@mac`, matching Linux; `--with-mac` adds those tests, perf and feel. Timing suites run sequentially after the other work and hold the exclusive lock. `--dry-run --local` prints the plan without a checkout, installs, suites or a successful verification record.

Every full run chooses and records a unit test order seed (`testSeed`; `bun run test --seed <n>` repeats it). `bun run verify:main --nightly` chooses and records a varied Quint seed (`SPECS_SEED=<integer>` reproduces it), records desktop coverage, forces the broad gallery walks, and adds the Mac suites. Deterministic Quint checks retain their cache. Coverage is recorded and merged only nightly; commit the refreshed `apps/desktop/e2e/coverage-map.json` after that run. Ordinary full and repair runs do not refresh it.

Results live in the main checkout's shared `.juno-status`: latest `verify-main.json` and `.md`, per-commit JSON under `verify-main/commits/<commit>/<run>.json`, and logs and retained JSON reports under `verify-main/<run>/`. Records contain runtime/platform identity, each suite's host, structured test outcomes, per-test durations and retries. Each failure has a cause: `product`, `test`, `infrastructure` or `cancellation`. Automatic test/infrastructure classifications are provisional, with evidence; triage must confirm the cause. `--cause <suite>=<category>` records a confirmed classification for that run's failed suite. After triage, `bun scripts/verify-records.mjs <record.json> <suite> <category> "evidence"` confirms a cause without changing the outcome; it updates matching latest/archive copies as well. The command also accepts affected records. Cancellation writes a failed record after children stop. A zero exit code with incomplete or failing structured tests cannot pass.

### Repair a failed full run

After fixing and committing the cause, run `bun run verify:main --ref origin/main --repair <record.json>` (or `--repair latest`). The baseline must be an ancestor with a version 2 record and the same runtime/platform. The repair runs failed and unfinished spec files, plus every test the fix reaches through `affected --wide --graph --no-cache`. It leaves out affected's typecheck and lint, which run on this Mac and are not part of a full run, and runs affected's `test:desktop` selection in both the browser and Electron lanes. There is no count or time cap and no heavy-test exclusion. A suite without a complete structured inventory reruns in full. Passed, untouched suites keep their provenance; repaired suites retain previous passing test outcomes. The release gate accepts the repair only with the recorded baseline chain and complete successful required suites. A Mac timing/nightly baseline needs a fresh `--with-mac` full run.

### Job sizes

A full run is two four-core jobs. Each serial step prints `plan: step <n> <script> used <s> CPU-s, peak memory <g> GB`, read from the job's cgroup, so a re-plan can use measured CPU rather than guesses. Single runs on 2026-10-25, protocol suites reused from an unchanged earlier run:

| Plan | Commit | Wall | Job | Cores | Steps (wall s) | Script wall | CPU busy | Peak memory |
| --- | --- | ---: | --- | ---: | --- | ---: | ---: | ---: |
| Before: unit 2, desktop 3, gallery 3 | `1e9e01c87` | 206.6 s | unit | 2 | test 70, test:dom 111, conformance 17 | 198 s | 92% | 3.6 GB |
| | | | desktop | 3 | browser 120, Electron 61 | 181 s | 89% | 5.4 GB |
| | | | gallery | 3 | gallery 82 | 81 s | 79% | 4.7 GB |
| After: desktop 4, unit 4 | `e1e82b049` | 183.3 s | unit | 4 | test 36, test:dom 80, gallery 58 | 174 s | 75% | 5.4 GB |
| | | | desktop | 4 | browser 111, Electron 67 | 178 s | 82% | 6.4 GB |

Measured CPU per step at eight threads: test 259 CPU-s, test:dom 497, test:gallery 296, test:browser 747, test:electron 431 (2,230 in all; conformance about 60 when it runs). Two equal halves are the best split of that work: any smaller job left one long suite on two or three cores, and 16 threads at about 80% busy put the floor near 175 s. Below that the work itself has to shrink. Where the time goes:

- The browser lane is a third of all CPU. Its 118 tests sum to 719 s of test time; 8 workers take 111 s wall, after a 13 s renderer build.
- Builds run on the critical path in both jobs when their inputs change: DOM 14 s, web renderer 13 s, gallery 9 s, desktop about 14 s. Each build keys on its own module graph ("Build skip" above), so a commit that changes only tests, docs or repo tools reuses all four. On the ten commits to `40103bc18` (six DOM-lane tests and helpers, three repo-tool changes, two docs), the old key rebuilt 15 of the 40 builds and the graph keys rebuild 3: desktop, web and DOM once, for `f3d262256`, which changed main and the web host.
- The Electron lane is limited by its longest tests: the agent crash and transfer specs take 25 s each, and 8 workers finish its 366 s of test time in 66 s.
- The DOM lane spends 3.6 CPU-s per test (137 tests).

`bun scripts/verify-benchmark.mjs --ref origin/main` runs full runs one after another at desktop/unit core splits 4/4, 5/3, 3/5 and 4/4 (`--dry-run` prints the plan). It stops on a failure for triage and refuses local fallback. Records live in shared `.juno-status/verify-benchmarks/`. Compare the whole run, failure rate and shared-host pressure, not one job's time. A failed configuration is not eligible even when its raw wall time is lower.
