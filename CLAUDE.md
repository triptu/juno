# Juno

Juno is a calm, topic-first desktop client for Slack. It reads and writes real Slack data through the same internal API the official client uses, and reorganizes it around topics (threads, plus one Main stream per channel or DM).

## Where things are written down

- `docs/design/handoff/SPEC.md` decides product behaviour. Where the prototype disagrees, the spec wins.
- `docs/design/inventory.md`, `tokens.md` and `primitives.md` describe every surface and value the UI needs.
- `docs/architecture.md` decides structure. `docs/decisions/` records why the big choices were made.
- `docs/research/` holds what we learned by reverse engineering Slack. Treat it as evidence, with its stated unknowns.
- `docs/development.md` covers setup, commands and known toolchain pitfalls.
- `specs/` holds Quint specs of the concurrent sync protocols, readable on their own (start with `specs/README.md`).

Read the parts relevant to your task, and the package's README, before changing code. If the code and a doc disagree, fix whichever is wrong in the same change.

## How the code is shaped

- Many small packages, each with one job and a declared dependency direction. Respect the graph in `docs/architecture.md`; do not add an edge to make something convenient.
- Business logic lives in Effect services outside the renderer. The renderer is UI only.
- UI is layered: tokens, then primitives, then dumb views (props in, callbacks out), then containers that wire state to views. Views never import state, Effect or Electron.
- Every design value comes from `@juno/tokens`. No raw colours or sizes in components.
- The app should feel like a native macOS app. Never use `cursor: pointer`, except on links in message content that open outside the app.
- Speed is a feature. Every interaction has a budget in `docs/performance.md`, and changes must not regress it.

## Working rules

- Add each decision as one dated line in its own `docs/decisions/log/YYYY-MM-DD-HHMM-slug.md` fragment (IST; choose a distinct slug). Run `node scripts/decision-log.mjs` and commit the generated result. Never edit `docs/decision-log.md` by hand; lint checks it against the fragments.

- Use the project skills in `.claude/skills/` when touching the tool they cover (Effect, StyleX, performance, and others as they are added).
- Tests: prefer end-to-end tests that follow a user flow against the fake Slack server. Write unit tests only for pure domain rules, and test behaviour, not implementation details.
- Merge first, test in full afterwards (`docs/development.md`, "Testing"). Many agents work at once, so no agent runs a full suite. Before you report, run only what your change touches:
  - `pnpm typecheck` (fast local Bun check) and `pnpm lint` (about 3 s).
  - The unit test files your change reaches: `pnpm remote test <files>`.
  - The e2e spec files you added or changed, and the ones for the feature you changed: `pnpm remote test:desktop <files>`.
  - Gallery shots only for components you changed: `GALLERY_SHIFT_ONLY=<Component,...> pnpm remote test:gallery`.
  - `pnpm specs:check` only when you changed a spec or the sync code it models.
  Do not run bare `pnpm affected` or `pnpm remote test:desktop` with no files until `docs/development.md` says it selects narrowly again: each now runs on one machine, but most UI changes still select the whole desktop e2e. `pnpm typecheck:tsc` is manual only.
- The CI keeper, an agent the orchestrator runs, tests main in full once several merges have landed or enough time has passed, and fixes or routes what fails. If it asks you about a failure in code you wrote, fix that first.
- Remote machines are shared by every agent, capped at 24 vCPU (three 8x16 machines, the one standard shape): one remote run at a time per agent, never several in parallel, and never a loop of reruns. `perf`, `test:feel` and e2e tests tagged `@mac` run only on the Mac.
- This Mac has 8 cores and 8 GB of memory and is also the owner's computer. Do not run e2e, gallery or spec suites locally. A local `pnpm --filter <package> build` or one package's typecheck is fine. Anything heavy that must run locally goes through the root `pnpm` scripts, which queue behind a machine-wide lock (`scripts/heavy.mjs`). Do not leave dev servers or watchers running. Stop only your own processes, by PID; never `pkill -f` or `killall` with a broad pattern.
- Sync protocols (follow state, read state, and later merge and the outbox) are specified in Quint in `specs/`. A change to how sync behaves updates the spec in the same change and passes `pnpm specs:check`.
- A new import of an unstable Effect module needs an entry in the `unstable` list in `scripts/check-deps.mjs` and a note in the effect skill.
- Commit in small logical commits with plain messages. Only stage the paths you changed. Never add co-author trailers or mention AI tools in commits.
- Never put real Slack tokens, cookies or message content into code, docs, logs, fixtures or commits.
- Live Slack checks are read-only. Writes are allowed only in a private test channel created for that purpose or in the user's self-DM.

## Writing

Docs, comments, UI copy and commit messages use plain, simple, concise English. No metaphors, no hype. UI copy follows SPEC.md section 17 (sentence case, short verb-first buttons, no emoji in chrome).

`AGENTS.md` is a symlink to this file. Edit `CLAUDE.md` only.
