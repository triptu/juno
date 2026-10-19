import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test('Settings keeps the classifier choice when reopened', async ({ juno }) => {
  await juno.openSettings()
  const classifier = juno.settings.root.getByRole('checkbox', { name: 'Use fast classifier' })
  await expect(classifier).toBeChecked()
  await classifier.click()
  await expect(classifier).not.toBeChecked()
  await juno.sidebar.row('#eng').open()
  await juno.openSettings()
  await expect(classifier).not.toBeChecked()
  await classifier.click()
  await expect(classifier).toBeChecked()
})
