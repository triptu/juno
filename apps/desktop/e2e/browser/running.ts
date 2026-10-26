import { test, type ElectronApplication, type Page } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import type { EngineOptions } from '../../web/host/testHost'
import { Juno } from '../driver/juno'
import { webSurface } from '../driver/surface'
import { type RunningApp } from '../launch'
import { startSendTrace, startSidebarTrace } from '../traces'
import type { HostPool } from './host'
import { snapshotState, type WebSnapshot } from './snapshot'
import { startRendererProfile } from './rprof'
import { cpuMeter } from '../cpu'

/**
 * The browser project's `running` app: a host from the worker's pool on the
 * test's data folder, and the test's page on it. A synced start waits for
 * the warm boot and checks the fake still matches the snapshot.
 */
export async function startWebApp(
  pool: HostPool,
  page: Page,
  fake: FakeSlack,
  userData: string,
  snapshot: WebSnapshot | undefined,
  options: { readonly sidebarTrace: boolean; readonly sendTrace: boolean; readonly tour?: boolean; readonly engine: EngineOptions },
): Promise<RunningApp> {
  const timings = process.env.JUNO_E2E_TIMINGS === '1'
  let at = performance.now()
  const lap = (name: string) => {
    if (timings) console.log(`e2e timing: ${name} ${Math.round(performance.now() - at)} ms`)
    at = performance.now()
  }
  const readyCpu = process.env.JUNO_E2E_CPU === '1' ? cpuMeter() : undefined
  const rprof = process.env.JUNO_E2E_RPROF === '1' ? await startRendererProfile(page) : undefined
  const host = await pool.start(fake, { userData, aliases: snapshot === undefined ? [] : [snapshot.origin], engine: options.engine })
  lap('host')
  try {
    if (options.sidebarTrace) await page.addInitScript(startSidebarTrace)
    if (options.sendTrace) await page.addInitScript(startSendTrace)
    await page.goto(`${host.url}?e2e=1${options.tour ? "&tour=auto" : ""}`)
    lap('page')
    if (snapshot !== undefined) {
      await new Juno(webSurface(page, host), page).waitForSync()
      lap('warm-sync')
      await rprof?.mark('ready')
      for (const [kind, millis] of Object.entries(readyCpu?.stop() ?? {})) console.log(`e2e timing: cpu-ready-${kind} ${Math.round(millis)} ms`)
      if (snapshotState(fake) !== snapshot.fakeState || fake.server.sockets.size !== 1) throw new Error('The fake no longer matches the synced snapshot this test started from. Something in the test setup or the warm boot changed the fake; sign in instead (synced: false), or remove the difference.')
    }
  } catch (error) {
    await host.stop()
    throw error
  }
  return {
    get app(): ElectronApplication {
      return webSurface(page, host).electron
    },
    win: page,
    host,
    close: async () => { try { await rprof?.stop(test.info().title) } finally { await host.stop() } },
  }
}
