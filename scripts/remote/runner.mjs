import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { imageContext, imageTag } from './image.mjs'
import { parsePlan } from '../plan.mjs'

export const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
export const localHint = 'wait for the runner; --local runs the steps on this Mac, which hangs under heavy runs, so use it only when Tushar asks'

/** Juno sizes work in physical cores; quota hosts use the same counts as CPUs. */
export function runnerJobSize({ script, args, cores, specsCached = false }, capacity) {
  const steps = script === 'test:plan' ? parsePlan(args) : [{ script, args, env: {} }]
  // The tool tests run one bun test file at a time: about one thread.
  const toolTests = ['test:health', 'test:repo-tools', 'test:runner']
  const unitOnly = steps.every((step) => step.script === 'test' || step.script === 'test:dom' || step.script.startsWith('test:agent') || step.script === 'specs:check' || step.script === 'specs:conformance' || toolTests.includes(step.script))
  const files = (step) => step.args.filter((arg) => !arg.startsWith('-') && /\.[cm]?[jt]sx?$/.test(arg))
  const wide = steps.some((step) => {
    if (step.script === 'specs:conformance') return true
    if (step.script === 'specs:check') return !specsCached || step.env.SPECS_CACHE === 'off' || step.env.SPECS_RUN_CACHE === 'off' || step.args.includes('--no-cache')
    // A DOM test boots an engine host beside its renderer: more than a few want a second core.
    if (step.script === 'test:dom') return files(step).length === 0 || files(step).length > 4
    if (step.script !== 'test') return false
    return files(step).length === 0 || files(step).length > 20
  })
  const requested = steps.some((step) => !['test:desktop', 'test:browser', 'test:electron', 'test:e2e', 'test:gallery', 'test', 'test:dom', 'specs:check', 'specs:conformance', ...toolTests].includes(step.script) && !step.script.startsWith('test:agent')) ? 4
    : unitOnly ? wide ? 2 : 1 : 2
  const reserved = cores ?? Math.min(requested, capacity)
  if (!Number.isSafeInteger(reserved) || reserved < 1 || reserved > capacity) throw new Error(`job needs ${reserved} cores; runner lends ${capacity}`)
  return { reserved, wideUnit: unitOnly && wide }
}

export function hostCommand(sub, args = [], env = process.env) {
  const home = env.TSTACK_HOME || join(homedir(), 'Documents/code/tstack')
  let script
  try { script = readFileSync(join(home, 'scripts/runner/host.sh'), 'utf8') } catch {
    throw new Error(`Cannot read tstack's scripts/runner/host.sh in ${home}. Install tstack with /tstack:setup, or set TSTACK_HOME.`)
  }
  return `sh -c ${quote(script)} host.sh ${[sub, ...args].map(quote).join(' ')}`
}

export function runnerConfig(env = process.env) {
  const home = env.HOME ?? homedir()
  const path = join(home, '.config/juno/runner.json')
  let file = {}
  try { file = JSON.parse(readFileSync(path, 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read ${path}: ${error.message}`, { cause: error })
  }
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error(`${path} must contain an object`)
  const host = env.JUNO_RUNNER_HOST ?? file.host
  if (!host) throw new Error(`Configure ~/.config/juno/runner.json or JUNO_RUNNER_HOST; see docs/self-hosted-runner.md. ${localHint}.`)
  if (typeof host !== 'string' || !/^[a-zA-Z0-9_.@:-]+$/.test(host) || host.startsWith('-')) throw new Error('JUNO_RUNNER_HOST must be an SSH host or user@host')
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']
  if (/\.local\.?$/i.test(host)) args.unshift('-4')
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
  return { host, args: [...args, host], image: env.JUNO_RUNNER_IMAGE || `juno-toolchain:${imageTag()}`, build: !env.JUNO_RUNNER_IMAGE }
}

export function checkRunner(config) {
  const command = `echo __juno_runner_connected; ${hostCommand('check', [config.image])}`
  const candidates = config.args[0] === '-4' ? [config.args, config.args.slice(1)] : [config.args]
  let reason
  for (const args of candidates) {
    const result = spawnSync('ssh', [...args, command], { encoding: 'utf8', timeout: 60_000 })
    if (result.status === 255 && /Permission denied|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|bad permissions|Load key|no such identity|no matching (host key|key exchange)/i.test(result.stderr ?? '')) throw new Error(`runner SSH configuration failed: ${result.stderr.trim()}`)
    if ((result.status === 255 || result.error?.code === 'ETIMEDOUT') && !result.stdout?.includes('__juno_runner_connected')) {
      reason = result.stderr?.trim() || result.error?.message
      continue
    }
    const facts = Object.fromEntries((result.stdout ?? '').split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
    if (result.error || result.status !== 0 || !facts.os?.startsWith('Linux ') || facts.arch !== 'x86_64' || !facts.docker || facts.docker.startsWith('error')) throw new Error(`runner health check failed: ${result.error?.message ?? (result.stderr.trim() || facts.docker || 'requires Linux x86_64 and Docker')}`)
    if (!config.build && facts.image?.startsWith('missing')) throw new Error(`runner override image unavailable: ${config.image}`)
    const ready = /^(\d+) (pinned|quota)\b/.exec(facts.capacity ?? '')
    if (!ready || Number(ready[1]) < 1) throw new Error(`runner health check failed: ${facts.capacity || 'no valid core capacity'}`)
    config.args = args
    return { reachable: true, cores: Number(ready[1]), pinned: ready[2] === 'pinned' }
  }
  return { reachable: false, reason }
}

/** The shared host owns the image lock too. Its build command accepts a tar context. */
export async function ensureRunnerImage(config, log = console.error) {
  if (!config.build) return config.image
  const context = imageContext()
  try {
    const tar = spawnSync('tar', ['-czf', '-', '--no-xattrs', '-C', context, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
    if (tar.status !== 0) throw new Error('could not pack the toolchain build context')
    log(`remote: checking or building ${config.image} through tstack`)
    const child = spawn('ssh', [...config.args, hostCommand('build', [config.image])], { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.on('error', () => {})
    child.stdin.end(tar.stdout)
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => log(chunk.toString().trimEnd()))
    const stop = () => child.kill('SIGTERM')
    process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('SIGHUP', stop)
    try {
      const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
      if (code !== 0) throw new Error(`runner image build failed (${code})`)
    } finally {
      process.off('SIGTERM', stop); process.off('SIGINT', stop); process.off('SIGHUP', stop)
    }
    return config.image
  } finally { rmSync(context, { recursive: true, force: true }) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = runnerConfig()
    const health = checkRunner(config)
    if (!health.reachable) throw new Error(`runner unreachable: ${health.reason}. ${localHint}.`)
    console.log(`runner: ready, ${health.cores} ${health.pinned ? 'physical cores' : 'CPUs'}; shared tstack allocator`)
    if (process.argv[2] === '--prune') throw new Error('Use /tstack:runner for shared host maintenance')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
