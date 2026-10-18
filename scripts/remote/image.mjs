import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Only values used to build the toolchain belong in its tag and build context.
function toolchainVersions(directory = root) {
  return { quint: JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).devDependencies['@informalsystems/quint'] }
}

export function imageTag(directory = root) {
  return createHash('sha256').update(readFileSync(join(directory, 'scripts/remote/Dockerfile'))).update(JSON.stringify(toolchainVersions(directory))).digest('hex').slice(0, 16)
}

export const quote = (value) => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)
export const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

/** Runs nsc and returns its stdout; throws with its stderr on failure. A hung call ends after `timeout` ms (ETIMEDOUT). */
export function nsc(args, { timeout = 120_000 } = {}) {
  const result = spawnSync('nsc', args, { encoding: 'utf8', timeout })
  if (result.error?.code === 'ETIMEDOUT') throw new Error(`nsc ${args[0]} failed: spawnSync nsc ETIMEDOUT after ${timeout / 1000} s`)
  if (result.error) throw new Error(`nsc is not installed or not on PATH: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`nsc ${args[0]} failed:\n${result.stderr.trim()}`)
  return result.stdout
}

/** About one dial in four to Namespace's gateway times out from the office network; retry calls that are safe to repeat. */
export async function retry(what, attempt) {
  for (let tries = 1; ; tries++) {
    try {
      return attempt()
    } catch (error) {
      if (tries === 6) throw error
      console.error(`remote: ${what} failed, retrying (${error.message.split('\n').find((line) => line.startsWith('Failed')) ?? error.message.split('\n')[0]})`)
      await sleep(1000 * tries)
    }
  }
}

/** Both backends build the same toolchain without sending a workspace. */
export function imageContext() {
  const context = mkdtempSync(join(existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork' : tmpdir(), 'juno-remote-image-'))
  writeFileSync(join(context, 'toolchain.json'), JSON.stringify(toolchainVersions()))
  writeFileSync(join(context, 'Dockerfile'), readFileSync(join(root, 'scripts/remote/Dockerfile')))
  return context
}

/** Builds and pushes the image unless the registry has it. One build at a time per Mac. */
export async function ensureImage(registry, tag, log = console.error) {
  const image = `${registry}/juno-toolchain:${tag}`
  // A tag once seen in the registry stays there; remember it to skip the lookup.
  const seen = join(tmpdir(), 'juno-remote-pool', `toolchain-${tag}`)
  if (existsSync(seen)) return image
  const present = async () => (await retry('listing the registry', () => nsc(['registry', 'list', 'juno-toolchain', '-o', 'json']))).includes(tag)
  if (await present()) {
    writeFileSync(seen, image)
    return image
  }
  const lock = join(tmpdir(), 'juno-remote-image.lock')
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch {
      console.error('remote: another worktree is building the image, waiting')
      await sleep(10000)
      if (await present()) return image
    }
  }
  try {
    const context = imageContext()
    const started = Date.now()
    log(`remote: building ${image} (the toolchain changed; a few minutes, once)`)
    const built = spawnSync('nsc', ['build', context, '--name', image, '--push', '--platform', 'linux/amd64'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    rmSync(context, { recursive: true, force: true })
    if (built.status !== 0) throw new Error('nsc build failed')
    log(`remote: toolchain image built in ${((Date.now() - started) / 1000).toFixed(1)} s`)
    writeFileSync(seen, image)
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
  return image
}

