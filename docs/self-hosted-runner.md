# Juno on the shared runner

`pnpm remote` uses the SSH laptop by default. Install tstack with `/tstack:setup`.
Juno sends `$TSTACK_HOME/scripts/runner/host.sh` on every host call; `TSTACK_HOME`
defaults to `~/Documents/code/tstack`. A missing script fails before starting work.

For machine setup, power settings, lessons and troubleshooting, use `/tstack:runner`
and its [runner guide](https://github.com/triptu/tstack/blob/main/skills/runner/SKILL.md),
[Linux reference](https://github.com/triptu/tstack/blob/main/skills/runner/references/linux.md),
[Mac reference](https://github.com/triptu/tstack/blob/main/skills/runner/references/mac.md)
and [server reference](https://github.com/triptu/tstack/blob/main/skills/runner/references/server.md).

## Juno configuration

Keep the SSH address and key path in `~/.config/juno/runner.json`, outside Git:

```json
{ "host": "user@runner.local", "port": 2222, "key": "~/.ssh/runner" }
```

`JUNO_RUNNER_HOST`, `JUNO_RUNNER_PORT` and `JUNO_RUNNER_KEY` override these values.
Use the same SSH account as the laptop entry in tstack's machine registry.
Both clients use `~/.cache/juno-runner` for leases and `~/.config/juno-runner`
for capacity. Do not override these folders for that tstack machine.
`runner list` includes Juno jobs under project `juno`.
For `.local` hosts Juno probes IPv4 first, then dual stack on transport failure.
Authentication errors and connected-host failures stop the run.

```sh
pnpm runner:check
pnpm remote test --passWithNoTests test/messages.test.ts
pnpm remote test:plan test --passWithNoTests test/messages.test.ts + test:desktop e2e/app.spec.ts
```

Standalone jobs wait up to 60 seconds for capacity; split plans default to one hour so queued jobs can wait for capacity released by their siblings. `--wait <seconds>` or
`JUNO_RUNNER_WAIT` changes the wait, including for each job in a split plan.
An unreachable or full runner fails with a message explaining that `--local`
runs the steps on this Mac through the heavy lock. There is no automatic local
fallback. Use `pnpm remote --local <script>` or `pnpm affected --local`.
Namespace, if needed again, is available only through `/tstack:runner`.

## Job sizes and workers

The laptop lends physical cores `4-11`. tstack maps their sibling threads,
reserves disjoint core sets, and applies the CPU quota, memory cap and tmpfs.
Juno requests these budgets:

| Work | Physical cores | Memory cap |
| --- | ---: | ---: |
| Narrow units, agent tests, cached spec checks | 1 | 3 GiB |
| Wide units, gallery, desktop/e2e, uncached spec checks | 2 | 6 GiB |
| Conformance, trace generation, other scripts | 4 | 12 GiB |

Wide units have no named files or more than 20 files. Default sizes shrink to
fit smaller hosts; explicit `--cores <n>` requests fail if too large.
The older `--machine linux/amd64:NxM` and `JUNO_REMOTE_MACHINE` spellings request
`ceil(N / 2)` whole cores; memory follows the table's 3 GiB per core.
On quota hosts these counts are CPUs: a narrow job gets one CPU, with no burst to two.

Workers use tstack's actual `RUNNER_THREADS`, exposed in Juno's log as
`remote: allocated threads=N`, rather than assuming two threads per core.
At four allocated threads, wide units use four Vitest workers in each of two
packages, standalone desktop uses three workers (two in sequential app plans),
and gallery uses four workers. Quint uses one simulation per two threads and
one Apalache checker per four, at least one each. Explicit worker settings win.

`test:plan` groups unit, gallery, desktop and specs steps into separate jobs.
Conformance belongs to specs. Gallery and desktop overlap within the existing
lent allocation and restore their own verified persistent builds. Each job has
its own workspace, install, results and independently released core set.
`JUNO_RUNNER_PLAN=single` keeps one job; `JUNO_PLAN_SERIAL=1` also runs its steps
in order. `--cores` and `--wait` apply to each job. `--shards n` is an explicit
split into n jobs on the same shared allocator.

## Toolchain, caches and results

Juno builds `scripts/remote/Dockerfile` through tstack's shared image-build lock.
Its tag hashes the Dockerfile and Quint pin; the build context contains just
that Dockerfile and `toolchain.json`. It includes Playwright's Ubuntu libraries,
Node, pnpm, Java and Quint. `JUNO_RUNNER_IMAGE` selects an existing compatible
toolchain image; every run installs the uploaded workspace, including with an
override. Images must not depend on a baked `/work`, which tstack mounts as tmpfs.

Each job runs `pnpm install --frozen-lockfile --prefer-offline`, checks the Bun
version and starts tests under xvfb. tstack mounts `~/.cache/tstack-runner` at
`/cache`; Juno keeps the pnpm store, metadata, Electron downloads and app build
cache there. Missing packages are downloaded. The former Juno cache is not
removed or migrated while other clients might use it.

Passing spec results travel with the workspace and return with new results.
Logs, test reports and coverage arrive in `.remote/<job>/`; split plans have a
`plan.log` plus child `run.log` files. `pnpm remote:usage` summarizes retained
logs across worktrees, including failed and incomplete runs.

## Cancellation and sleep

On macOS the client runs `caffeinate -i -w <pid>` throughout remote preparation,
capacity waiting and execution. Closing the lid can still suspend it.
After upload the client sends a heartbeat every ten seconds. tstack stops the
job and frees its lease when the connection ends or heartbeats cease for sixty
seconds. Split children stop when their coordinator's pipe closes, including
when the coordinator is killed. Only the shared host script stops containers
and releases leases; Juno ships no allocator or host cleanup script.
