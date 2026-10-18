# Set up an optional SSH runner

Configure the runner on each Mac in `~/.config/juno/runner.json`. Every agent
then tries it before Namespace, without setting environment variables.
An unreachable host falls back to Namespace. A reachable host with broken
Docker, an SSH key error, an image-build failure, or failing tests returns an
error without fallback. A job waits up to 60 seconds for free cores before
falling back. Set `JUNO_REMOTE_MAX_VCPU=0` to forbid Namespace allocation and
wait for runner capacity without a deadline.

Use an amd64 host with enough RAM for the configured jobs. An 8-core limit with
16 GB available to Linux is a reasonable starting point. The host's
`~/.config/juno-runner/cores` file is the total capacity across all clients.
Use the same Linux account from every client. Unit-only jobs reserve 1 core
with a Docker CPU limit of 2: `test` (including named files), `test:agent*`,
`specs:check`, and plans containing only those scripts. Jobs containing
`test:gallery` but no `test:desktop` or `test:e2e` reserve 3 cores with a limit
of 3. Any desktop or e2e step, alone or in a plan, reserves 4 cores with a
limit of 4, including plans that also run the gallery. Other scripts keep the
8-core default. `--machine` or `JUNO_REMOTE_MACHINE` overrides both the
reservation and limit. Default reservations shrink to fit a smaller host;
explicit sizes fail if they exceed its capacity. Host admission counts reserved
cores, independently of the CPU limit. Namespace, including fallback, keeps
its 8x16 default and its existing pool.

Jobs release their reservation after Docker stops. Each job has its own container
and output directory. A host lock protects reservations. Jobs stop after 3 hours.

Workers use the CPU limit in `JUNO_RUNNER_JOB_CORES`, since `nproc` can see
all host threads despite Docker's CPU limit. A standalone `test` job reserves
1 core and uses two vitest workers and one package at a time under its 2-core
limit. A standalone 4-core app job uses two desktop workers. Gallery-only jobs
use three workers and shift parts at 3 cores, as they do at 4. Quint uses
one simulation per two cores and one Apalache checker per four, at least one
each. In a plan with several lanes, 4 cores give the app two desktop or three
gallery workers, the unit lane one worker in one package, and the spec lane
one simulation plus one checker. Step environment settings still win.

## Laptop measurements

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

The owner chose to lend 16 of the laptop's 24 threads in
`~/.config/juno-runner/cores`, leaving eight for the desktop. Admission allows
4 app plans, or 5 gallery jobs, or 16 unit jobs at once, or mixtures with
`4 * app + 3 * gallery + unit <= 16`. At the measured peaks, four app plans
use about 11.04 GiB, five gallery jobs 9.25 GiB, and sixteen unit jobs
19.36 GiB, below the roughly 24 GB job budget. The measured peaks remain
2.76 GiB per app plan, 1.85 GiB per gallery slice and 1.21 GiB per unit slice;
16 is the owner's choice, not a limit derived from these measurements. These
are sequential slices, not concurrent full-suite throughput. Recheck memory
on larger plans before raising the limit.

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
Choose a capacity no greater than `getconf _NPROCESSORS_ONLN`, with RAM for that
many cores. Log out and back in to apply Docker group membership.

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
