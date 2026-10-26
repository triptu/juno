import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { scratchFolder } from './worktree-folder.mjs'
import { recordReleaseTiming } from './release-timings.mjs'

const root = resolve(import.meta.dirname, '..')
const started = Date.now()
const build = spawnSync('bun', [join(root, 'scripts/build-cached.mjs'), 'out', 'bun', 'run', 'build'], {
  cwd: join(root, 'apps/desktop'), stdio: 'inherit',
  env: { ...process.env, JUNO_BUILD_CACHE_DIR: process.env.JUNO_BUILD_CACHE_DIR ?? join(scratchFolder(), 'juno-build-cache') },
})
recordReleaseTiming('JS build', started, { status: build.status === 0 ? 'passed' : 'failed' })
if (build.status !== 0) process.exit(build.status ?? 1)
// electron-builder supports only Node.
const packaged = spawnSync('node', ['build/package.cjs'], { cwd: join(root, 'apps/desktop'), stdio: 'inherit' })
process.exit(packaged.status ?? 1)
