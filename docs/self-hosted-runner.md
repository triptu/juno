# Set up an optional SSH runner

Configure the runner on each Mac in `~/.config/juno/runner.json`. Every agent
then tries it before Namespace, without setting environment variables.
An unreachable host falls back to Namespace. For `.local` hosts, SSH tries IPv4 first and falls back to dual stack if the transport cannot connect. The successful family is reused for the job. This avoids a five-second stall on the laptop's advertised but unreachable IPv6 address. Authentication and connected-host failures still stop the run. A reachable host with broken
Docker, an SSH key error, an image-build failure, or failing tests returns an
error without fallback. A standalone job waits up to 60 seconds for free cores before
falling back. Split plan jobs stay on SSH and wait for capacity; an unreachable
runner falls back to one Namespace plan before splitting. Set `JUNO_REMOTE_MAX_VCPU=0` to forbid Namespace allocation and
wait for runner capacity without a deadline.

## Capacity and isolation

The host's `~/.config/juno-runner/cores` controls admission across every client
using the same Linux account. It accepts two formats:

- A positive number, such as `16`, keeps quota-only admission and the existing
  reservations. Existing clients and other hosts can keep this format.
- A list or range, such as `4-11` or `4-5,8-11`, lends whole physical cores.
  Name each core by its lowest sibling CPU number. Use `4-4` to lend just core
  4; a bare `4` means quota capacity. The runner reads
  `/sys/devices/system/cpu/cpu*/topology/thread_siblings_list` and includes every
  sibling. It rejects duplicate, missing, offline and non-representative IDs.
  This avoids package-local `core_id` values, which differ from `lscpu` on the
  laptop. No sibling offset is hard-coded.

The owner's Ryzen AI 9 HX 370 has 12 physical cores and 24 threads. Cores 0–3
(CPUs 0–3 and 12–15) are Zen 5, with 16 MiB shared L3 and a 5.16 GHz maximum.
Cores 4–11 (CPUs 4–11 and 16–23) are Zen 5c, with 8 MiB shared L3 and a
3.29 GHz maximum. Verified with `lscpu -e=CPU,CORE,CACHE,MAXMHZ` and sysfs on
2026-10-19. The performance power profile is enabled. `4-11` lends only the
eight dense cores; runner containers cannot execute on the four fast cores.
The desktop may still use the dense cores: this is job affinity, not a host
scheduler partition.

| Job | Physical cores | Laptop threads | Memory cap | Each tmpfs mount |
| --- | --- | --- | --- | --- |
| Narrow unit, `test:agent*`, cached spec check | 1 | 2 | 3 GiB | 2 GiB |
| Wide unit, uncached spec check | 2 | 4 | 6 GiB | 2 GiB |
| Desktop/e2e, gallery | 2 | 4 | 6 GiB | 2 GiB |
| Conformance, other scripts | 4 | 8 | 12 GiB | 4 GiB |

Wide means `test` without named files or with more than 20 files, or
`specs:check` without a carried cache or with caching disabled. The threshold
is an admission heuristic. Default sizes shrink to fit a smaller host.
`--machine` and `JUNO_REMOTE_MACHINE` specify a thread budget in physical mode,
rounded up to whole two-thread cores; explicit sizes fail if too large. Actual
Docker CPU quotas and workers use the sibling count discovered on the host.
Memory is 3 GiB per reserved physical core; eight lent cores bound the sum of
job memory caps to 24 GiB. Tmpfs consumes this cap; it is not additional RAM.

Pinned containers use `--cpuset-cpus`, `--cpus` equal to their allocated thread
count, and equal `--memory`/`--memory-swap` limits (no container swap).
`/tmp` and the disposable `/work` workspace are tmpfs, with `TMPDIR`, `TMP`
and `TEMP` set to `/tmp`. Test SQLite databases, engine and Electron profiles,
and local build output therefore live in RAM. Persistent dependency and build
caches remain on disk, as do downloaded reports. Custom full-image overrides
keep their baked `/work` and mount only `/tmp`. The image needs executable
temporary storage for Electron and toolchain helpers. Numeric configs retain
the former Docker arguments, without these memory or tmpfs limits.

The host lock protects exact core sets in leases. Admission prefers adjacent
free cores, then takes fragmented free cores if needed. Jobs release their
lease only after their container stops. A later admission reaps a killed
lease owner, stops its recorded timeout process group and removes its Docker
container before reusing the cores. Every job still has a three-hour timeout.
A launch waits until its supervisor is recorded, so a crash during admission
cannot start an unrecorded container later. Live quota-only leases must drain
before pinned jobs can start. Stop old clients and let existing jobs finish
before changing the config under the host lock; old clients cannot read lists.

Quota mode reserves 4 slots for wide units and desktop/e2e, 3 for gallery,
1 for narrow units and cached specs, and 8 for other scripts. Narrow jobs have
a two-thread CPU limit; other limits match their reservation. Namespace,
including fallback, keeps its 8x16 default and existing pool.

Workers use `JUNO_RUNNER_JOB_CORES`, the allocated thread count. Narrow units
use two Vitest workers in one package; wide units use four workers in each of
two packages at four threads. Standalone desktop jobs use three workers at
four threads, and gallery jobs use three workers and shift parts. Sequential
app plans retain two desktop workers. Quint uses one simulation per two
threads and one Apalache checker per four, at least one each. Explicit worker
settings take precedence.

`test:plan` groups unit, app and specs steps into independent jobs, each with
its own core set, container, install, reports and cache results. Conformance
belongs to specs. App steps stay together and run in order, reusing builds.
A wide unit job (2 physical cores), desktop/gallery job (2) and conformance
job (4) fit the eight-core laptop allocation. Other clients can delay admission;
each job releases its cores independently.

Once split, every job waits for SSH capacity without a deadline; none falls
back independently to Namespace. An unreachable runner falls back to one
Namespace plan before splitting. `JUNO_RUNNER_PLAN=single` keeps one container
and the 60-second busy fallback. `JUNO_PLAN_SERIAL=1` also keeps one container
and runs every step in order. Explicit `--machine` sizing applies to each job.
Each child writes `run.log`; the coordinator writes `plan.log` with original
step indices. Usage summaries count only child logs. Cancellation forwards
to all jobs and waits for cleanup.

## Laptop measurements

### Affected plan shape (2026-10-19)

One before/after observation of an outbox-plus-Chip selection, with unchanged
product code and tests, on this same laptop. Baseline: `f601148d2`; after:
`test-plan-shape`. Both runs used a warm toolchain image and dependency store,
bypassed affected results, and carried the same 28 cached conformance runs:

```sh
JUNO_REMOTE_MAX_VCPU=0 pnpm affected --no-cache --files packages/engine/src/outbox.ts,packages/ui/src/Chip.tsx
```

| Work | Before, shared 4-core plan | After, separate SSH jobs |
| --- | --- | --- |
| Unit files selected by import closure | 48 | 48 |
| Files matched by execution filters | 64 | 48 |
| Unit step | 522 s, two Home failures | 146 s, passed |
| Conformance step | 65 s | 23 s |
| Gallery step, 283 tests | 245 s | 221 s |
| Desktop step, 26 tests | 110 s | 101 s |
| Remote wall, including setup, admission and reports | 598.6 s | 332.0 s |
| `affected` wall, including local checks | 604.7 s | 338.5 s |

The old unit executor started 17 packages and stopped on the engine failure
before reaching the selected desktop notifier test: 63 unit files appeared
in its summaries, including skips. The new executor started only engine and
desktop, and all 48 files appeared: 42 passed and six intentionally skipped.
The baseline Home title mismatch and AI-items timeout did not recur after.
All four conformance files passed on both sides. The after run's remote plan
passed; local lint caught the enlarged runner-test file, subsequently split
into a shared harness. The final branch check verifies that correction. It also exposed a missed
child-exit event in the heavy-queue test, which could hold the Mac reservation
forever. That harness now observes exits at spawn time, releases holders only
after both requests are queued, and bounds both checks to ten seconds.

The before run began around 08:25 IST at load average 1.27; the after run
began at 08:41 at 7.98. Both started beside two other 4-core reservations.
The after run's specs job waited about 153 s for eight cores. Units used four
workers in their own 4-core job instead of one worker under `nice`, and
conformance used four workers instead of one and could start independently.
The app job's 322 s now dominates. Installs took 0–1 s per job and traces
were cached, so neither explains the wall-time difference.

These are single observations on a changing shared host, not a repeatability
claim. The baseline assertion failures also limit attribution of its extra
time. An intervening plumbing probe failed before running units because the
first file enumerator expected Git metadata in the remote workspace; it is
excluded from the comparison. The final enumerator scans package directories.
Namespace remains one machine per plan; no extra Namespace machines were
allocated for these measurements.

Raw local logs: `.remote/20261019T025532-96649-467a73c6/run.log` (before),
`.remote/20261019T031144-15725-8f685150/plan.log` (after), with child reports
linked from the latter. Replay counts and plan snapshots are retained under
`.remote/plan-shape/` in the implementation worktree.

### Earlier unit and machine sizing

The initial full unit run on 2026-10-19 used two packages with two Vitest
workers each. It passed in 325 s script time and 328.53 s wall time, averaging
50% CPU with 1.54 GiB peak container memory.

Worker tuning uses the same full suite, four reserved cores, a four-core CPU
limit, two package jobs, and a warm image and dependency store. Each setting
runs once, sequentially. CPU busy is the two-second cgroup average as a share
of the four-core limit. Peak container memory includes file cache.

| Vitest workers per package | Script time | CPU busy, average | Peak memory | Result |
| --- | --- | --- | --- | --- |
| 4, one per core | 224 s | 78% | 1.90 GiB | Passed |
| 8, two per core | 262 s | 82% | 2.36 GiB | Two engine assertions failed |
| 12, three per core | 268 s | 84% | 3.06 GiB | Same two engine assertions failed |

Select four workers per package with two package jobs. This was the fastest
passing setting, averaging 78% CPU with 1.90 GiB peak container memory. Its
wall time was 226.74 s.
The four-worker run passed 1,803 tests in 197 files across 18 package
summaries, retaining the normal skips. Both higher-worker runs failed
assertions in `test/home.test.ts` and `test/sync.test.ts` and stopped before
desktop unit tests. Both containers had a 100% CPU median despite averages
below 90%. Another eight-core runner job started during the eight-worker run. Before the twelve-worker
run, that job used about 0.4 of a core and 1 GiB memory. These are single
observations on a shared host, not measurements of run-to-run variation.

Run each setting separately, replacing `<workers>` with 4, 8, or 12:

```sh
JUNO_REMOTE_MAX_VCPU=0 pnpm remote --env JUNO_TEST_PACKAGE_JOBS=2 --env JUNO_VITEST_WORKERS=<workers> test
```

Measured on 2026-10-19 on the owner's Linux x86_64 laptop with 24 threads and
30 GiB RAM. One successful run per size, sequentially, with the image already
present. Script time excludes setup, workspace linking and report download,
but includes each app build. CPU busy is the two-second cgroup average divided
by the Docker CPU limit. The measurements below predate the new reservations.
Peak memory is cgroup v2 `memory.peak` for the container's lifetime, including
file cache, reported as GiB here.

| Work | 8 cores: script / CPU busy / peak GiB | Earlier reduced size: script / CPU busy / peak GiB |
| --- | --- | --- |
| App plan: 54 unit tests and 21 desktop tests | 72 s / 41% / 4.07 | 4 cores: 86 s / 72% / 2.76 |
| Unit files: 54 tests | 46 s / 11% / 1.25 | 2 cores: 46 s / 44% / 1.21 |
| Gallery shift slice | 33 s / 36% / 2.65 | 4 cores: 38 s / 57% / 1.85 |

The app plan used two desktop workers at 4 cores and four configured at 8
(three active, one per selected spec). Its unit lane used one and two workers,
respectively. Standalone unit runs used two and eight configured vitest workers,
with one package at a time. The gallery used three workers and shift parts at
4 cores, six at 8. `GALLERY_SHIFT_ONLY=Chip` limited the shift guard; the other
41 tests in `shift.spec.ts` also ran, giving 44 and 47 passing tests. All tests
passed without test retries. These slices establish a sizing baseline, not concurrent
full-suite throughput.

Run the same slices at the current sizes:

```sh
JUNO_REMOTE_MAX_VCPU=0 pnpm remote test:plan test --passWithNoTests test/messages.test.ts test/reads.test.ts + test:desktop e2e/app.spec.ts e2e/topic.spec.ts e2e/send.spec.ts
JUNO_REMOTE_MAX_VCPU=0 pnpm remote test --passWithNoTests test/messages.test.ts test/reads.test.ts
JUNO_REMOTE_MAX_VCPU=0 pnpm remote --env GALLERY_SHIFT_ONLY=Chip test:gallery shift.spec.ts
```

Run each command separately. Insert `--machine linux/amd64:8x16` immediately
after `remote` for the 8-core comparison. These commands forbid Namespace
fallback during measurement.

Those quota-only measurements used capacity `16`, before physical-core pinning.
They allowed 4 app, 5 gallery, 4 wide unit or 16 narrow jobs at once. The new
`4-11` config allows four two-core jobs or eight one-core jobs, with disjoint
sibling CPU sets and a combined memory cap of 24 GiB. The historical slice
peaks above do not establish concurrent full-suite throughput.

The [toolchain and store measurements](development.md#toolchain-and-store-measurements) compare cold installs, warm installs, lockfile changes and complete runs on both backends. The IPv4 fix and its fresh-shell checks are recorded there too.

## Install Ubuntu on Windows

Run these commands in administrator PowerShell:

```powershell
wsl --update
wsl --install -d Ubuntu-24.04
wsl --set-version Ubuntu-24.04 2
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
```

Finish Ubuntu's first-run user setup. In Ubuntu, preserve existing settings and
add this section to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

Run `wsl --shutdown` from PowerShell, then reopen Ubuntu. Check that
`ps -p 1 -o comm=` prints `systemd`. Services alone do not keep WSL alive.
Register a login task as the Windows user who installed Ubuntu:

```powershell
$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument '-d Ubuntu-24.04 --exec /bin/sleep infinity'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Juno WSL runner' -Action $action -Trigger $trigger -Settings $settings -Force
Start-ScheduledTask -TaskName 'Juno WSL runner'
```

Install Tailscale **inside Ubuntu**, giving WSL its own address. If Windows also
runs Tailscale, follow [Tailscale's WSL guidance](https://tailscale.com/docs/install/windows/wsl2)
for coexistence and test from the Mac. Do not expose the SSH port to the internet.
Windows sleep settings apply while plugged in; Windows updates and shutdowns can
still stop the runner.

## Use native Ubuntu instead

Install Ubuntu 24.04 amd64. Run the shared Linux steps below, then disable suspend:

```sh
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo mkdir -p /etc/systemd/logind.conf.d
printf '[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore\n' | sudo tee /etc/systemd/logind.conf.d/juno.conf
```

Reboot after changing lid settings. This avoids restarting the login service
under an active desktop session.

## Install Docker, SSH and Tailscale in Linux

These steps apply to native Ubuntu and WSL Ubuntu. Install Docker Engine from
[Docker's Ubuntu repository](https://docs.docker.com/engine/install/ubuntu/).
If Docker Desktop integration or another Docker package is already installed,
resolve that conflict before adding Docker Engine.

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl openssh-server util-linux
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" "$VERSION_CODENAME" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker
mkdir -p ~/.ssh ~/.config/juno-runner
chmod 700 ~/.ssh
printf '%s\n' '<MAC_PUBLIC_KEY>' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
printf '8\n' > ~/.config/juno-runner/cores
```

Replace `<MAC_PUBLIC_KEY>` with the Mac's public key, never its private key.
For quota mode, choose a capacity no greater than `getconf _NPROCESSORS_ONLN`.
For physical mode, choose representative CPUs from the host topology and allow
3 GiB of job memory per lent physical core. Log out and back in to apply Docker group membership.

Configure SSH on port 2222:

```sh
printf 'Port 2222\nPubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' | sudo tee /etc/ssh/sshd_config.d/00-juno.conf
sudo sshd -t
sudo systemctl disable --now ssh.socket
sudo systemctl enable --now ssh.service
sudo systemctl restart ssh.service
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
sudo tailscale up --hostname=juno-runner
```

Complete Tailscale's interactive login. Use ordinary OpenSSH with public keys;
Tailscale SSH is not required. Allow only the Mac to reach TCP 2222 in your
tailnet policy. Verify the host key on the laptop before accepting it on the Mac.

## Configure the Mac

Create `~/.config/juno/runner.json` outside the repository:

```json
{
	"host": "<linux-user>@<host-or-ip>",
	"port": 2222,
	"key": "~/.ssh/juno_runner"
}
```

`JUNO_RUNNER_HOST`, `JUNO_RUNNER_PORT`, and `JUNO_RUNNER_KEY` override the
corresponding file values. `~/` in the key path expands to the Mac home folder.
An empty `JUNO_RUNNER_HOST` disables the runner for one command. Without a
configured host, runs use Namespace.

```sh
pnpm runner:check
pnpm remote test:agent-contracts
```

`runner:check` verifies Linux amd64, Docker access, and host capacity. It reports
whether the current image is present. A missing local image is informational,
because the first run builds it. Logs and reports use `.remote/<run>/` for
either backend. `pnpm affected` and `pnpm verify:main` use this configuration
through `pnpm remote test:plan`. A run on the runner does not start the Namespace
warm pool or its daemon. Namespace fallback still needs `nsc` on the Mac.

## Build and prune images on the runner

The SSH backend uses `juno-toolchain:<tag>`, built from
`scripts/remote/Dockerfile`. Its tag hashes the Dockerfile and the pinned Quint
version from the root manifest. Lockfile and workspace changes do not rebuild it.
Both backends use this toolchain. The image holds Playwright, Node, pnpm, Java 21 and Quint's warm downloads.
The build context contains only the Dockerfile and Quint's version.

Each job installs its unpacked workspace with
`pnpm install --frozen-lockfile --prefer-offline`, then checks Bun's pinned
version. Missing packages download on a cold store. The log reports
`remote: workspace installed in N s`. The host keeps pnpm's store at
`~/.cache/juno-runner/pnpm-store`, including registry policy metadata, and Electron's downloads at `~/.cache/electron`.
Jobs run as the SSH user's uid and reject cache directories owned by another
user. They share `~/.cache/juno-runner/runtime` for pnpm's store locks.
Each container keeps its own workspace and home directory.

A host lock allows one build at a time. Another client waits, checks for the tag
again, and reuses the completed image. Build step summaries and elapsed time
appear in the run log. The 60-second capacity wait starts after the image is
ready. Builds can take several minutes on first use.

Run `pnpm runner:prune` on the Mac to remove old `juno-remote:*` and `juno-toolchain:*` tags and unused
Docker build cache from the runner. It keeps the current tag and never forces
removal of images referenced by containers. Stop old jobs before pruning if
Docker reports an image is in use. The prune command shares the build lock and leaves the pnpm store and Electron cache alone.

## Use a prebuilt image instead

`JUNO_RUNNER_IMAGE` optionally selects an image already present on the runner.
It disables automatic building and the per-run install. The full image must already contain the workspace dependencies; the job only links them offline. A missing override image is an error.
Transfer a `docker save` archive and run `docker load < juno-remote.tar`, or pull
an image from a registry. For a legacy full image in Namespace's private registry, install `nsc` on the
laptop, run `nsc login` and `nsc docker login` interactively, then run:

```sh
docker pull nscr.io/<workspace>/juno-remote:<tag>
docker run --rm nscr.io/<workspace>/juno-remote:<tag> node --version
```

Keep registry credentials out of the repository and logs. On the Mac, select it
with `JUNO_RUNNER_IMAGE=nscr.io/<workspace>/juno-remote:<tag>`.

## Setup prompt for the laptop

Copy everything in the following block into a coding agent on the Windows laptop.
It does not need this repository.

```text
Set up this Windows gaming laptop as an optional Linux Docker runner reachable
from my Mac through Tailscale. Do the setup and verify it. You have no access to
the Juno repository. Do not clone it or request Slack credentials.

My Mac public SSH key is:
<MAC_PUBLIC_KEY>

My optional prebuilt runner image is:
<NSCR_IMAGE_REFERENCE_OR_LEAVE_PENDING>

1. Inspect Windows, WSL, existing Docker/Tailscale installations, available RAM
   and CPU. Preserve existing distributions and configuration. Use WSL2 with
   Ubuntu-24.04. From elevated PowerShell run wsl --update and, if needed,
   wsl --install -d Ubuntu-24.04. Set that distribution to WSL version 2.
   Complete its ordinary Linux user setup. Merge [boot] systemd=true into
   /etc/wsl.conf. Restart WSL when safe and verify systemd is PID 1. A reboot or
   interactive login may need my help; say exactly what is required.
2. Install Docker Engine inside Ubuntu using Docker's official Ubuntu apt
   repository, not Docker Desktop. Resolve conflicts with an existing Docker
   installation without deleting its data. Install docker-ce, docker-ce-cli,
   containerd.io and docker-buildx-plugin. Enable docker.service. Add the Linux
   runner user to the docker group and verify docker info after a new login.
   Install util-linux and coreutils for flock and timeout. Verify cgroup v2.
3. Install openssh-server. Add the public key above exactly once to the Linux
   runner user's ~/.ssh/authorized_keys, mode 600 in a mode 700 directory.
   If the placeholder is unfilled, ask me for the PUBLIC key. Never request
   the Mac private key. Configure port 2222, public-key authentication,
   PasswordAuthentication no, KbdInteractiveAuthentication no and
   PermitRootLogin no. Validate with sshd -t. Ubuntu 24.04 can use socket
   activation: disable ssh.socket and enable/restart ssh.service so port 2222
   takes effect. Confirm ss -ltn shows 2222. Do not change Windows' SSH server.
4. Install Linux Tailscale from its official repository or official install
   script. Enable tailscaled and run tailscale up --hostname=juno-runner.
   Let me complete browser authentication. Give WSL its own Tailscale address.
   If Windows also runs Tailscale, follow the current official Windows/WSL2
   coexistence instructions. Do not add public router port forwarding or
   disable the firewall. Permit the Mac's tailnet identity to reach TCP 2222.
5. Choose an initial host capacity no higher than the Linux CPU count and
   available memory support, preferably 8 cores with at least 16 GB available
   to WSL. Put one positive integer in the runner user's
   ~/.config/juno-runner/cores. Explain the choice. The Juno client manages
   jobs in ~/.cache/juno-runner with flock, per-job leases and Docker CPU
   limits. Do not install an unrelated CI service or clone any repository.
6. In elevated PowerShell disable sleep and hibernate on AC with
   powercfg /change standby-timeout-ac 0 and
   powercfg /change hibernate-timeout-ac 0.
   Set the plugged-in lid-close action to Do nothing with
   powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
   and powercfg /setactive SCHEME_CURRENT. Keep battery settings unchanged.
7. Create a Windows Scheduled Task named "Juno WSL runner", at login for the
   Windows user owning Ubuntu-24.04. It must run
   wsl.exe -d Ubuntu-24.04 --exec /bin/sleep infinity
   with no execution time limit. Start it now. Systemd services alone do not
   keep WSL running. Verify Docker, SSH and tailscaled recover after a WSL
   restart and another Windows login. Do not reboot without telling me.
8. If the image reference is supplied, preload it using docker pull. For the
   private nscr.io registry, install Namespace's nsc CLI and let me log in
   interactively with nsc login and nsc docker login. Never print or request
   tokens. A docker save archive loaded with docker load is also supported.
   If no image reference is supplied, skip preload. The Mac streams the build
   context and Docker builds the image on first use without nsc.
9. Write ~/juno-runner-check.sh, executable, with this check:
   #!/usr/bin/env bash
   set -eu
   echo 'Juno runner check'
   uname -sm
   printf 'user='; id -un
   printf 'init='; ps -p 1 -o comm=
   printf 'cores='; getconf _NPROCESSORS_ONLN
   printf 'capacity='; cat "$HOME/.config/juno-runner/cores"
   free -h
   systemctl is-active docker ssh tailscaled
   docker info --format 'docker={{.ServerVersion}} cgroup={{.CgroupVersion}}'
   tailscale ip -4
   ss -ltn '( sport = :2222 )'
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E 'juno-(remote|toolchain)' || true
   Run it as the runner user, through a fresh login so the Docker group applies.
   Give me this PowerShell command to rerun and paste its output back:
   wsl -d Ubuntu-24.04 -u <linux-user> --exec bash -lc '~/juno-runner-check.sh'
   Also print the Scheduled Task status and powercfg AC settings, without secrets.
10. End with the Linux username, Tailscale IP/name, SSH port 2222, host-key
    fingerprint and chosen capacity. Give these Mac config values for
    ~/.config/juno/runner.json:
    { "host": "<user>@<tailscale-ip>", "port": 2222,
      "key": "~/.ssh/juno_runner" }. Include JUNO_RUNNER_IMAGE only if a
    prebuilt image was explicitly requested.
    The Mac agent will run pnpm runner:check after I paste your check output.
    Do not claim Mac connectivity or an unperformed reboot test passed.
```
