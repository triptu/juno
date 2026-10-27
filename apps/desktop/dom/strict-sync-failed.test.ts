// A first sync that keeps failing says why (SPEC section 5, item 5): the card at the sidebar's foot and its Copy log.
// Which phase and reason the engine reports, across retries and for a boot that never reaches Slack, is in
// packages/engine/test/flows/first-sync.flow.test.ts.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from './expect'
import { domTest } from './test'

domTest('a boot Slack answers with data Juno cannot read shows the sync failure and copies the log', async ({ juno, fake, userData }) => {
  fake.forceMalformed({ method: 'client.userBoot', times: 1_000 })
  await juno.signIn()
  const card = juno.sidebar.root.locator('[data-sync-status]')
  await juno.sidebar.expectSyncStatus("Couldn't finish syncing")
  await expect(card).toContainText("Slack sent data Juno can't read.")

  const line = /WARN engine sync: boot failed, retrying cause=SlackDecodeError method=client\.userBoot/
  await expect.poll(() => readFile(join(userData, 'logs', 'engine.log'), 'utf8').catch(() => '')).toMatch(line)
  await card.getByRole('button', { name: 'Copy log' }).click()
  await juno.expectToast('Copied the log')
  const copied = await juno.clipboard()
  expect(copied).toContain('Juno sync log')
  expect(copied).toContain('Juno web on ')
  expect(copied).toMatch(/on (macOS|linux|darwin)/)
  expect(copied).toContain('Sync: failed (SlackDecodeError, client.userBoot)')
  expect(copied).toMatch(line)
}, { synced: false })
