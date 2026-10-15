import { expect } from '@playwright/test'
import { test } from './fixtures'

test('Settings › About shows the build and keeps updates off in tests', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openSettings('About')
  await expect(juno.settings.root.getByText(/Juno 0\./)).toBeVisible()
  const updates = juno.settings.root.getByRole('checkbox', { name: 'Download updates automatically' })
  await expect(updates).not.toBeChecked()
  await expect(updates).toBeDisabled()
  await expect(win.evaluate(() => window.juno.updates.set(true))).resolves.toEqual({ kind: 'unavailable' })
  await expect(juno.settings.root.getByRole('button', { name: 'Restart to update' })).toHaveCount(0)
})
