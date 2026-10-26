# 0013. Run Linux-safe suites on the shared SSH runner

Status: accepted 2026-10-15; hosting decision superseded 2026-10-19.

## Context

Concurrent test runs exhausted the shared Mac's CPU and memory. Unit tests,
Quint checks and browser tests can run on Linux; timing tests need the Mac.
The original hosting decision rented cloud machines. The owner now lends
physical cores on a Linux laptop shared with other projects.

## Superseding decision, 2026-10-19

Use the SSH laptop by default. Juno sends tstack's `scripts/runner/host.sh`
from `$TSTACK_HOME`, defaulting to `~/Documents/code/tstack`. Missing tstack
fails with `/tstack:setup` instructions. The shared script owns reservation,
container lifecycle, leases, heartbeat cleanup and the image-build lock.
All clients use `~/.cache/juno-runner` and `~/.config/juno-runner` on the host.

Juno retains its unit/app/specs plan split, physical-core workload budgets,
worker settings, toolchain image, pnpm store installation, affected selection
and report parsing. Workers follow the host's actual thread allocation. In
quota mode a narrow job gets one CPU without a two-CPU burst.

Remove the cloud backend, warm pool, daemon and outage recovery. An unreachable
or full laptop fails after the configured wait; `--local` runs the steps on
this Mac through the heavy lock. Namespace is available only through
`/tstack:runner` if explicitly wanted again.

Keep the Mac client awake with `caffeinate -i -w <pid>`. A closed session or
missed heartbeat stops the job and releases cores. Juno does not maintain a
second allocator or container cleanup path.

## Consequences

Jobs from all projects count against the same capacity. Each split job releases
its cores independently. A changed lockfile installs against the persistent
store without rebuilding the toolchain. Reports return to the client; the spec
cache stays on the runner under `/cache`. The laptop must be reachable; no paid fallback is hidden
inside a test command. Setup and troubleshooting belong to `/tstack:runner`;
[the Juno runner guide](../self-hosted-runner.md) contains only project settings.

### Which suites match the Mac on Linux

| Suite | On Linux | Notes |
| --- | --- | --- |
| `test`, `test:agent*` | Same results (verified) | Node and SQLite only. |
| `specs:check` | Same results (verified) | Quint's Rust simulator and Apalache, fixed seed. |
| `test:gallery` | Same results (verified) | The shift guard compares a page with itself, never with a Mac image. A behaviour test checks that every font family comes from the bundle, which it does on Linux too. Screenshots (`gallery:shots`) are for reviewing the Mac look; shoot them on the Mac. |
| `test:desktop`, `test:e2e` (Electron) | Same results (verified), except one test tagged `@mac` | Under xvfb. Electron is started once before the workers (parallel first starts failed with ETXTBSY), and Chromium is told there is a mouse so `(hover: hover)` styles apply. The sidebar width is not restored after a relaunch on Linux, so that test runs on the Mac only. |
| `perf`, `test:feel` | No | They time frames on the Mac. |
