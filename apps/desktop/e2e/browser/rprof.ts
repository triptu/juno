import type { CDPSession, Page } from '@playwright/test'

/**
 * Under JUNO_E2E_RPROF=1, where the page's renderer spends its main-thread time (README,
 * "Browser lane"): a sampled JS profile grouped by script (the app bundle, Playwright's injected
 * script and `evaluate` calls, the rest), split at the synced start's `ready` mark, with
 * Chromium's Performance metrics at each mark. Printed as one `e2e rprof:` JSON line per test.
 */
interface Node { readonly id: number; readonly callFrame: { readonly functionName: string; readonly url: string } }
interface Profile { readonly nodes: ReadonlyArray<Node>; readonly samples: ReadonlyArray<number>; readonly timeDeltas: ReadonlyArray<number> }
type Groups = Record<string, number>

const METRICS = ['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'Nodes', 'JSHeapUsedSize']

const groupOf = ({ functionName, url }: Node['callFrame']): string =>
  ['(idle)', '(program)', '(garbage collector)', '(root)'].includes(functionName) ? functionName
    : /\/assets\//.test(url) ? 'app' : url === '' ? 'injected-or-eval' : 'other'

async function collect(session: CDPSession, groups: Groups, fns: Map<string, number>): Promise<ReadonlyArray<readonly [string, number]>> {
  const own = new Map<string, number>()
  const { profile } = (await session.send('Profiler.stop')) as unknown as { profile: Profile }
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  profile.samples.forEach((id, index) => {
    const frame = byId.get(id)!.callFrame
    const millis = (profile.timeDeltas[index] ?? 0) / 1000
    const group = groupOf(frame)
    groups[group] = (groups[group] ?? 0) + millis
    if (group === '(idle)') return
    const name = `${frame.functionName || '(anon)'} ${frame.url.replace(/^.*\//, '')}`
    fns.set(name, (fns.get(name) ?? 0) + millis)
    own.set(name, (own.get(name) ?? 0) + millis)
  })
  return [...own].toSorted((a, b) => b[1] - a[1]).slice(0, 25).map(([name, ms]) => [name, Math.round(ms)] as const)
}

const rounded = (groups: Groups) => Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, Math.round(value)]))

export async function startRendererProfile(page: Page): Promise<{ readonly mark: (name: string) => Promise<void>; readonly stop: (title: string) => Promise<void> }> {
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  await session.send('Profiler.enable')
  await session.send('Profiler.setSamplingInterval', { interval: 1000 })
  await session.send('Profiler.start')
  const marks: Record<string, Record<string, number>> = {}
  const phases: Record<string, Groups> = {}
  const fns = new Map<string, number>()
  const tops: Record<string, ReadonlyArray<readonly [string, number]>> = {}
  const metrics = async () => {
    const { metrics: list } = await session.send('Performance.getMetrics')
    return Object.fromEntries(list.filter((m) => METRICS.includes(m.name)).map((m) => [m.name, Math.round(m.name.endsWith('Duration') ? m.value * 1000 : m.value)]))
  }
  return {
    mark: async (name) => {
      marks[name] = await metrics()
      tops[name] = await collect(session, phases[name] = {}, fns)
      await session.send('Profiler.start')
    },
    stop: async (title) => {
      try {
        marks['end'] = await metrics()
        tops['end'] = await collect(session, phases['end'] = {}, fns)
        const top = [...fns].toSorted((a, b) => b[1] - a[1]).slice(0, 12).map(([name, ms]) => [name, Math.round(ms)])
        console.log(`e2e rprof: ${JSON.stringify({ title, marks, phases: Object.fromEntries(Object.entries(phases).map(([key, groups]) => [key, rounded(groups)])), top, tops })}`)
      } finally { await session.detach().catch(() => undefined) }
    },
  }
}
