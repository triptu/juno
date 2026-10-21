import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'

// A first sync that keeps failing says why: "You're offline" only when the
// network failed, else "Couldn't finish syncing" with Copy log (SPEC section 5, item 5).

test('a boot Slack answers with data Juno cannot read shows the sync failure and copies the log', async ({ juno, fake, app, userData }, testInfo) => {
  test.setTimeout(90_000)
  fake.forceMalformed({ method: 'client.userBoot', times: 1_000 })
  await juno.signIn()
  const card = juno.sidebar.root.locator('[data-sync-status]')
  await juno.sidebar.expectSyncStatus("Couldn't finish syncing")
  await expect(card).toContainText("Slack sent data Juno can't read.")
  // Past the offline grace it still says the same.
  await juno.win.waitForTimeout(6_000)
  await expect(juno.sidebar.syncStatus).toHaveText("Couldn't finish syncing")
  await card.screenshot({ path: testInfo.outputPath('sync-failed-card.png') })
  await testInfo.attach('sync-failed-card', { path: testInfo.outputPath('sync-failed-card.png'), contentType: 'image/png' })

  const line = /WARN engine sync: boot failed, retrying cause=SlackDecodeError method=client\.userBoot/
  await expect.poll(() => readFile(join(userData, 'logs', 'engine.log'), 'utf8').catch(() => '')).toMatch(line)
  await card.getByRole('button', { name: 'Copy log' }).click()
  await juno.expectToast('Copied the log')
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  const version = await app.evaluate(({ app: electron }) => electron.getVersion())
  expect(copied).toContain('Juno sync log')
  expect(copied).toContain(`Juno ${version} on `)
  expect(copied).toMatch(/on (macOS|linux|darwin)/)
  expect(copied).toContain('Sync: failed (SlackDecodeError, client.userBoot)')
  expect(copied).toMatch(line)
})

test('a boot that never reaches Slack still says you are offline', async ({ juno, fake }) => {
  test.setTimeout(120_000)
  fake.loseResponse({ method: 'client.userBoot', times: 1_000 })
  await juno.signIn()
  await expect(juno.sidebar.syncStatus).toHaveText("You're offline", { timeout: 90_000 })
  await expect(juno.sidebar.root.getByRole('button', { name: 'Copy log' })).toHaveCount(0)
})
