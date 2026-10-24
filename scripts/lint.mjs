// bun run lint: runs the independent checks at once and prints each one's output
// as one group when it finishes. Fails if any check fails, and names them.
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bun = (script, ...args) => [process.execPath, [`scripts/${script}`, ...args]]
const checks = [
  // Reads .oxlintrc.json. --no-script, or it would run this package's lint script.
  ['bun lint', [process.execPath, ['lint', '--no-script', '--deny-warnings', '.']]],
  ['decision log', bun('decision-log.mjs', '--check')],
  ['cache epoch', bun('check-cache-epoch.mjs')],
  ['migration order', bun('check-migration-order.mjs')],
  ['cursor rule', bun('check-no-pointer-cursor.mjs')],
  ['duotone icons', bun('check-duotone.mjs')],
  ['tokens', bun('check-tokens.mjs')],
  ['dependencies', bun('check-deps.mjs')],
  ['fixtures redacted', bun('check-fixtures-redacted.mjs')],
  ['lfs', bun('check-lfs.mjs')],
  ['health', bun('health.mjs', '--check')],
]

const started = performance.now()
const env = { ...process.env, ...(process.stdout.isTTY ? { FORCE_COLOR: '1' } : {}) }
const results = await Promise.all(checks.map(([name, [command, args]]) => new Promise((done) => {
  const at = performance.now()
  const output = []
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => output.push(chunk))
  child.stderr.on('data', (chunk) => output.push(chunk))
  let settled = false
  const finish = (code, error) => {
    if (settled) return
    settled = true
    const seconds = ((performance.now() - at) / 1000).toFixed(1)
    const text = Buffer.concat(output).toString().trimEnd()
    process.stdout.write(`── ${name} ${code === 0 ? 'passed' : 'failed'} in ${seconds} s\n${text ? `${text}\n` : ''}${error ? `${error.message}\n` : ''}`)
    done({ name, ok: code === 0 })
  }
  child.on('error', (error) => finish(1, error))
  child.on('close', (code, signal) => finish(code ?? (signal ? 1 : 0)))
})))

const failed = results.filter((result) => !result.ok).map((result) => result.name)
const seconds = ((performance.now() - started) / 1000).toFixed(1)
if (failed.length) {
  console.error(`lint: ${failed.length} of ${checks.length} checks failed in ${seconds} s: ${failed.join(', ')}`)
  process.exitCode = 1
} else console.log(`lint: ${checks.length} checks passed in ${seconds} s`)
