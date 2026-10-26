import { readdirSync, readFileSync } from 'node:fs'

// GALLERY_CPU=1 (Linux only): CPU-seconds and wall per spec file. Each test is
// charged the CPU its worker process and that worker's browser used while it
// ran, read from /proc; exited renderers count once their parent reaps them.
// A test whose worker cannot be found is counted apart, not charged.
// The job total comes from the cgroup and includes the preview server.
const tick = 100

function processes() {
  const all = new Map()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      all.set(Number(name), { ppid: Number(fields[1]), cpu: fields.slice(11, 15).reduce((sum, value) => sum + Number(value), 0) / tick })
    } catch {}
  }
  return all
}

// Playwright sets TEST_WORKER_INDEX inside the worker once it runs, so /proc shows it
// only for the browser the worker launched. The worker is the runner's child above it.
function workerPid(all, workerIndex) {
  for (const pid of all.keys()) {
    try {
      if (!readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(`TEST_WORKER_INDEX=${workerIndex}`)) continue
    } catch { continue }
    for (let at = pid; at > 1; at = all.get(at)?.ppid ?? 0) if (all.get(at)?.ppid === process.pid) return at
  }
  return undefined
}

function treeCpu(all, root) {
  let sum = 0
  for (const [pid, entry] of all) {
    for (let at = pid; at > 1; at = all.get(at)?.ppid ?? 0) if (at === root) { sum += entry.cpu; break }
  }
  return sum
}

const cgroupCpu = () => {
  try { return Number(/usage_usec (\d+)/.exec(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'))[1]) / 1e6 } catch { return NaN }
}

export default class CpuReporter {
  enabled = process.env.GALLERY_CPU === '1' && process.platform === 'linux'
  workers = new Map()
  started = new Map()
  files = new Map()
  onBegin() { if (this.enabled) { this.begin = { cpu: cgroupCpu(), at: Date.now() } } }
  onTestBegin(test) {
    if (!this.enabled) return
    // The worker may not have launched its browser yet, so note every child of the runner.
    const all = processes()
    const children = new Map([...all].filter(([, entry]) => entry.ppid === process.pid).map(([pid]) => [pid, treeCpu(all, pid)]))
    this.started.set(test.id, { children, at: Date.now() })
  }
  onTestEnd(test, result) {
    const start = this.started.get(test.id)
    if (!this.enabled || !start) return
    const all = processes()
    let pid = this.workers.get(result.workerIndex)
    if (pid === undefined || !all.has(pid)) this.workers.set(result.workerIndex, pid = workerPid(all, result.workerIndex))
    const before = pid === undefined ? undefined : start.children.get(pid)
    const file = test.location.file.replace(/^.*\//, '')
    const entry = this.files.get(file) ?? { tests: 0, cpu: 0, unknown: 0, test: 0, first: start.at, last: 0 }
    entry.tests++
    if (before === undefined) entry.unknown++
    else entry.cpu += treeCpu(all, pid) - before
    entry.test += (Date.now() - start.at) / 1000
    entry.first = Math.min(entry.first, start.at)
    entry.last = Math.max(entry.last, Date.now())
    this.files.set(file, entry)
  }
  onEnd() {
    if (!this.enabled) return
    const rows = [...this.files].toSorted(([, a], [, b]) => b.cpu - a.cpu)
    const sum = (key) => rows.reduce((total, [, entry]) => total + entry[key], 0)
    console.log('gallery-cpu: spec | tests | CPU-s | summed test s | span s')
    for (const [file, entry] of rows) console.log(`gallery-cpu: ${file} | ${entry.tests} | ${entry.cpu.toFixed(1)}${entry.unknown > 0 ? ` (${entry.unknown} tests without a worker found)` : ''} | ${entry.test.toFixed(1)} | ${((entry.last - entry.first) / 1000).toFixed(1)}`)
    console.log(`gallery-cpu: tests ${sum('tests')}, charged ${sum('cpu').toFixed(1)} CPU-s, summed ${sum('test').toFixed(1)} s; job ${(cgroupCpu() - this.begin.cpu).toFixed(1)} CPU-s over ${((Date.now() - this.begin.at) / 1000).toFixed(1)} s`)
  }
}
