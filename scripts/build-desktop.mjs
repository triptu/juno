// Builds apps/desktop/out/ as two electron-vite processes at once: main and
// preload in one, the renderer in the other. electron-vite builds its targets
// one after another, each mostly on one core; main took 8 s of a 36 s cold
// build on the runner (10-25). electron.vite.config.ts reads
// JUNO_ELECTRON_TARGETS to keep only the named targets. Run from apps/desktop.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const windows = process.platform === 'win32'
// On Windows the .bin entry is a .cmd shim, which only a shell finds; the
// shell splits the command line on spaces, so a checkout path with one needs quotes.
const bin = windows ? `"${join(process.cwd(), 'node_modules/.bin/electron-vite')}"` : join(process.cwd(), 'node_modules/.bin/electron-vite')
const groups = [['main', 'preload'], ['renderer']]
const codes = await Promise.all(groups.map((targets) => new Promise((done) => {
  const child = spawn(bin, ['build', '--ignoreConfigWarning'], { stdio: ['ignore', 'pipe', 'pipe'], shell: windows, env: { ...process.env, JUNO_ELECTRON_TARGETS: targets.join(',') } })
  // Each line keeps its group's name, since the two outputs interleave.
  for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    createInterface({ input: stream }).on('line', (line) => out.write(`[${targets[0]}] ${line}\n`))
  }
  child.on('error', (error) => { console.error(`[${targets[0]}] ${error.message}`); done(1) })
  child.on('close', (code) => done(code ?? 1))
})))
process.exit(Math.max(...codes))
