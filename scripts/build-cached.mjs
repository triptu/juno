// Runs a build only when its inputs changed since the last successful build.
//
//   node ../../scripts/build-cached.mjs <output dir> <command> [args...]
//
// Run from an app directory. The inputs are every file git sees (tracked or
// new, not ignored) in the app, in packages/ and the lockfile, plus the
// environment variables that change the output. Their hash is written to
// <output dir>/.inputs-hash after the build succeeds, with the size and
// modification time of every output file, so a build by another command
// (`pnpm dev` writes out/main) is noticed. When both match, the build is
// skipped. JUNO_REBUILD=1 always builds.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const [outDir, ...command] = process.argv.slice(2)
if (!outDir || command.length === 0) {
  console.error('usage: node scripts/build-cached.mjs <output dir> <command> [args...]')
  process.exit(2)
}

const app = process.cwd()
const root = resolve(app, '../..')
const files = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', relative(root, app), 'packages', 'pnpm-lock.yaml'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
// A copy without git (pnpm remote) has no earlier build to reuse: build.
if (files.status !== 0) {
  const built = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
  process.exit(built.status ?? 1)
}

const hash = createHash('sha256')
hash.update(command.join(' '))
for (const name of ['JUNO_UNMINIFIED', 'NODE_ENV']) hash.update(`\0${name}=${process.env[name] ?? ''}`)
for (const file of files.stdout.split('\0').filter(Boolean).toSorted()) {
  const path = join(root, file)
  // A deleted file that git still tracks counts as absent.
  hash.update(`\0${file}\0`).update(existsSync(path) ? readFileSync(path) : 'deleted')
}
const digest = hash.digest('hex')
const stamp = join(app, outDir, '.inputs-hash')
const outputs = () => {
  const list = readdirSync(join(app, outDir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== '.inputs-hash')
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      const { size, mtimeMs } = statSync(path)
      return `${relative(app, path)} ${size} ${mtimeMs}`
    })
  return createHash('sha256').update(list.toSorted().join('\n')).digest('hex')
}

if (process.env.JUNO_REBUILD !== '1' && existsSync(stamp) && readFileSync(stamp, 'utf8') === `${digest} ${outputs()}`) {
  console.log(`build-cached: ${outDir}/ is up to date, skipping \`${command.join(' ')}\` (JUNO_REBUILD=1 forces a build)`)
  process.exit(0)
}

const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
if (result.status !== 0) process.exit(result.status ?? 1)
writeFileSync(stamp, `${digest} ${outputs()}`)
