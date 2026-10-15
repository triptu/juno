# 0013. Run the Linux-safe test suites on Namespace machines

Status: accepted, 2026-10-15. `test` and `specs:check` pass remotely on current main.

## Context

Six or more agents work in parallel on one 8-core, 8 GB Mac. Every heavy suite takes one of two slots in `scripts/heavy.mjs`, and `perf` and `test:feel` take the whole machine. Agents spent more time waiting for a slot than running tests, the Mac swapped (11 GB of 12 GB swap in use), and checks with deadlines failed under the load. Most suites do not need the Mac: unit tests, Quint specs and the agent tests are plain Node, Java and Rust programs. Only the timing suites (`perf`, `test:feel`) depend on this machine.

[Namespace](https://namespace.so/docs) rents Linux machines by the minute through the `nsc` CLI. A machine starts in about 5 seconds, can be created for one run with a maximum duration, and pulls from a registry in the workspace.

## Decision

- `pnpm remote <script> [args...]` (`scripts/remote.mjs`) runs one root script on a fresh Linux machine and streams its output and exit code. Each run creates its own machine (`nsc create --bare --duration 60m`), so there is no shared lock between agents; the limit is the workspace's machine quota.
- Namespace's base image is Wolfi, without apt. The toolchain lives in our own image, `scripts/remote/Dockerfile`: Playwright's Ubuntu image (Chromium, its system libraries, xvfb) plus Node 26, pnpm 12, Java 21, the installed workspace (including Electron) and Quint's Rust evaluator and Apalache. Its tag is a hash of the Dockerfile, `pnpm-lock.yaml` and `pnpm-workspace.yaml`. When the registry lacks it, `pnpm remote` builds it with `nsc build --push` (about two minutes), one build per Mac at a time.
- What is sent: the files git sees in the worktree (`git ls-files --cached --others --exclude-standard`), so uncommitted work is tested and ignored files (`.env`, `node_modules`, `out/`, test output) are not. Non-Markdown files under `docs/` are left out (design images, about 93 MB). The script refuses to send a file that looks like a key or token file, or whose contents look like a real Slack token or `d` cookie. The tar is streamed into the container over `nsc ssh`; macOS extended attributes are left out (they arrived as `._` test files).
- Inside, `scripts/remote/run.sh` links the workspace offline, runs the script under xvfb as a normal user with workers sized to the machine, samples CPU use, and packs reports. `nsc ssh` reports every failure as exit code 1, so the script's own code comes back as a marker line.
- The machine is destroyed when the run ends, on failure, on Ctrl-C and when the client exits; `--duration` ends a machine whose client died. A dial timeout before the script starts is retried.
- `perf` and `test:feel` are refused: they time the Mac.
- `specs:check` gets a 16x32 machine (Apalache servers next to the simulations fill it); the rest get 8x16.

### Which suites match the Mac on Linux

| Suite | On Linux | Notes |
| --- | --- | --- |
| `test`, `test:agent*` | Same results (verified) | Node and SQLite only. |
| `specs:check` | Same results (verified) | Quint's Rust simulator and Apalache, fixed seed. |
| `test:gallery` | Same results (verified) | The shift guard compares a page with itself, never with a Mac image. A behaviour test checks that every font family comes from the bundle, which it does on Linux too. Screenshots (`gallery:shots`) are for reviewing the Mac look; shoot them on the Mac. |
| `test:desktop`, `test:e2e` (Electron) | Same results (verified), except one test tagged `@mac` | Under xvfb. Electron is started once before the workers (parallel first starts failed with ETXTBSY), and Chromium is told there is a mouse so `(hover: hover)` styles apply. The sidebar width is not restored after a relaunch on Linux, so that test runs on the Mac only. |
| `perf`, `test:feel` | No | They time frames on the Mac. |

## Cost

Prices from <https://namespace.so/pricing>, October 2026: Linux 8x16 is $0.008 a minute prepaid, 16x32 about twice that, billed by the minute. A `specs:check` run on 16x32 takes about 3.5 minutes end to end, so about $0.06. Six agents running twenty remote jobs a day each is about 120 runs and well under $10 a day.

## Alternatives

- **Install the toolchain on each machine.** Wolfi has no apt, and installing Java, Node and Electron's libraries on every run costs minutes. The image does it once per lockfile.
- **Namespace GitHub Actions runners.** Good for scheduled runs later, but an agent would have to push a branch and read logs through the API. The direct machine streams output and tests uncommitted work.
- **A long-lived devbox per agent.** Keeps state warm, but is billed while idle and brings back shared state.
- **Cache volumes for the toolchain.** A volume is saved only when the instance's main process exits cleanly; machines we destroy did not save it in a test. The image does not depend on that.

## Consequences

- The heavy-job lock guards only Mac-bound work once agents use `pnpm remote` for the rest.
- A remote failure that does not reproduce on the Mac is a platform difference to fix or record, not a reason to skip the suite.
- Reports land in `.remote/`; clean it up from time to time.
