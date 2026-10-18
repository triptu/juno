import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { imageContext, imageTag } from './image.mjs'
import { parsePlan } from '../plan.mjs'

export const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

/** SSH admission and CPU limits follow the workload; explicit sizes still win. */
export function runnerJobSize({ script, args, machine, explicitMachine }, capacity) {
  if (explicitMachine) {
    const cores = Number(/:(\d+)x/.exec(machine)?.[1])
    return { reserved: cores, cpus: cores }
  }
  const scripts = script === 'test:plan' ? parsePlan(args).map((step) => step.script) : [script]
  const unitOnly = scripts.every((name) => name === 'test' || name.startsWith('test:agent') || name === 'specs:check')
  const reserved = Math.min(scripts.some((name) => name === 'test:desktop' || name === 'test:e2e') ? 4 : scripts.includes('test:gallery') ? 3 : unitOnly ? 1 : 8, capacity)
  return { reserved, cpus: unitOnly ? 2 : reserved }
}

export function runnerConfig(env = process.env) {
  const home = env.HOME ?? homedir()
  const path = join(home, '.config/juno/runner.json')
  let file = {}
  try { file = JSON.parse(readFileSync(path, 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read ${path}: ${error.message}`)
  }
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error(`${path} must contain an object`)
  const host = env.JUNO_RUNNER_HOST ?? file.host
  if (!host) return undefined
  if (typeof host !== 'string' || !/^[a-zA-Z0-9_.@:-]+$/.test(host) || host.startsWith('-')) throw new Error('JUNO_RUNNER_HOST must be an SSH host or user@host')
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']
  const key = env.JUNO_RUNNER_KEY ?? file.key
  if (key) {
    if (typeof key !== 'string') throw new Error('JUNO_RUNNER_KEY must be a path')
    args.push('-i', key.startsWith('~/') ? join(home, key.slice(2)) : key, '-o', 'IdentitiesOnly=yes')
  }
  const port = env.JUNO_RUNNER_PORT ?? file.port
  if (port !== undefined) {
    if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('JUNO_RUNNER_PORT must be 1 to 65535')
    args.push('-p', String(port))
  }
  if (env.JUNO_RUNNER_IMAGE && !/^[\w.:/@-]+$/.test(env.JUNO_RUNNER_IMAGE)) throw new Error('JUNO_RUNNER_IMAGE must be a Docker image reference')
  return { host, args: [...args, host], image: env.JUNO_RUNNER_IMAGE || `juno-remote:${imageTag()}`, build: !env.JUNO_RUNNER_IMAGE }
}

// Health checks fall back only when the transport cannot reach the host.
// Authentication and host configuration faults fail the run.
export function checkRunner(config) {
  const command = `echo __juno_runner_connected; set -eu; test "$(uname -sm)" = 'Linux x86_64'; command -v flock >/dev/null; command -v timeout >/dev/null; docker info >/dev/null; cores=$(cat "$HOME/.config/juno-runner/cores"); test "$cores" -gt 0; test "$cores" -le "$(getconf _NPROCESSORS_ONLN)"; printf 'juno-runner-ready %s\\n' "$cores"`
  const result = spawnSync('ssh', [...config.args, command], { encoding: 'utf8', timeout: 15_000 })
  if (result.status === 255 && /Permission denied|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|bad permissions|Load key|no such identity|no matching (host key|key exchange)/i.test(result.stderr ?? '')) throw new Error(`runner SSH configuration failed: ${result.stderr.trim()}`)
  if ((result.status === 255 || result.error?.code === 'ETIMEDOUT') && !result.stdout?.includes('__juno_runner_connected')) return { reachable: false, reason: result.stderr?.trim() || result.error?.message }
  if (result.error || result.status !== 0) throw new Error(`runner health check failed: ${result.error?.message ?? result.stderr.trim()}`)
  const cores = Number(/^juno-runner-ready (\d+)$/m.exec(result.stdout)?.[1])
  if (!Number.isSafeInteger(cores) || cores < 1) throw new Error('runner returned no valid core capacity')
  return { reachable: true, cores }
}

export function runnerCommand(cores, runId, command, env = process.env) {
  const script = readFileSync(new URL('./runner-host.sh', import.meta.url), 'utf8')
  return `bash -c ${quote(script)} -- ${cores} ${quote(runId)} ${quote(command)} ${Number(env.JUNO_REMOTE_MAX_VCPU ?? 48) === 0 ? -1 : 60}`
}

// The host lock covers both the presence check and build, across every client.
const imageLock = 'mkdir -p "$HOME/.cache/juno-runner"; exec 9>"$HOME/.cache/juno-runner/image-build.lock"; flock -x 9'
export async function ensureRunnerImage(config, log = console.error) {
  if (!config.build) return config.image
  const present = spawnSync('ssh', [...config.args, `docker image inspect ${quote(config.image)} >/dev/null 2>&1`], { encoding: 'utf8', timeout: 15_000 })
  if (present.error || present.status === 255) throw new Error(`runner image check failed: ${present.error?.message ?? present.stderr.trim()}`)
  if (present.status === 0) return config.image
  const context = imageContext()
  const started = Date.now()
  log(`remote: building ${config.image} on SSH runner (or waiting for another build)`)
  try {
    const tar = spawn('tar', ['-czf', '-', '--no-xattrs', '-C', context, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    const ssh = spawn('ssh', [...config.args, `set -eu; ${imageLock}; if docker image inspect ${quote(config.image)} >/dev/null 2>&1; then cat >/dev/null; else docker build --progress=plain --platform linux/amd64 -t ${quote(config.image)} -; fi`], { stdio: ['pipe', 'pipe', 'pipe'] })
    let errors = ''
    const done = (child) => new Promise((resolvePromise, reject) => { child.on('error', reject); child.on('close', resolvePromise) })
    const tarDone = done(tar), sshDone = done(ssh)
    ssh.stdin.on('error', () => {})
    tar.stdout.pipe(ssh.stdin)
    tar.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-8000) })
    for (const stream of [ssh.stdout, ssh.stderr]) createInterface({ input: stream }).on('line', (line) => {
      errors = (errors + line + '\n').slice(-8000)
      if (/^#\d+ (\[|DONE|CACHED|ERROR|exporting to image)/.test(line)) log(`remote: build ${line}`)
    })
    // SSH can reject the context early; stop tar rather than leave a blocked writer.
    ssh.once('close', () => tar.kill())
    const [tarCode, sshCode] = await Promise.all([tarDone, sshDone])
    if (tarCode !== 0 || sshCode !== 0) throw new Error(`runner image build failed: ${errors.trim()}`)
    log(`remote: runner image built in ${((Date.now() - started) / 1000).toFixed(1)} s`)
    return config.image
  } finally { rmSync(context, { recursive: true, force: true }) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = runnerConfig()
  if (!config) throw new Error('Configure ~/.config/juno/runner.json or JUNO_RUNNER_HOST; see docs/self-hosted-runner.md')
  const health = checkRunner(config)
  if (!health.reachable) throw new Error(`runner unreachable: ${health.reason}`)
  console.log(`runner: ${config.host} ready, ${health.cores} cores`)
  if (process.argv[2] === '--prune') {
    // Keep the current image and all images used by containers. Never force removal.
    const command = `set -eu; ${imageLock}; images=$(docker image ls --format '{{.Repository}}:{{.Tag}}' juno-remote); for image in $images; do [ "$image" = ${quote(config.image)} ] || docker image rm "$image"; done; docker builder prune -f`
    const pruned = spawnSync('ssh', [...config.args, command], { stdio: 'inherit' })
    if (pruned.status !== 0) throw new Error('runner image prune failed')
  } else {
    const image = spawnSync('ssh', [...config.args, `set -e; docker info >/dev/null; if docker image inspect ${quote(config.image)} --format '{{.Id}}'; then echo __juno_image_present; else echo __juno_image_missing; fi`], { encoding: 'utf8', timeout: 15_000 })
    if (image.status !== 0) throw new Error(`runner image check failed: ${image.error?.message ?? image.stderr.trim()}`)
    if (image.stdout.includes('__juno_image_present')) console.log(`runner: image ${config.image} ready`)
    else if (image.stdout.includes('__juno_image_missing') && config.build) console.log(`runner: image ${config.image} missing; will be built on first use`)
    else throw new Error(`runner override image unavailable: ${config.image}`)
  }
}
