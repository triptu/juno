// Set yourself away or active while the active hours are in force (SPEC 14, "Away by hand" and "Your own dot"),
// as reported on 0.1.26: a wake applied the hours over the choice, and the paused badge showed no presence.
import { expect } from './expect'
import { domTest } from './test'

domTest('a choice from the avatar menu wins over the active hours through a wake, and the paused badge agrees with the menu', async ({ juno, fake, step }) => {
  const { accountMenu } = juno
  const button = juno.sidebar.accountButton
  const sent = () => fake.calls.filter((call) => call.method === 'presence.set').map((call) => call.args['presence'])
  await juno.activeWhilePaused()
  // The hours keep the owner active, and the paused badge is green.
  await expect(button.locator('[data-paused][data-presence="active"]')).toHaveCount(1)

  await step('Set yourself away shows Away, the badge turns away, and Slack gets it', async () => {
    const before = sent().length
    await accountMenu.choose(/^Set yourself away/)
    await accountMenu.open()
    await expect(accountMenu.root.getByText(/^Away/)).toBeVisible()
    await expect(accountMenu.root.locator('[data-paused][data-presence="away"]')).toHaveCount(1)
    // The hours' pause is said once, on Pause notifications.
    await expect(accountMenu.item(/^Pause notifications/)).toContainText('Paused until')
    await expect(accountMenu.item(/^Notification settings/)).not.toContainText('Paused until')
    await expect(button.locator('[data-paused][data-presence="away"]')).toHaveCount(1)
    await expect.poll(() => sent().slice(before)).toEqual(['away'])
    await accountMenu.close()
  })

  await step('a wake tells Slack the choice again, not the hours', async () => {
    const before = sent().length
    await juno.system('wake')
    await expect.poll(() => sent().slice(before)).toEqual(['away'])
    await accountMenu.open()
    await expect(accountMenu.root.getByText(/^Away/)).toBeVisible()
    await expect(accountMenu.item(/^Set yourself active/)).toBeVisible()
    await accountMenu.close()
  })

  await step('Set yourself active shows Active with the green badge, and Slack gets it', async () => {
    const before = sent().length
    await accountMenu.choose(/^Set yourself active/)
    await expect(button.locator('[data-paused][data-presence="active"]')).toHaveCount(1)
    await accountMenu.open()
    await expect(accountMenu.root.getByText(/^Active$/)).toBeVisible()
    await expect(accountMenu.root.locator('[data-paused][data-presence="active"]')).toHaveCount(1)
    await expect.poll(() => sent().slice(before)).toEqual(['active'])
  })
})
