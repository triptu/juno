/** Opt-in diagnostics, excluded from reported suite timings. */
import { Session } from 'node:inspector/promises'
import { afterAll, beforeAll } from 'vitest'

const enabled = process.env.JUNO_UNIT_PROFILE === '1'
const phases = new Map<string, { calls: number; wall: number; cpu: number }>()

export async function timed<A>(name: string, run: () => Promise<A>): Promise<A> {
  if (!enabled) return run()
  const wall = performance.now()
  const cpu = process.cpuUsage()
  try { return await run() } finally {
    const used = process.cpuUsage(cpu)
    const phase = phases.get(name) ?? { calls: 0, wall: 0, cpu: 0 }
    phase.calls++
    phase.wall += performance.now() - wall
    phase.cpu += (used.user + used.system) / 1000
    phases.set(name, phase)
  }
}

if (enabled) {
  const session = new Session()
  let wall = 0
  let cpu = process.cpuUsage()
  beforeAll(async () => {
    phases.clear()
    wall = performance.now()
    cpu = process.cpuUsage()
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.start')
  })
  afterAll(async () => {
    const { profile } = await session.post('Profiler.stop')
    session.disconnect()
    const used = process.cpuUsage(cpu)
    const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame]))
    const samples = new Map<string, number>()
    for (const [index, id] of (profile.samples ?? []).entries()) {
      const frame = frames.get(id)
      if (frame === undefined) continue
      const key = `${frame.functionName} ${frame.url.replaceAll(process.cwd(), '.')}:${frame.lineNumber + 1}`
      samples.set(key, (samples.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 0) / 1000)
    }
    console.info('unit profile', JSON.stringify({
      wall: performance.now() - wall, cpu: (used.user + used.system) / 1000,
      phases: Object.fromEntries(phases),
      samples: [...samples].sort((a, b) => b[1] - a[1]).slice(0, 20),
    }))
  })
}
