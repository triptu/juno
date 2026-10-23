/**
 * Main's idle CPU check (processes.ts): a process that stays above 30 % of
 * a core for 2 minutes while the app is idle is logged once, with Juno's
 * name for it; one busy while the owner works or a sync runs is not.
 */
import { expect, it } from 'bun:test'
import { createProcessMonitor, SAMPLE_MS, type Metric } from '../src/main/processes'

/** Main, the window and the engine; the engine has used `engineSeconds` of CPU so far. */
const metrics = (engineSeconds: number, at: number): Metric[] => [
  { pid: 1, type: 'Browser', creationTime: 0, cpu: { percentCPUUsage: 0, cumulativeCPUUsage: at / 1000 / 200 }, memory: { workingSetSize: 60_000 } },
  { pid: 2, type: 'Tab', creationTime: 0, cpu: { percentCPUUsage: 0, cumulativeCPUUsage: at / 1000 / 200 }, memory: { workingSetSize: 200_000 } },
  { pid: 3, type: 'Utility', creationTime: 0, serviceName: 'node.mojom.NodeService', cpu: { percentCPUUsage: 0, cumulativeCPUUsage: engineSeconds }, memory: { workingSetSize: 110_000 } },
]

/** A monitor on a clock the test moves, with the engine using `share` of a core while `busy(at)`. */
function monitor(options: { readonly share: number; readonly idle: (at: number) => boolean }) {
  let now = 0
  const lines: string[] = []
  const processes = createProcessMonitor({
    metrics: () => metrics((now / 1000) * options.share, now),
    now: () => now,
    pids: () => ({ engine: 3, agent: undefined }),
    idle: () => options.idle(now),
    context: () => 'window hidden, view topic',
    log: (line) => lines.push(line),
  })
  processes.start()
  processes.stop()
  const run = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += SAMPLE_MS) {
      now += SAMPLE_MS
      processes.check()
    }
  }
  return { processes, lines, run }
}

it('logs the engine once when it stays at a full core for 2 minutes while idle', () => {
  const { lines, run } = monitor({ share: 1, idle: () => true })
  run(105_000)
  expect(lines).toEqual([])
  run(15_000)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatch(/^main: Engine \(Utility, pid 3\) used 100 % of a core for 2 minutes while idle; window hidden, view topic$/)
  run(10 * 60_000)
  expect(lines).toHaveLength(1)
})

it('does not log a busy engine while a sync runs or the owner uses the window', () => {
  // Idle for 90 s at a time, then a moment of input or sync.
  const { lines, run } = monitor({ share: 1, idle: (at) => at % 105_000 !== 0 })
  run(10 * 60_000)
  expect(lines).toEqual([])
})

it('does not log a process under 30 % of a core', () => {
  const { lines, run } = monitor({ share: 0.25, idle: () => true })
  run(10 * 60_000)
  expect(lines).toEqual([])
})

it('names each process for the diagnostics, with its share since the last sample', () => {
  const { processes, run } = monitor({ share: 0.5, idle: () => true })
  run(30_000)
  expect(processes.read().map((reading) => [reading.name, reading.cpu, reading.memoryMb])).toEqual([
    ['Main', 0.5, 59],
    ['Window', 0.5, 195],
    ['Engine', 50, 107],
  ])
})
