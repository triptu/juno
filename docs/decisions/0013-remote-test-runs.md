# 0013. Run the Linux-safe test suites on Namespace machines

Status: proposed, 2026-10-15. `pnpm remote` is built and has a dry run; nothing has run on Namespace yet (no account).

## Context

Six or more agents work in parallel on one 8-core, 8 GB Mac. Every heavy suite takes one of two slots in `scripts/heavy.mjs`, and `perf` and `test:feel` take the whole machine. Agents spend more time waiting for a slot than running tests. Most suites do not need the Mac: unit tests, Quint specs and the agent tests are plain Node, Java and Rust programs. Only the timing suites (`perf`, `test:feel`) and the screenshots (`gallery:shots`) depend on this machine.

[Namespace](https://namespace.so/docs) rents Linux and macOS machines by the minute through the `nsc` CLI. A machine starts in seconds, can be created for one run with a maximum duration, and can mount a cache volume that survives between machines.

## Decision

- `pnpm remote <script> [args...]` (`scripts/remote.mjs`) runs one root script on a fresh Linux machine and streams its output. Each run creates its own machine, so there is no shared lock between agents; the limit is the account's machine quota.
- What is sent: the files git sees in the worktree (`git ls-files --cached --others --exclude-standard`), so uncommitted work is tested and ignored files (`.env`, `node_modules`, `out/`, test output) are not. Non-Markdown files under `docs/` are left out (design images, about 93 MB). The script refuses to send a file that looks like a key or token file, or whose contents look like a real Slack token or `d` cookie. The repo already holds no secrets or Slack data by rule; this is a second check.
- On the machine, `scripts/remote/setup.sh` installs Java, xvfb, Node and pnpm, then `pnpm install --frozen-lockfile`. Downloads, the pnpm store and Playwright's Chromium live on the `juno-toolchain` cache volume, so later machines skip them. `scripts/remote/run.sh` runs the script as a normal user under xvfb, with `GALLERY_BROWSER=chromium` and `CI=1`.
- Reports (`specs/traces`, Playwright `test-results` and `playwright-report`) are copied back into `.remote/<run>/` (ignored by git). The machine is destroyed after the run, also on failure; `--duration 45m` ends a machine whose client died.
- Allowed scripts: `test`, `specs:check`, `specs:traces`, `test:agent`, `test:agent-contracts`, `test:agent-testing`, `test:gallery`, `test:e2e`. `perf`, `test:feel` and `gallery:shots` are refused: they measure or show the Mac.

### Which suites match the Mac on Linux

| Suite | Expected on Linux | Why |
| --- | --- | --- |
| `test`, `test:agent*` | Same results | Node and SQLite only. The engine suite runs its files one at a time because the Mac is overloaded; on a dedicated machine that could be relaxed. |
| `specs:check` | Same results | Quint's Rust simulator and Apalache on Java, with a fixed seed. |
| `test:gallery` (behaviour and shift guard) | Same results expected, to confirm on the first run | The shift guard compares the page with itself before and after each touch, never with a Mac image. Linux text metrics differ slightly (the fonts are bundled, the rasteriser is not), so a layout that wraps differently could change which states are exercised. Run it on both once and compare. |
| `test:e2e` (Electron) | Likely, to confirm on the first run | The app already handles non-Mac platforms (no traffic lights or app menu, `app.quit` on last window). Tests use no Cmd shortcuts. `app.spec.ts` reads `process.platform`, so it adapts. Electron needs xvfb and a non-root user. |
| `gallery:shots` | No | The screenshots are for reviewing the Mac look. |
| `perf`, `test:feel` | No | They time frames on the Mac. |

## Cost

Prices from <https://namespace.so/pricing>, October 2026. Linux `8x16` (8 vCPU, 16 GB) is $0.008 a minute prepaid ($0.012 overage), billed by the minute with a one-minute minimum. A cold run adds about two minutes of setup; with a warm cache volume, about one. A `specs:check` or `test` run is then 3 to 6 minutes, so about $0.03 to $0.05. Six agents running twenty remote jobs a day each is about 600 machine minutes, about $5 a day. Cache volumes cost $0.002 per GB-hour while attached, which is negligible at 30 GB for a few minutes.

Plan limits on concurrent Linux machines: Developer (free, pay as you go) 32 vCPU, so four `8x16` machines at once; Team ($100 a month, 100,000 unit minutes included) 64 vCPU, eight at once. Team is the right size for six to eight agents.

## What the owner sets up

1. A Namespace account and workspace (Team plan for eight concurrent machines).
2. `brew install namespacelabs/namespace/nsc`, then `nsc login` once on the Mac.
3. A token for scripts, stored outside the repo (the docs show this grant; whether `nsc ssh` needs more actions is unconfirmed):
   `nsc token create --name juno-remote --grant '{"resource_type":"instance","resource_id":"*","actions":["create","get","list","destroy"]}' --expires_in 365d --token_file ~/.config/juno/nsc-token.json`
   and `export NSC_TOKEN_FILE=~/.config/juno/nsc-token.json` in the shell profile the agents use. `pnpm remote` refuses a token file inside the repo.
4. A first run of each suite with both `pnpm <script>` and `pnpm remote <script>`, to confirm the Linux results match before agents switch.

Still unconfirmed, to check on the first run: that `nsc ssh -T` forwards stdin (the upload and report copy pipe a tar stream through it), the base image of `nsc create --bare` (setup.sh assumes Ubuntu with apt and root), and the token grants `ssh` needs.

## Alternatives

- **Namespace GitHub Actions runners.** Good for CI later, but an agent would have to push a branch, wait for a workflow to be queued and read logs through the API. The direct machine streams output and tests uncommitted work.
- **A long-lived devbox per agent.** Keeps `node_modules` warm, but is billed while idle and gives back a shared-state problem the per-run machine avoids.
- **A bigger Mac.** Helps the timing suites, which must stay on a Mac, but does not scale with the number of agents.

## Consequences

- The heavy-job lock now guards only Mac-bound work when agents use `pnpm remote` for the rest.
- A remote failure that does not reproduce on the Mac is a platform difference to fix or record, not a reason to skip the suite.
- Reports land in `.remote/`; clean it up from time to time.
