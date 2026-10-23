import type { ElectronApplication, Page } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import type { EngineOptions } from '../../web/host/testHost'
import { Juno } from '../driver/juno'
import { webSurface } from '../driver/surface'
import type { RunningApp } from '../launch'
import { startSendTrace, startSidebarTrace } from '../traces'
import type { HostPool } from './host'
import { snapshotState, type WebSnapshot } from './snapshot'

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
  options: { readonly sidebarTrace: boolean; readonly sendTrace: boolean; readonly engine: EngineOptions },
): Promise<RunningApp> {
  const host = await pool.start(fake, { userData, aliases: snapshot === undefined ? [] : [snapshot.origin], engine: options.engine })
  try {
    if (options.sidebarTrace) await page.addInitScript(startSidebarTrace)
    if (options.sendTrace) await page.addInitScript(startSendTrace)
    await page.goto(`${host.url}?e2e=1`)
    if (snapshot !== undefined) {
      await new Juno(webSurface(page, host), page).waitForSync()
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
    close: () => host.stop(),
  }
}
