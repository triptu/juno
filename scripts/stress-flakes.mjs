// Run inside scripts/heavy.mjs so every repetition shares the machine lock.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [label, roundsArg, command, ...args] = process.argv.slice(2)
const rounds = Number(roundsArg)
if (process.env.JUNO_HEAVY_HELD !== '1' || !label || !/^[a-z0-9-]+$/.test(label) || !Number.isInteger(rounds) || rounds < 1 || !command) {
  console.error('usage: node scripts/heavy.mjs node scripts/stress-flakes.mjs <label> <rounds> <command> [args...]')
  process.exit(2)
}
const directory = join('.juno-status', 'flake-check', label)
mkdirSync(directory, { recursive: true })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const burners = Array.from({ length: 8 }, () => spawn(process.execPath, ['-e', 'while (true) { Math.sqrt(Math.random()) }'], { stdio: 'ignore', env }))
const cleanup = () => { for (const burner of burners) burner.kill() }
process.on('exit', cleanup)
process.on('SIGTERM', () => { cleanup(); process.exit(143) })
process.on('SIGINT', () => { cleanup(); process.exit(130) })
let failures = 0
try {
  for (let round = 1; round <= rounds; round++) {
    const run = spawnSync(command, args, { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
    writeFileSync(join(directory, `${round}.log`), output)
    if (run.status !== 0) failures += 1
    console.log(`${label} ${round}/${rounds}: ${run.status === 0 ? 'PASS' : 'FAIL'}`)
    if (run.status !== 0) console.log(output.slice(-7000))
  }
} finally {
  cleanup()
}
console.log(`${label}: ${rounds - failures}/${rounds} passed with eight CPU burners; logs: ${directory}`)
process.exitCode = failures ? 1 : 0
