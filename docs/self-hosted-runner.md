# Set up an optional SSH runner

Namespace remains the default. Set `JUNO_RUNNER_HOST` on the Mac to try a Linux
runner first. An unreachable host falls back to Namespace. A reachable host with
broken Docker, a missing image, or failing tests returns an error without fallback.
Set `JUNO_REMOTE_MAX_VCPU=0` to forbid Namespace allocation, including image builds.

Use an amd64 host with enough RAM for the configured jobs. An 8-core limit with
16 GB available to Linux is a reasonable starting point. The host's
`~/.config/juno-runner/cores` file is the total capacity across all clients.
Jobs reserve the cores in their requested machine shape, wait when full, and
release their reservation after Docker stops. Each job has its own container
and output directory. A host lock protects reservations. Jobs stop after 3 hours.

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

## Preload the image

The runner uses the same `scripts/remote/Dockerfile` image as Namespace, already
built in the workspace registry. On the Mac, `pnpm remote --dry-run test` prints
the current image tag. Set `JUNO_RUNNER_IMAGE` to that exact registry image.
On the laptop, install `nsc`, run `nsc login` and `nsc docker login` interactively,
then run:

```sh
docker pull nscr.io/<workspace>/juno-remote:<tag>
docker run --rm nscr.io/<workspace>/juno-remote:<tag> node --version
```

Alternatively, transfer a `docker save` archive of that image and run
`docker load < juno-remote.tar`. Keep registry credentials out of the repo and
logs. Preload a new tag whenever the Dockerfile, lockfile or workspace file changes.
The optional backend does not start a Namespace builder to repair a missing image.

On the Mac, configure:

```sh
export JUNO_RUNNER_HOST='<linux-user>@<tailscale-host-or-ip>'
export JUNO_RUNNER_PORT=2222
export JUNO_RUNNER_KEY="$HOME/.ssh/juno_runner"
export JUNO_RUNNER_IMAGE='nscr.io/<workspace>/juno-remote:<tag>'
pnpm runner:check
pnpm remote test:agent-contracts
```

`runner:check` verifies Linux amd64, Docker access, the host capacity and the
preloaded image. Run a small suite before larger runs. Logs and reports use
`.remote/<run>/` for either backend. Unset `JUNO_RUNNER_HOST` to use Namespace.

## Setup prompt for the laptop

Copy everything in the following block into a coding agent on the Windows laptop.
It does not need this repository.

```text
Set up this Windows gaming laptop as an optional Linux Docker runner reachable
from my Mac through Tailscale. Do the setup and verify it. You have no access to
the Juno repository. Do not clone it or request Slack credentials.

My Mac public SSH key is:
<MAC_PUBLIC_KEY>

My prebuilt runner image is:
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
   If the image reference is pending, mark image preload pending; finish all
   host checks and report the exact next command with a placeholder.
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
   docker image ls --format '{{.Repository}}:{{.Tag}}' | grep 'juno-remote' || true
   Run it as the runner user, through a fresh login so the Docker group applies.
   Give me this PowerShell command to rerun and paste its output back:
   wsl -d Ubuntu-24.04 -u <linux-user> --exec bash -lc '~/juno-runner-check.sh'
   Also print the Scheduled Task status and powercfg AC settings, without secrets.
10. End with the Linux username, Tailscale IP/name, SSH port 2222, host-key
    fingerprint and chosen capacity. Give these Mac environment settings:
    JUNO_RUNNER_HOST=<user>@<tailscale-ip>, JUNO_RUNNER_PORT=2222,
    JUNO_RUNNER_KEY=<path-to-Mac-private-key>, JUNO_RUNNER_IMAGE=<image>.
    The Mac agent will run pnpm runner:check after I paste your check output.
    Do not claim Mac connectivity or an unperformed reboot test passed.
```
