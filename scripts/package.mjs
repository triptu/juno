import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { recordReleaseTiming } from './release-timings.mjs'

const root = resolve(import.meta.dirname, '..')
const started = Date.now()
// A release compiles every file with the React Compiler, without its cache (apps/desktop/react-compiler.vite.ts).
const build = spawnSync('bun', ['run', 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, JUNO_REACT_COMPILER_CACHE: '0' } })
recordReleaseTiming('JS build', started, { status: build.status === 0 ? 'passed' : 'failed' })
if (build.status !== 0) process.exit(build.status ?? 1)
// electron-builder supports only Node.
const packaged = spawnSync('node', ['build/package.cjs'], { cwd: join(root, 'apps/desktop'), stdio: 'inherit' })
process.exit(packaged.status ?? 1)
