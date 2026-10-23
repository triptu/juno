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

- Add each decision as one dated line in its own `docs/decisions/log/YYYY-MM-DD-HHMM-slug.md` fragment (IST; choose a distinct slug). Run `node scripts/decision-log.mjs` and commit the generated result. Never edit `docs/decision-log.md` by hand; lint checks it against the fragments.

- Create a worktree with `node scripts/worktree.mjs add <name>` and remove it with `node scripts/worktree.mjs remove <name>` (`docs/development.md`, "Worktrees and installs"). New worktrees go in `/Volumes/AgentWork/worktrees/juno/<name>` when that volume is mounted, else in `.claude/worktrees/`; the helper, `batch-merge.mjs` and packaging pick the folder the same way. Installs link from Bun's global store, so a worktree's `node_modules` stays small. Remove worktrees a few at a time, never in bulk.

- Use the project skills in `.claude/skills/` when touching the tool they cover (Effect, StyleX, performance, and others as they are added).
- Tests: prefer end-to-end tests that follow a user flow against the fake Slack server. Write unit tests only for pure domain rules, and test behaviour, not implementation details.
- A scheduled task runs the full suites on main once a day; the agent that runs it commits the refreshed coverage map and merges it. Before you report, run `bun run affected`: the local Bun typecheck and lint, then a selective remote plan (separate SSH jobs through tstack) (the specs you changed or name with `--spec`, at most 10 more picked by coverage, gallery specs by component, heavy tests only for their own area). `bun run affected --plan` shows what it would run and why.
  - To run a few unit test files by hand: `bun run remote test --passWithNoTests <files>`, with paths relative to their package (`test/messages.test.ts`, not `packages/engine/test/messages.test.ts`); the script runs vitest in every package. One e2e spec: `bun run remote test:desktop <files>`.
  `bun run typecheck:tsc` is manual only.
- A scheduled task runs the full suites on main once a day. Agents run merges, DMG builds and flake triage when Tushar asks. For a release, follow the `do-release` skill end to end: the full run, fixes, publish and check. `bun run verify:main --local` runs the full plan here through the heavy lock; without the flag it falls back here when the laptop is unreachable. The commands are `bun run verify:main`, `bun run release:scheduled` and `scripts/batch-merge.mjs`; `bun run release:scheduled` has no minimum gap between releases, and a green full run alone does not trigger one. If Tushar asks you about a failure in code you wrote, fix that first.
- The SSH laptop is shared by every agent and project through tstack’s allocator; Juno requests physical cores from its configured allocation: one remote run at a time per agent, never several in parallel, and never a loop of reruns. `perf`, `test:feel` and e2e tests tagged `@mac` run only on the Mac.
- Use `bun run web` for UI-only iteration (`docs/development.md`, "Web shell"). Stop it when done; Electron e2e remains the merge gate.
- This Mac has 8 cores and 8 GB of memory and is a spare machine. Any suite, perf and feel included, may run on it whenever a change needs it, through the heavy lock while load stays at most 8. Prefer remote runs for e2e and gallery, since they are faster there. A local `bun run --cwd <package> build` or one package's typecheck is fine. Anything heavy that must run locally goes through the root package scripts (`bun run <script>`), which queue behind a machine-wide lock (`scripts/heavy.mjs`). Do not leave dev servers or watchers running. Stop only your own processes, by PID; never `pkill -f` or `killall` with a broad pattern.
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
