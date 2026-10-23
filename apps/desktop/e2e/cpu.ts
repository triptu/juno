import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * Under JUNO_E2E_CPU=1, what a test's processes burned: the CPU time of the
 * Playwright worker (the test, the fake Slack) and each process it started
 * (the test host, the browser and its renderers, Electron and its engine),
 * by kind. The `running` fixture prints them as `e2e timing: cpu-<kind>`
 * lines, which `JUNO_E2E_TIMINGS=1` collects (README, "Scheduling and setup
 * timings"). A process that ended during the test is not counted.
 */
interface Process {
  readonly pid: number
  readonly ppid: number
  readonly cpuMillis: number
  readonly args: string
}

/** Linux counts CPU time in clock ticks of 10 ms. */
const TICK_MILLIS = 10

function linuxProcesses(): Process[] {
  return readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .flatMap((name) => {
      try {
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
        // After the command in parentheses: state, ppid, ... utime (12th), stime (13th).
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        const args = readFileSync(`/proc/${name}/cmdline`, 'utf8').replaceAll('\0', ' ')
        return [{ pid: Number(name), ppid: Number(fields[1]), cpuMillis: (Number(fields[11]) + Number(fields[12])) * TICK_MILLIS, args }]
      } catch {
        return []
      }
    })
}

/** `ps` time is `[hh:]mm:ss.cc` on macOS. */
function macProcesses(): Process[] {
  const lines = execFileSync('ps', ['-axo', 'pid=,ppid=,time=,args='], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n')
  return lines.flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (match === null) return []
    const seconds = match[3]!.split(':').reduce((total, part) => total * 60 + Number(part), 0)
    return [{ pid: Number(match[1]), ppid: Number(match[2]), cpuMillis: seconds * 1000, args: match[4]! }]
  })
}

function kindOf(process: Process, worker: number): string {
  if (process.pid === worker) return 'worker'
  if (/testHost\.(ts|mjs)/.test(process.args)) return 'host'
  const type = /--type=([\w-]+)/.exec(process.args)?.[1]
  if (/headless_shell|chrom/i.test(process.args)) return type === undefined ? 'chrome' : `chrome-${type}`
  if (/electron/i.test(process.args)) return type === undefined ? 'electron' : `electron-${type}`
  return 'other'
}

/** CPU milliseconds of this worker and every process under it, by pid. */
function sample(): Map<number, { readonly kind: string; readonly cpuMillis: number }> {
  const all = process.platform === 'linux' ? linuxProcesses() : macProcesses()
  const children = new Map<number, Process[]>()
  for (const entry of all) children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry])
  const own = new Map<number, { kind: string; cpuMillis: number }>()
  const queue = all.filter((entry) => entry.pid === process.pid)
  while (queue.length > 0) {
    const next = queue.pop()!
    if (own.has(next.pid)) continue
    own.set(next.pid, { kind: kindOf(next, process.pid), cpuMillis: next.cpuMillis })
    queue.push(...(children.get(next.pid) ?? []))
  }
  return own
}

/** Starts counting; `stop` answers the CPU milliseconds burned since, by kind. */
export function cpuMeter(): { readonly stop: () => Record<string, number> } {
  const start = sample()
  return {
    stop: () => {
      const burned: Record<string, number> = {}
      for (const [pid, { kind, cpuMillis }] of sample()) burned[kind] = (burned[kind] ?? 0) + cpuMillis - (start.get(pid)?.cpuMillis ?? 0)
      return burned
    },
  }
}
