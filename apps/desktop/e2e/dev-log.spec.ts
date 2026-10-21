// The developer log: a hidden page that lists what the engine does, opened
// from ⌘K only when the text names it ("developer", "dev log"). Its rows are
// the Slack calls the fake saw, and a row opens to show the call's params.
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test('⌘K opens the developer log only by name, and a Slack call shows its method and params', async ({ juno, fake }) => {
  const { palette, tabs, win } = juno
  const command = palette.root.getByRole('option', { name: /Open developer log/ })

  await test.step('the command is in neither the ">" listing nor a near match', async () => {
    await palette.open()
    await palette.type('>')
    await expect(palette.root.getByRole('option').first()).toBeVisible()
    await expect(command).toHaveCount(0)
    await palette.clear()
    await palette.type('log')
    await palette.expectResults()
    await expect(command).toHaveCount(0)
    await palette.press('Escape')
    await palette.expectClosed()
  })

  await test.step('"dev log" lists it, and Enter opens the log in a tab of its own', async () => {
    await palette.open()
    await palette.type('dev log')
    await expect(command).toBeVisible()
    await palette.expectActive(/Open developer log/)
    await palette.press('Enter')
    await palette.expectClosed()
    await tabs.expectActive('Developer log')
  })

  const page = win.locator('[data-dev-log]')
  // A method the app called on this launch, with the params the fake received.
  const call = fake.calls.find((each) => each.kind === 'api' && each.method === 'conversations.history' && each.args.channel !== undefined)
    ?? fake.calls.find((each) => each.kind === 'api' && each.method !== 'auth.test' && Object.keys(each.args).some((name) => !name.startsWith('_x_') && name !== 'token'))
  expect(call).toBeDefined()
  const method = call!.method

  await test.step('the call is a row with its method; filtered to it, a click shows its params', async () => {
    await page.getByRole('radio', { name: 'Slack calls' }).click()
    await page.getByRole('textbox', { name: 'Filter' }).fill(method)
    const row = page.locator(`[data-dev-log-row="slack"][data-dev-log-name="${method}"]`).first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()
    const detail = page.locator('[data-dev-log-detail]')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('Request')
    await expect(detail).toContainText('lane')
    const [name] = Object.entries(call!.args).find(([field]) => !field.startsWith('_x_') && field !== 'token')!
    await expect(detail).toContainText(name)
    await expect(detail).toContainText('Timing')
    // The token never reaches the log.
    await expect(detail).not.toContainText(/xox[a-z]-/)
  })
})
