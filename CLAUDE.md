# Juno

Juno is a calm, topic-first desktop client for Slack. It reads and writes real Slack data through the same internal API the official client uses, and reorganizes it around topics (threads, plus one Main stream per channel or DM).

## Where things are written down

- `docs/design/handoff/SPEC.md` decides product behaviour. Where the prototype disagrees, the spec wins.
- `docs/design/inventory.md`, `tokens.md` and `primitives.md` describe every surface and value the UI needs.
- `docs/architecture.md` decides structure. `docs/decisions/` records why the big choices were made.
- `docs/research/` holds what we learned by reverse engineering Slack. Treat it as evidence, with its stated unknowns.
- `docs/development.md` covers setup, commands and known toolchain pitfalls.
- `docs/future-ideas.md` holds product ideas not yet planned; `docs/backlog.md` holds small known items.
- `specs/` holds Quint specs of the concurrent sync protocols, readable on their own (start with `specs/README.md`).

Read the parts relevant to your task, and the package's README, before changing code. If the code and a doc disagree, fix whichever is wrong in the same change.

## How the code is shaped

- Many small packages, each with one job and a declared dependency direction. Respect the graph in `docs/architecture.md`; do not add an edge to make something convenient.
- Business logic lives in Effect services outside the renderer. The renderer is UI only.
- UI is layered: tokens, then primitives, then dumb views (props in, callbacks out), then containers that wire state to views. Views never import state, Effect or Electron.
- Every design value comes from `@juno/tokens`. No raw colours or sizes in components.
- The app should feel like a native macOS app. Never use `cursor: pointer`, except on links in content that open outside the app (in a message, or a picture page's link to read more).
- Speed is a feature. Every interaction has a budget in `docs/performance.md`, and changes must not regress it.

## Working rules

- Add each decision as one dated line in its own `docs/decisions/log/YYYY-MM-DD-HHMM-slug.md` fragment (IST; choose a distinct slug). Run `bun scripts/decision-log.mjs` and commit the generated result. Never edit `docs/decision-log.md` by hand; lint checks it against the fragments.

- Create a worktree with `bun scripts/worktree.mjs add <name>` and remove it with `bun scripts/worktree.mjs remove <name>` (`docs/development.md`, "Worktrees and installs"). New worktrees go in `/Volumes/AgentWork/worktrees/juno/<name>` when that volume is mounted, else in `.claude/worktrees/`; the helper, `batch-merge.mjs` and packaging pick the folder the same way. Installs link from Bun's global store, so a worktree's `node_modules` stays small. Remove worktrees a few at a time, never in bulk.

- Repo scripts run on Bun (`bun scripts/<name>.mjs`, `bun <file>.ts`). Only the tools `docs/development.md`, "Runtimes", lists stay on Node; a new one needs a real reason there and a one-line comment where it starts.

- Use the project skills in `.claude/skills/` when touching the tool they cover (Effect, StyleX, performance, and others as they are added).
- Tests (`docs/development.md`, "Rules for tests"). Tushar: "few meaningful tests >>>>> tons of one line slop tests. we do need good overall tests for realistic practice behaviours though." So:
  - Write realistic behaviour tests: user and system flows through the real code, against fakes at the boundaries (the fake Slack server, the fake model, a test clock): in the DOM lane (`apps/desktop/dom/`, `bun test` and happy-dom) when they check what the app shows and sends, in the browser lane when they need layout, and in Electron when they need main or the OS.
  - Unit tests only for something actually tricky (a protocol or merge rule, a parser edge case, a state machine), never 2–3 line checks of a mapping, a label or a constant.
  - No mocks: use fakes for boundaries.
  - "If any change in code requires change in test, the test isn't useful." Delete tests that never failed, change with every code change, and give no plausible signal.
  - Every test is isolated (no shared state, fixed ports, shared folders or order) so suites run in parallel, on the fastest runner.
  - Each lane's timeout is its limit on one test's time (`@juno/testing/limits`: unit 5 s, DOM 15 s, browser 20 s, Electron 30 s). A test over it is waiting on something it does not control: fix that. A longer timeout needs a `// Slow:` reason, which lint checks; keep those few. Full-run summaries list each lane's ten slowest tests.
  - Assume no order or timing the code does not guarantee, in either direction: before asserting a value, name what makes it final (wait for the thing itself with a retrying matcher or `expect.poll`, never a fixed sleep or a one-shot read after a different signal); start listeners and recorders before the action; hold an intermediate state with a test hook or do not assert it. No real time of day or wall-time assertions. `bun run lint` rejects new cases (`scripts/check-test-patterns.mjs`). To hunt a flake, read what each step waits for against what it asserts first, measure at normal load second, and stress (`bun run flake --stress`) last; a race in the app is fixed in the app.
- After changing `scripts/verify-*`, `scripts/remote/*` or the release gate, commit and run `bun run verify:main --ref HEAD --smoke` before a full run. It checks the laptop pipeline with one small unit file; its separate record cannot approve a release.
- No scheduled task runs the full suites. A full run (`bun run verify:main`) covers every test on the laptop, the `@heavy` ones included. The unit, DOM, browser and Electron lanes run each test file whose inputs changed since an earlier green full run (what affected selects it by, its data files and build, the runner's tools, image and time zone) plus a fresh 20% sample of the others, and reuse the rest's passes; a sampled file that fails fails the run as a missed input. The spec check reruns only checks whose inputs changed, conformance reuses its Quint traces, and the gallery reuses states whose walk-cache key is unchanged but checks a fresh 5% sample of them. Every test file runs when the last fully fresh run is over seven days old, every gallery state when the last uncached walk is, and both with `--no-cache`; `--with-mac` adds the Mac suites, by hand. It starts only when Tushar asks or a release needs one, and should take under two minutes. Before you report, run `bun run affected`: the local Bun typecheck and lint, then a selective remote plan (separate SSH jobs through tstack) (every desktop e2e spec in both lanes when the change reaches the desktop app, else the specs you changed, those that use changed e2e support and those you name with `--spec`; unit, engine and DOM lane files by the import graph; gallery components within a 300-second estimated test budget; heavy tests only for their own area). `bun run affected --plan` shows what it would run and why.
  - Unit tests run on `bun test`: `bun run test` runs every package's test files in one parallel `bun test --no-isolate` from the root, shuffled; it prints the seed and `--seed <n>` repeats the order (`--isolate` gives each file a fresh global, for flake hunting). A test that fails only in some orders is a bug to fix at its cause. To run a few files by hand: `bun run test --files <repo paths>` here, or `bun run remote test --files <repo paths>` (`packages/engine/test/flows/outbox.flow.test.ts`); in a package, `bun test --timeout=30000 <files>`. One e2e spec: `bun run remote test:desktop <files>`.
  `bun run typecheck:tsc` is manual only.
- Agents run merges, DMG builds and flake triage when Tushar asks. For a release, follow the `do-release` skill end to end: `bun run release` runs the full run, the publish and the check; you write the highlights while it runs and fix any failures. Repairs rerun failed and unfinished work plus everything the fix reaches, without a count or time cap. Quint follows its spec inputs, in full runs too, and a check that reruns takes a fresh seed; conformance follows outbox inputs in affected plans and replays against the engine in every full run, reusing its Quint traces while `outbox.qnt`, its imports, the seed and the Quint version are unchanged (`--no-cache` regenerates them). `bun run verify:main` runs on the laptop and fails when the laptop is unreachable; `--local` runs it on this Mac and is only for when Tushar asks, as is `bun run release --local`, the release with its full run on this Mac. The commands are `bun run verify:main`, `bun run release` and `scripts/batch-merge.mjs`; `bun run release` has no minimum gap between releases, and a green full run alone does not trigger one. If Tushar asks you about a failure in code you wrote, fix that first.
- The SSH laptop is shared by every agent and project through tstack’s allocator; Juno requests physical cores from its configured allocation: one remote run at a time per agent, never several in parallel, and never a loop of reruns. A release's runs take cores at high priority; mark other runs `--priority high` only when Tushar asks. Timed perf runs on demand only, never in a full run: `bun run remote --cores 2 perf` (the small set, or `--area <area>` when you change an area's hot path) against the laptop's baseline (`docs/performance.md` 7.3); every test run checks counted budgets instead. The feel scenarios run on the laptop in the browser lane; perf's absolute budgets, `bun run test:feel` (the feel scenarios in Electron, with full videos) and e2e tests tagged `@mac` run only on the Mac.
- Use `bun run web` for UI-only iteration (`docs/development.md`, "Web shell"). Stop it when done; Desktop verification includes the browser lane against an engine host and the Electron lane for native integration; `bun run test:desktop` routes specs to both.
- Do not run heavy work on this Mac: it has 8 GB of memory and hangs and restarts under agent load. Test suites, e2e, gallery, builds, packaging and full runs go to the laptop (`bun run remote <script>`, `bun run affected`, `bun run verify:main`). Light work stays here: git, `bun run typecheck`, `bun run lint`, one small test file. The Mac-only suites (`perf` against its absolute budgets, `test:feel`, `@mac` tests, the packaged smoke test) run here only when Tushar asks, one at a time, through the root scripts, which queue behind a machine-wide lock (`scripts/heavy.mjs`). Do not leave dev servers or watchers running. Stop only your own processes, by PID; never `pkill -f` or `killall` with a broad pattern.
- Sync protocols (follow state, read state, and later merge and the outbox) are specified in Quint in `specs/`. A change to how sync behaves updates the spec in the same change and passes `bun run specs:check`. Refactors and performance changes that preserve the protocol do not need a spec edit.
- A new import of an unstable Effect module needs an entry in the `unstable` list in `scripts/check-deps.mjs` and a note in the effect skill.
- Commit in small logical commits with plain messages. Only stage the paths you changed. Never add co-author trailers or mention AI tools in commits.
- Images and videos under `docs/` are in Git LFS. If `git status` shows images under `docs/` as modified after a merge or rebase, or `check-lfs` fails in lint, run `git add --renormalize docs` and commit (`docs/development.md`, "Git LFS").
- Never put real Slack tokens, cookies or message content into code, docs, logs, fixtures or commits.
- Live Slack checks are read-only. Writes are allowed only in a private test channel created for that purpose or in the user's self-DM.

## Writing

Docs, comments, UI copy and commit messages use plain, simple, concise English. No metaphors, no hype. UI copy follows SPEC.md section 17 (sentence case, short verb-first buttons, no emoji in chrome).

When a rule or fact changes, rewrite the text that states it, in every doc that states it. Do not add an "Update:" note under the old text; readers act on the first instruction they see.

`AGENTS.md` is a symlink to this file. Edit `CLAUDE.md` only.
