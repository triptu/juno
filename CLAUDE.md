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

- Use the project skills in `.claude/skills/` when touching the tool they cover (Effect, StyleX, performance, and others as they are added).
- Tests: prefer end-to-end tests that follow a user flow against the fake Slack server. Write unit tests only for pure domain rules, and test behaviour, not implementation details.
- Verify with `pnpm affected` while iterating and before calling work done: it typechecks the tsc projects whose inputs changed (remotely), runs the whole lint (on the Mac, about 3 s) and runs only the tests your change can reach, on Namespace machines in parallel (`docs/development.md`, "Affected tests"). Do not run a full local `pnpm typecheck` or `tsc -b`; if you want a quick local check while editing, run tsc on the one package you are editing (`pnpm --filter <package> typecheck`). Run full suites only when asked, before a merge; scheduled full runs cover main.
- Prefer `pnpm remote <script>` for `test`, `specs:check`, `test:agent*`, `test:gallery`, `test:desktop` and `test:e2e`: it runs on a Namespace Linux machine of its own and takes no local slot (`docs/development.md`, "Remote runs"). `perf`, `test:feel` and e2e tests tagged `@mac` run only on the Mac.
- Several agents share one machine. Run tests, e2e, gallery shots, benchmarks and spec checks through the root `pnpm` scripts, which queue behind a machine-wide lock (`scripts/heavy.mjs`, two slots; perf and feel runs take the whole machine). While iterating, run only the tests your change touches; run the full suites once before you report. Do not start several heavy runs at once, and do not leave dev servers or watchers running.
- Sync protocols (follow state, read state, and later merge and the outbox) are specified in Quint in `specs/`. A change to how sync behaves updates the spec in the same change and passes `pnpm specs:check`.
- A new import of an unstable Effect module needs an entry in the `unstable` list in `scripts/check-deps.mjs` and a note in the effect skill.
- Commit in small logical commits with plain messages. Only stage the paths you changed. Never add co-author trailers or mention AI tools in commits.
- Never put real Slack tokens, cookies or message content into code, docs, logs, fixtures or commits.
- Live Slack checks are read-only. Writes are allowed only in a private test channel created for that purpose or in the user's self-DM.

## Writing

Docs, comments, UI copy and commit messages use plain, simple, concise English. No metaphors, no hype. UI copy follows SPEC.md section 17 (sentence case, short verb-first buttons, no emoji in chrome).

`AGENTS.md` is a symlink to this file. Edit `CLAUDE.md` only.
