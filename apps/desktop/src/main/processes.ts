/**
 * Juno's processes as the owner sees them in Activity Monitor ("Juno",
 * "Juno Helper", "Juno Helper (Renderer)", "Juno Helper (GPU)"), each with
 * Juno's own name and its CPU and memory (SPEC section 14, Settings › About
 * › Diagnostics; performance.md section 1, "Idle CPU").
 *
 * CPU is read from `cumulativeCPUUsage`, the seconds a process has run since
 * it started, so a share is the difference between two samples over the
 * time between them. `percentCPUUsage` is the share since the previous call
 * by anyone, so two readers would cut each other's window short.
 *
 * The self-check samples every 15 s. When a process stays above 30 % of a
 * core for 2 minutes while the app is idle (no input, no sync), it logs one
 * line with the process and the view, and logs again only after that
 * process came back under.
 *
 * No Electron import here: `index.ts` passes `app.getAppMetrics()` and the
 * rest in, tests pass a seam.
 */
import type { ProcessKind, ProcessReading } from '@juno/contract'

/** The part of Electron's `ProcessMetric` read here. */
export interface Metric {
  readonly pid: number
  readonly type: string
  readonly creationTime: number
  readonly name?: string
  readonly serviceName?: string
  readonly cpu: { readonly percentCPUUsage: number; readonly cumulativeCPUUsage?: number }
  /** KB. */
  readonly memory: { readonly workingSetSize: number }
}

/** What main knows about the processes it started. */
export interface KnownPids {
  readonly engine: number | undefined
  readonly agent: number | undefined
}

/** One sample: when, and each process's metric. */
export interface Sample {
  readonly at: number
  readonly metrics: ReadonlyArray<Metric>
}

const NAMES: Record<ProcessKind, string> = {
  main: 'Main',
  window: 'Window',
  engine: 'Engine',
  agent: 'Juno agent',
  graphics: 'Graphics',
  network: 'Network',
  other: 'Other',
}

/** Juno's kind for a process: the engine and the agent by the pids main started, the rest by Electron's type. */
export function kindOf(metric: Metric, pids: KnownPids): ProcessKind {
  if (metric.pid === pids.engine) return 'engine'
  if (metric.pid === pids.agent) return 'agent'
  if (metric.type === 'Browser') return 'main'
  if (metric.type === 'Tab') return 'window'
  if (metric.type === 'GPU') return 'graphics'
  if (metric.serviceName === 'network.mojom.NetworkService' || metric.name === 'Network Service') return 'network'
  return 'other'
}

/** Each process in `now` with its share of one core since `before`, as a percentage. */
export function readings(before: Sample | undefined, now: Sample, pids: KnownPids): ProcessReading[] {
  const seconds = before === undefined ? 0 : (now.at - before.at) / 1000
  return now.metrics
    .map((metric) => {
      const kind = kindOf(metric, pids)
      const earlier = before?.metrics.find((m) => m.pid === metric.pid && m.creationTime === metric.creationTime)
      const used = metric.cpu.cumulativeCPUUsage
      const cpu =
        earlier !== undefined && used !== undefined && earlier.cpu.cumulativeCPUUsage !== undefined && seconds > 0
          ? Math.max(0, ((used - earlier.cpu.cumulativeCPUUsage) / seconds) * 100)
          : metric.cpu.percentCPUUsage
      return {
        kind,
        name: kind === 'other' ? (metric.name ?? metric.serviceName ?? metric.type) : NAMES[kind],
        type: metric.type,
        pid: metric.pid,
        cpu: Math.round(cpu * 10) / 10,
        memoryMb: Math.round(metric.memory.workingSetSize / 1024),
      }
    })
    .toSorted((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.cpu - a.cpu)
}

const ORDER: ReadonlyArray<ProcessKind> = ['main', 'window', 'engine', 'agent', 'graphics', 'network', 'other']

/** How often the monitor samples. */
export const SAMPLE_MS = 15_000
/** A process over this share of one core for `HIGH_FOR_MS` while idle is logged. */
export const HIGH_PERCENT = 30
export const HIGH_FOR_MS = 120_000

export interface ProcessMonitorDeps {
  readonly metrics: () => ReadonlyArray<Metric>
  readonly now: () => number
  readonly pids: () => KnownPids
  /** Idle since the previous sample: no input to Juno and no sync running. */
  readonly idle: () => boolean
  /** The window and the view, for the log line: "window visible, view topic". */
  readonly context: () => string
  readonly log: (line: string) => void
}

/** Samples every `SAMPLE_MS` and logs a process that stays busy while the app is idle. */
export function createProcessMonitor(deps: ProcessMonitorDeps) {
  // The samples of the last `HIGH_FOR_MS` and a little more, oldest first.
  let samples: Sample[] = []
  // When the current idle stretch began, at a sample; undefined while busy.
  let idleSince: number | undefined
  // Processes already logged, by pid, until they come back under.
  const logged = new Set<number>()
  let timer: ReturnType<typeof setInterval> | undefined
  let lastLine: string | undefined

  const take = (): Sample => ({ at: deps.now(), metrics: deps.metrics() })

  const check = () => {
    const now = take()
    samples = [...samples.filter((sample) => now.at - sample.at <= HIGH_FOR_MS + SAMPLE_MS), now]
    if (!deps.idle()) {
      idleSince = undefined
      return
    }
    // The stretch starts at the sample before this one: nothing happened since.
    idleSince ??= samples.at(-2)?.at ?? now.at
    const first = samples.find((sample) => sample.at >= idleSince!)!
    if (now.at - first.at < HIGH_FOR_MS - SAMPLE_MS / 2) return
    for (const reading of readings(first, now, deps.pids())) {
      if (reading.cpu <= HIGH_PERCENT) {
        logged.delete(reading.pid)
        continue
      }
      if (logged.has(reading.pid)) continue
      logged.add(reading.pid)
      const minutes = Math.round((now.at - first.at) / 60_000)
      lastLine = `${reading.name} (${reading.type}, pid ${reading.pid}) used ${reading.cpu.toFixed(0)} % of a core for ${minutes} minutes while idle; ${deps.context()}`
      deps.log(`main: ${lastLine}`)
    }
  }

  return {
    start(): void {
      if (timer !== undefined) return
      samples = [take()]
      timer = setInterval(check, SAMPLE_MS)
      timer.unref()
    },
    stop(): void {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
    check,
    /**
     * Every process now, with its share since the newest sample at least
     * 2 s old: the last 2 to 17 s. The first read after launch has no
     * sample yet and gives Electron's own share.
     */
    read(): ProcessReading[] {
      const now = take()
      const before = samples.findLast((sample) => now.at - sample.at >= 2_000)
      return readings(before, now, deps.pids())
    },
    /** The last line the check logged, for Copy diagnostics. */
    lastBusy: () => lastLine,
    /** A sample, for tests that time their own window. */
    sample: take,
  }
}
