import { build } from 'bun'
import { copyFile, mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const result = await build({ entrypoints: ['web/host/testHost.ts'], target: 'node', format: 'esm', splitting: true, outdir: 'dist/host', naming: '[name].mjs', sourcemap: process.env.JUNO_COVERAGE === '1' ? 'external' : 'none' })
if (!result.success) throw new AggregateError(result.logs, 'Browser host build failed')
const worker = await build({ entrypoints: ['../../packages/agent/src/runtime/codemode-worker.ts'], target: 'node', format: 'esm', outdir: 'dist/host', naming: 'codemode-worker.mjs' })
if (!worker.success) throw new AggregateError(worker.logs, 'Codemode worker build failed')
const fromCodemode = createRequire(realpathSync(resolve('../../packages/agent/node_modules/@earendil-works/pi-codemode/package.json')))
await mkdir('dist/host', { recursive: true })
await copyFile(fromCodemode.resolve('quickjs-wasi/quickjs.wasm'), 'dist/host/quickjs.wasm')
