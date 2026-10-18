// Runs a command only when a machine-wide heavy-job slot is free.
//
// `--exclusive` takes every slot. `--priority release` puts a request ahead of
// all queued requests without interrupting jobs that already hold a slot.
// Child processes receive JUNO_HEAVY_HELD so nested heavy commands run under
// their parent's reservation instead of waiting for a slot they cannot get.

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const queueAt = process.argv[2] === '--queue' ? process.argv[3] : undefined
const rest = process.argv.slice(queueAt ? 4 : 2)
const flags = []
let offset = 0
while (rest[offset]?.startsWith('--')) {
  flags.push(rest[offset])
  offset++
  if (rest[offset - 1] === '--priority') offset++
}
const exclusive = flags.includes('--exclusive')
const electron = flags.includes('--electron') && process.platform === 'darwin'
const priorityIndex = flags.indexOf('--priority')
const priority = priorityIndex === -1 ? 'normal' : rest[priorityIndex + 1]
const args = rest.slice(offset)

if (args.length === 0 && !flags.includes('--status')) {
  console.error('usage: node scripts/heavy.mjs [--exclusive] [--priority release] <command> [args...]')
  process.exit(2)
}
if (priority !== 'normal' && priority !== 'release') {
  console.error(`heavy: unknown priority ${priority}; expected release`)
  process.exit(2)
}

const root = join(tmpdir(), queueAt ? `juno-heavy-${queueAt}` : 'juno-heavy')
const queueDir = join(root, 'queue')
const slots = queueAt ? 2 : Math.max(1, Number(process.env.JUNO_HEAVY_SLOTS ?? 2))
mkdirSync(queueDir, { recursive: true })

const alive = (pid) => {
  try { process.kill(pid, 0); return true } catch { return false }
}
const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}
const since = (iso) => `${Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000))}s`
const ownerFor = (dir) => {
  const owner = readJson(join(dir, 'owner.json'))
  if (owner && !alive(owner.pid)) {
    rmSync(dir, { recursive: true, force: true })
    return undefined
  }
  return owner
}

const run = () => {
  const child = spawn(args[0], args.slice(1), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, JUNO_HEAVY_HELD: '1' },
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  return new Promise((resolve) => child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))))
}

// A child spawned by a lock holder already runs inside that holder's budget.
// Do not enqueue it: an outer exclusive job may be holding all slots itself.
if (process.env.JUNO_HEAVY_HELD === '1' && !flags.includes('--status')) process.exit(await run())

if (flags.includes('--status')) {
  const holders = []
  for (const dirName of ['drain', 'electron', ...Array.from({ length: slots }, (_, index) => `slot-${index}`)]) {
    const dir = join(root, dirName)
    const owner = ownerFor(dir)
    if (owner && !holders.some((holder) => holder.pid === owner.pid)) holders.push({ command: owner.label, pid: owner.pid, waited: `${Math.floor((owner.waitedMs ?? 0) / 1000)}s` })
  }
  const queued = readdirSync(queueDir).map((file) => readJson(join(queueDir, file))).filter((job) => job && alive(job.pid))
    .sort((a, b) => (a.priority === 'release' ? 0 : 1) - (b.priority === 'release' ? 0 : 1) || a.queuedAt.localeCompare(b.queuedAt))
  console.log(JSON.stringify({ holders, queue: queued.map((job) => ({ command: job.label, pid: job.pid, waited: since(job.queuedAt), priority: job.priority })) }, null, 2))
  process.exit(0)
}

const label = `${args.join(' ')} (${process.cwd()})`
const queuedAt = new Date().toISOString()
const ticket = join(queueDir, `${priority === 'release' ? '0' : '1'}-${Date.now()}-${process.pid}-${randomUUID()}.json`)
writeFileSync(ticket, JSON.stringify({ pid: process.pid, label, queuedAt, priority }), { flag: 'wx' })

const take = (dir, extra = {}) => {
  try {
    mkdirSync(dir)
    writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, label, since: new Date().toISOString(), waitedMs: Date.now() - Date.parse(queuedAt), ...extra }))
    return true
  } catch {
    const owner = ownerFor(dir)
    if (owner && !alive(owner.pid)) rmSync(dir, { recursive: true, force: true })
    return false
  }
}

const queue = () => readdirSync(queueDir).map((file) => ({ file, job: readJson(join(queueDir, file)) }))
  .filter(({ job }) => job && alive(job.pid))
  .sort((a, b) => a.file.localeCompare(b.file))
const held = []
const tryAcquire = () => {
  if (queue()[0]?.file !== ticket.split('/').at(-1)) return undefined
  if (exclusive) {
    // Existing jobs drain naturally. The queue head prevents new jobs from
    // entering while this exclusive request waits for every slot.
    if (Array.from({ length: slots }, (_, index) => ownerFor(join(root, `slot-${index}`))).some(Boolean)) return undefined
    if (!take(join(root, 'drain'), { waitedMs: Date.now() - Date.parse(queuedAt) })) return undefined
    const drain = join(root, 'drain')
    held.push(drain)
    for (let index = 0; index < slots; index++) {
      const dir = join(root, `slot-${index}`)
      if (!take(dir, { waitedMs: Date.now() - Date.parse(queuedAt) })) {
        for (const acquired of held.splice(0)) rmSync(acquired, { recursive: true, force: true })
        return undefined
      }
      held.push(dir)
    }
    return held
  }
  if (ownerFor(join(root, 'drain'))) return undefined
  const appSlot = join(root, 'electron')
  if (electron && !take(appSlot, { waitedMs: Date.now() - Date.parse(queuedAt) })) return undefined
  for (let index = 0; index < slots; index++) {
    const dir = join(root, `slot-${index}`)
    if (take(dir, { waitedMs: Date.now() - Date.parse(queuedAt) })) return electron ? [dir, appSlot] : [dir]
  }
  if (electron) rmSync(appSlot, { recursive: true, force: true })
  return undefined
}

let slot = tryAcquire()
let lastNotice = 0
while (!slot) {
  if (Date.now() - lastNotice >= 30000) {
    console.error(`heavy: waiting (${since(queuedAt)}). Run node scripts/heavy.mjs --status to inspect the queue.`)
    lastNotice = Date.now()
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  slot = tryAcquire()
}
rmSync(ticket, { force: true })
const release = () => { for (const dir of held.length ? held : slot) rmSync(dir, { recursive: true, force: true }) }
process.on('exit', release)
const code = await run()
release()
process.exit(code)
