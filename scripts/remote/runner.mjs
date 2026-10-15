import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

export function runnerConfig(env = process.env) {
  if (!env.JUNO_RUNNER_HOST) return undefined
  const host = env.JUNO_RUNNER_HOST
  if (!/^[a-zA-Z0-9_.@:-]+$/.test(host) || host.startsWith('-')) throw new Error('JUNO_RUNNER_HOST must be an SSH host or user@host')
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']
  if (env.JUNO_RUNNER_KEY) args.push('-i', env.JUNO_RUNNER_KEY, '-o', 'IdentitiesOnly=yes')
  if (env.JUNO_RUNNER_PORT) {
    if (!/^\d+$/.test(env.JUNO_RUNNER_PORT) || Number(env.JUNO_RUNNER_PORT) < 1 || Number(env.JUNO_RUNNER_PORT) > 65535) throw new Error('JUNO_RUNNER_PORT must be 1 to 65535')
    args.push('-p', env.JUNO_RUNNER_PORT)
  }
  if (env.JUNO_RUNNER_IMAGE && !/^[\w.:/@-]+$/.test(env.JUNO_RUNNER_IMAGE)) throw new Error('JUNO_RUNNER_IMAGE must be a Docker image reference')
  return { host, args: [...args, host], image: env.JUNO_RUNNER_IMAGE }
}

// Only an SSH transport failure permits Namespace fallback. A reachable host
// with a broken Docker/configuration must fail instead of silently spending.
export function checkRunner(config) {
  const command = `echo __juno_runner_connected; set -eu; test "$(uname -sm)" = 'Linux x86_64'; command -v flock >/dev/null; command -v timeout >/dev/null; docker info >/dev/null; cores=$(cat "$HOME/.config/juno-runner/cores"); test "$cores" -gt 0; test "$cores" -le "$(getconf _NPROCESSORS_ONLN)"; printf 'juno-runner-ready %s\\n' "$cores"`
  const result = spawnSync('ssh', [...config.args, command], { encoding: 'utf8', timeout: 15_000 })
  if ((result.status === 255 || result.error?.code === 'ETIMEDOUT') && !result.stdout?.includes('__juno_runner_connected')) return { reachable: false, reason: result.stderr?.trim() || result.error?.message }
  if (result.error || result.status !== 0) throw new Error(`runner health check failed: ${result.error?.message ?? result.stderr.trim()}`)
  const cores = Number(/^juno-runner-ready (\d+)$/m.exec(result.stdout)?.[1])
  if (!Number.isSafeInteger(cores) || cores < 1) throw new Error('runner returned no valid core capacity')
  return { reachable: true, cores }
}

export function runnerCommand(cores, runId, command) {
  const script = readFileSync(new URL('./runner-host.sh', import.meta.url), 'utf8')
  return `bash -c ${quote(script)} -- ${cores} ${quote(runId)} ${quote(command)}`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = runnerConfig()
  if (!config) throw new Error('Set JUNO_RUNNER_HOST and JUNO_RUNNER_KEY; see docs/self-hosted-runner.md')
  const health = checkRunner(config)
  if (!health.reachable) throw new Error(`runner unreachable: ${health.reason}`)
  console.log(`runner: ${config.host} ready, ${health.cores} cores`)
  if (!config.image) throw new Error('Set JUNO_RUNNER_IMAGE to the preloaded Juno image')
  const image = spawnSync('ssh', [...config.args, `docker image inspect ${quote(config.image)} --format '{{.Id}}'`], { encoding: 'utf8', timeout: 15_000 })
  if (image.status !== 0) throw new Error(`runner image unavailable: ${image.stderr.trim()}`)
  console.log(`runner: image ${config.image} ready (${image.stdout.trim()})`)
}
