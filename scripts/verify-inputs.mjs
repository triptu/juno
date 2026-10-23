import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const json = (root, file) => existsSync(join(root, file)) ? JSON.parse(readFileSync(join(root, file), 'utf8')) : {}

/** Expected remote identity comes from the image pins; actual jobs report theirs. */
export function runtimeIdentity(root, remote = false) {
  const manifest = json(root, 'package.json')
  const desktop = json(root, 'apps/desktop/package.json')
  const bun = remote ? manifest.packageManager?.replace(/^bun@/, '') : process.versions.bun ?? spawnSync('bun', ['--version'], { encoding: 'utf8' }).stdout?.trim()
  const runtime = remote ? /\bnode\b/.test(manifest.scripts?.['test:plan'] ?? '') ? 'node' : 'bun' : process.versions.bun ? 'bun' : 'node'
  const docker = join(root, 'scripts/remote/Dockerfile')
  const node = remote ? (existsSync(docker) ? /ARG NODE_VERSION=(\S+)/.exec(readFileSync(docker, 'utf8'))?.[1] : undefined) : process.versions.node
  return { runtime, version: runtime === 'bun' ? bun : node, bun, platform: remote ? 'linux' : process.platform, arch: remote ? 'x64' : process.arch, electron: desktop.devDependencies?.electron ?? desktop.dependencies?.electron ?? null }
}

export const sameIdentity = (left, right) => left !== undefined && right !== undefined && JSON.stringify(left) === JSON.stringify(right)

export function inputKey(root, files, identity) {
  const hash = createHash('sha256').update(JSON.stringify(identity))
  for (const file of [...new Set(files)].toSorted()) {
    hash.update(`\0${file}\0`)
    hash.update(existsSync(join(root, file)) ? readFileSync(join(root, file)) : 'absent')
  }
  return hash.digest('hex')
}

export const sharedInputs = ['bun.lock', 'bunfig.toml', 'package.json', 'tsconfig.base.json', 'scripts/verify-inputs.mjs']
export const quintInput = (file) => /^specs\/(?!traces\/).*\.(qnt|mjs)$/.test(file) && file !== 'specs/conformance.mjs'
export const outboxInput = (file) => /^packages\/engine\/(src\/(outbox\.ts|send\/)|test\/conformance\/|(?:vitest|bun)\.conformance\.)/.test(file)
  || /^specs\/(outbox[^/]*\.(qnt|mjs)|conformance\.mjs)$/.test(file)

/** Inputs are shared by the affected selector and the full-run reuse gate. */
export function protocolInputs(files, closure = () => []) {
  const outbox = files.filter(outboxInput)
  const sources = outbox.filter((file) => file.startsWith('packages/engine/src/'))
  return {
    'specs:check': [...sharedInputs, ...files.filter(quintInput)],
    'specs:conformance': [...sharedInputs, ...outbox, ...sources.flatMap((file) => [...closure(file)])],
  }
}

/** Git blob IDs avoid reading a different checkout when planning a target ref. */
export function committedInputKey(root, commit, inputs, identity) {
  const result = spawnSync('git', ['ls-tree', '-r', commit], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr)
  const blobs = new Map(result.stdout.trim().split('\n').map((line) => { const [entry, path] = line.split('\t'); return [path, entry.split(' ').at(-1)] }))
  return createHash('sha256').update(JSON.stringify(identity)).update(JSON.stringify([...new Set(inputs)].toSorted().map((file) => [file, blobs.get(file) ?? 'absent']))).digest('hex')
}
