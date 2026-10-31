// Runs on Node: Bun's node:sqlite on macOS cannot open the store (docs/development.md, "Runtimes").
/**
 * `node apps/desktop/web/demo/export/cli.ts <outDir>`: writes the demo
 * snapshot into `<outDir>/demo/` (`export.ts`). `scripts/demo-build.mjs`
 * runs it before the demo's Vite build.
 */
import { execFileSync } from 'node:child_process'
import { exportDemo } from './export'

const outDir = process.argv[2]
if (outDir === undefined) throw new Error('usage: cli.ts <outDir>')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const started = performance.now()
const result = await exportDemo(outDir, commit)
console.log(`demo export: ${Object.keys(result.snapshot.lists).length} lists, ${Object.keys(result.snapshot.values).length} values, ${Object.keys(result.snapshot.replies).length} replies, ${result.files} files, ${(result.bytes / 1024).toFixed(1)} KB in ${Math.round(performance.now() - started)} ms`)
