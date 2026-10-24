import { rm } from 'node:fs/promises'
import { startFakeSlack } from '@juno/fake-slack'
import { Juno } from './driver/juno'
import { webSurface } from './driver/surface'
import { expect, tempUserData, test } from './fixtures'

test('a reused host and context start with fresh credentials, settings and browser storage', async ({ hostPool, webPages }) => {
  const pages = await webPages()
  let firstOrigin = ''
  for (const first of [true, false]) {
    const userData = await tempUserData()
    const fake = await startFakeSlack()
    const page = await pages.open({ viewport: { width: 1200, height: 800 } })
    const host = await hostPool.start(fake, { userData, aliases: [], engine: {} })
    try {
      if (first) firstOrigin = host.url
      else expect(host.url).toBe(firstOrigin)
      await page.goto(`${host.url}?e2e=1`)
      const juno = new Juno(webSurface(page, host), page)
      expect(await page.evaluate(() => localStorage.getItem('previous-test'))).toBeNull()
      expect(await page.context().cookies()).toEqual([])
      // A leaked session would skip the sign-in screen; a leaked engine would keep the density.
      await juno.signIn()
      await juno.waitForSync()
      await juno.openSettings('Appearance')
      await expect(juno.settings.densityRadio('Compact')).toHaveAttribute('aria-checked', 'true')
      if (first) {
        await juno.settings.densityRadio('Comfortable').click()
        await expect(juno.settings.densityRadio('Comfortable')).toHaveAttribute('aria-checked', 'true')
        await page.evaluate(() => localStorage.setItem('previous-test', 'private draft'))
        await page.context().addCookies([{ name: 'previous-test', value: 'private session', url: host.url }])
      }
    } finally {
      await pages.release(page)
      await host.stop()
      await fake.close()
      await rm(userData, { recursive: true, force: true })
    }
  }
})
