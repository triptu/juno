// Runs a command only when a machine-wide heavy-job slot is free.
//
// `--exclusive` takes every slot. `--priority release` puts a request ahead of
// all queued requests without interrupting jobs that already hold a slot.
// Child processes receive JUNO_HEAVY_HELD so nested heavy commands run under
// their parent's reservation instead of waiting for a slot they cannot get.
// On macOS a request also waits while the machine is overloaded (load above the
// core count, or under 1 GB of free and inactive memory);
// JUNO_HEAVY_IGNORE_LOAD=1 skips that wait.

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, tmpdir } from 'node:os'
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
  console.error('usage: bun scripts/heavy.mjs [--exclusive] [--priority release] <command> [args...]')
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

/** When a process started, as `ps` prints it; undefined when there is none. */
const startOf = (pid) => {
  try { return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || undefined } catch { return undefined }
}
const start = startOf(process.pid)
// A ticket or a slot names its process by PID and start: a PID the system gave to another process is not that job.
const alive = (record) => {
  try { process.kill(record.pid, 0) } catch { return false }
  if (record.start === undefined) return true
  // A `ps` that fails says nothing about the process: only a different start means the PID was reused.
  const now = startOf(record.pid)
  return now === undefined || now === record.start
}
const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}
const since = (iso) => `${Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000))}s`
const ownerFor = (dir) => {
  const owner = readJson(join(dir, 'owner.json'))
  if (owner && !alive(owner)) {
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
  const queued = readdirSync(queueDir).map((file) => readJson(join(queueDir, file))).filter((job) => job && alive(job))
    .toSorted((a, b) => (a.priority === 'release' ? 0 : 1) - (b.priority === 'release' ? 0 : 1) || a.queuedAt.localeCompare(b.queuedAt))
  console.log(JSON.stringify({ holders, queue: queued.map((job) => ({ command: job.label, pid: job.pid, waited: since(job.queuedAt), priority: job.priority })) }, null, 2))
  process.exit(0)
}

const label = `${args.join(' ')} (${process.cwd()})`
const queuedAt = new Date().toISOString()
const ticket = join(queueDir, `${priority === 'release' ? '0' : '1'}-${Date.now()}-${process.pid}-${randomUUID()}.json`)
writeFileSync(ticket, JSON.stringify({ pid: process.pid, start, label, queuedAt, priority }), { flag: 'wx' })

const take = (dir, extra = {}) => {
  try {
    mkdirSync(dir)
    writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, start, label, since: new Date().toISOString(), waitedMs: Date.now() - Date.parse(queuedAt), ...extra }))
    return true
  } catch {
    const owner = ownerFor(dir)
    if (owner && !alive(owner)) rmSync(dir, { recursive: true, force: true })
    return false
  }
}

const queue = () => readdirSync(queueDir).map((file) => ({ file, job: readJson(join(queueDir, file)) }))
  .filter(({ job }) => job && alive(job))
  .toSorted((a, b) => a.file.localeCompare(b.file))
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

// Free plus inactive pages: what macOS can hand out without swapping.
const availableMb = () => {
  const stat = execFileSync('vm_stat', { encoding: 'utf8' })
  const pageSize = Number(/page size of (\d+)/.exec(stat)?.[1] ?? 16384)
  const pages = (name) => Number(new RegExp(`Pages ${name}:\\s+(\\d+)`).exec(stat)?.[1] ?? 0)
  return (pages('free') + pages('inactive') + pages('speculative')) * pageSize / 2 ** 20
}
const overloaded = () => {
  if (process.platform !== 'darwin' || process.env.JUNO_HEAVY_IGNORE_LOAD === '1') return undefined
  const load = loadavg()[0]
  const cores = cpus().length
  if (load > cores) return `load ${load.toFixed(1)} is above ${cores} cores`
  try {
    const memory = availableMb()
    if (memory < 1024) return `only ${Math.round(memory)} MB of memory is free`
  } catch {}
  return undefined
}

let busy = overloaded()
let checkedAt = Date.now()
let slot = busy ? undefined : tryAcquire()
let lastNotice = 0
while (!slot) {
  if (Date.now() - lastNotice >= 30000) {
    console.error(busy
      ? `heavy: waiting (${since(queuedAt)}): ${busy}. JUNO_HEAVY_IGNORE_LOAD=1 skips this wait.`
      : `heavy: waiting (${since(queuedAt)}). Run bun scripts/heavy.mjs --status to inspect the queue.`)
    lastNotice = Date.now()
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (Date.now() - checkedAt >= 2000) {
    busy = overloaded()
    checkedAt = Date.now()
  }
  slot = busy ? undefined : tryAcquire()
}
rmSync(ticket, { force: true })
const release = () => { for (const dir of held.length ? held : slot) rmSync(dir, { recursive: true, force: true }) }
process.on('exit', release)
const code = await run()
release()
process.exit(code)
