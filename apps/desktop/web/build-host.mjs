import { build } from 'bun'
import { copyFile, mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

// `bun web/build-host.mjs [folder]`: the host into <folder>/host, default dist (the browser lane); the DOM lane uses dom/dist.
const out = join(process.argv[2] ?? 'dist', 'host')

const result = await build({ entrypoints: ['web/host/testHost.ts'], target: 'node', format: 'esm', splitting: true, outdir: out, naming: { entry: '[name].mjs', chunk: '[name]-[hash].mjs' } })
if (!result.success) throw new AggregateError(result.logs, 'Browser host build failed')
const worker = await build({ entrypoints: ['../../packages/agent/src/runtime/codemode-worker.ts'], target: 'node', format: 'esm', outdir: out, naming: 'codemode-worker.mjs' })
if (!worker.success) throw new AggregateError(worker.logs, 'Codemode worker build failed')
const fromCodemode = createRequire(realpathSync(resolve('../../packages/agent/node_modules/@earendil-works/pi-codemode/package.json')))
await mkdir(out, { recursive: true })
await copyFile(fromCodemode.resolve('quickjs-wasi/quickjs.wasm'), join(out, 'quickjs.wasm'))
