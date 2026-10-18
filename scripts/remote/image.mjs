import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** The image is named by what goes into it: the Dockerfile, the lockfile and the workspace file. */
const imageInputs = ['scripts/remote/Dockerfile', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
export function imageTag() {
  const hash = createHash('sha256')
  for (const file of imageInputs) hash.update(file).update('\0').update(readFileSync(join(root, file)))
  return hash.digest('hex').slice(0, 16)
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

/** The same small build context is used by Docker on either backend. */
export function imageContext() {
  const context = mkdtempSync(join(existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork' : tmpdir(), 'juno-remote-image-'))
  const manifests = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*package.json'], { cwd: root, encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean)
  for (const file of [...imageInputs.slice(1), ...manifests, '.npmrc'].filter((name) => existsSync(join(root, name)))) {
    mkdirSync(dirname(join(context, file)), { recursive: true })
    writeFileSync(join(context, file), readFileSync(join(root, file)))
  }
  writeFileSync(join(context, 'Dockerfile'), readFileSync(join(root, 'scripts/remote/Dockerfile')))
  return context
}

/** Builds and pushes the image unless the registry has it. One build at a time per Mac. */
export async function ensureImage(registry, tag) {
  const image = `${registry}/juno-remote:${tag}`
  // A tag once seen in the registry stays there; remember it to skip the lookup.
  const seen = join(tmpdir(), 'juno-remote-pool', `image-${tag}`)
  if (existsSync(seen)) return image
  const present = async () => (await retry('listing the registry', () => nsc(['registry', 'list', 'juno-remote', '-o', 'json']))).includes(tag)
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
    console.error(`remote: building ${image} (the lockfile or Dockerfile changed; a few minutes, once)`)
    const built = spawnSync('nsc', ['build', context, '--name', image, '--push', '--platform', 'linux/amd64'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    rmSync(context, { recursive: true, force: true })
    if (built.status !== 0) throw new Error('nsc build failed')
    writeFileSync(seen, image)
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
  return image
}

