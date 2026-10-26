import type { Browser } from '@playwright/test'
import { startFakeSlack } from '@juno/fake-slack'
import type { EngineOptions } from '../../web/host/testHost'
import { Juno } from '../driver/juno'
import { webSurface } from '../driver/surface'
import { WEB_BUILD, type HostPool } from './host'
import { PINNED } from './pages'
import { sharedSnapshot, snapshotKey, snapshotState, type SnapshotMade, type WebSnapshot } from './snapshotCache'

export { copySnapshot, matchingFake, snapshotState, type WebSnapshot } from './snapshotCache'

/** Signs in on `dir` in Chromium and waits for the first sync. */
async function build(dir: string, browser: Browser, pool: HostPool, engine: EngineOptions): Promise<SnapshotMade> {
  const seedTime = Date.now()
  const fake = await startFakeSlack({ seedTime })
  const host = await pool.start(fake, { userData: dir, aliases: [], engine })
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, ...PINNED })
  try {
    const page = await context.newPage()
    await page.goto(`${host.url}?e2e=1`)
    const juno = new Juno(webSurface(page, host), page)
    await juno.signIn()
    await juno.waitForSync()
    await context.close()
    await host.stop()
    return { origin: new URL(fake.url).origin, seedTime, sessions: fake.sessions(), fakeState: snapshotState(fake) }
  } finally {
    await context.close().catch(() => undefined)
    await host.stop()
    await fake.close()
  }
}

/** The browser lane's snapshot for these engine options (`sharedSnapshot`). */
export async function webSnapshot(browser: Browser, pool: HostPool, engine: EngineOptions): Promise<WebSnapshot> {
  return sharedSnapshot(await snapshotKey(WEB_BUILD, engine), (dir) => build(dir, browser, pool, engine))
}
