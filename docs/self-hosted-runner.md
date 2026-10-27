# Juno on the shared runner

`bun run remote` uses the SSH laptop by default. Install tstack with `/tstack:setup`.
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
bun run runner:check
bun run remote test --files packages/engine/test/flows/topic-view.flow.test.ts
bun run remote test:plan test --files packages/engine/test/flows/topic-view.flow.test.ts + test:desktop e2e/app.spec.ts
```

Standalone jobs wait up to 60 seconds for capacity; split plans and `verify:main` (full runs, repairs and the release's run) default to one hour, so queued jobs can wait for capacity released by their siblings or by other agents. `--wait <seconds>` or
`JUNO_RUNNER_WAIT` changes the wait, including for each job in a split plan.
`--priority high` or `JUNO_PRIORITY=high` puts every job of the run ahead of waiting
normal jobs from any project; a release does this ("Remote runs" in development.md).
An unreachable or full runner fails with a message explaining that `--local`
runs the steps on this Mac through the heavy lock. There is no automatic local
fallback. Use `bun run remote --local <script>` or `bun run affected --local`.
Namespace, if needed again, is available only through `/tstack:runner`.

## Job sizes and workers

The laptop lends physical cores `3-11` (`~/.config/juno-runner/cores` on the laptop, read only by tstack's
`scripts/runner/host.sh`): its eight dense cores (4 to 11, up to 3.3 GHz) and one of its four fast cores (3, up to
5.2 GHz), so a job that holds core 3 runs a little faster. Cores 0 to 2 stay with the laptop and other projects.
Nine lent cores at 3 GiB each cap jobs at 27 GiB of the laptop's 30 GiB; full runs have peaked at about 17 GiB
on the host. tstack maps their sibling threads,
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
At four allocated threads, units run four `bun test` processes, standalone desktop uses three workers (two in sequential app plans),
and a job of only the gallery uses five (four per three threads). Quint uses one simulation per two threads and
one Apalache checker per four, at least one each. Explicit worker settings win.

`test:plan` groups its steps into two jobs: a desktop job (the browser and Electron lanes,
the spec checks and conformance) and a unit job (unit tests, the DOM lane, the gallery and the
tool tests); "Remote runs" in `docs/development.md` has the detail. The coordinator checks the
runner and its image and packs the workspace once. Each job has its own install, results and independently released core set. In a full run
each job runs its steps in order, except that Electron runs beside the browser lane; elsewhere
a job's lanes run at once with their own workers.
`JUNO_RUNNER_PLAN=single` keeps one job; `JUNO_PLAN_SERIAL=1` also runs its steps
in order. `--cores` and `--wait` apply to each job. `--shards n` is an explicit
split into n jobs on the same shared allocator.

## Toolchain, caches and results

Juno builds `scripts/remote/Dockerfile` through tstack's shared image-build lock.
Its tag hashes the Dockerfile and the Quint and Bun pins; the build context contains just
that Dockerfile and `toolchain.json`. It includes Playwright's Ubuntu libraries,
Node, Bun, Java and Quint. `JUNO_RUNNER_IMAGE` selects an existing compatible
toolchain image; every run installs the uploaded workspace, including with an
override. Images must not depend on a baked `/work`, which tstack mounts as tmpfs.

Each job runs `bun install --frozen-lockfile --prefer-offline`, checks the Bun
version and starts tests under xvfb. Electron's binary warm-up uses `--no-sandbox`,
as its test launches do: the container cannot use its setuid sandbox helper.
A failed warm-up fails the job and keeps stderr. tstack sets both core limits to
one byte (`--ulimit core=1:1`), which makes Linux skip its piped core handler;
zero still reaches systemd-coredump and the desktop crash reporter. Test crashes
still fail through their exit status and logs. tstack mounts `~/.cache/tstack-runner` at
`/cache`; Juno keeps the bun run store, metadata, Electron downloads, the app build
cache and the spec cache (`/cache/specs`, entries unused for 14 days removed) there. Missing packages are downloaded. The former Juno cache is not
removed or migrated while other clients might use it.

Logs, test reports and coverage arrive in `.remote/<job>/`; split plans have a
`plan.log` plus child `run.log` files. `bun run remote:usage` summarizes retained
logs across worktrees, including failed and incomplete runs.

## Cancellation and sleep

On macOS the client runs `caffeinate -i -w <pid>` throughout remote preparation,
capacity waiting and execution. Closing the lid can still suspend it.
After upload the client sends a heartbeat every ten seconds. tstack stops the
job and frees its lease when the connection ends or heartbeats cease for sixty
seconds. Split children stop when their coordinator's pipe closes, including
when the coordinator is killed. Only the shared host script stops containers
and releases leases; Juno ships no allocator or host cleanup script.
