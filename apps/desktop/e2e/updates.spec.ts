import { expect } from '@playwright/test'
import { test } from './fixtures'

test('Preferences shows the build and keeps updates off in tests', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openPreferences()
  await expect(juno.preferences.root.getByText(/Juno 0\./)).toBeVisible()
  const updates = juno.preferences.root.getByRole('checkbox', { name: 'Download updates automatically' })
  await expect(updates).not.toBeChecked()
  await expect(updates).toBeDisabled()
  await expect(win.evaluate(() => window.juno.updates.set(true))).resolves.toEqual({ kind: 'unavailable' })
  await expect(juno.preferences.root.getByRole('button', { name: 'Restart to update' })).toHaveCount(0)
})
