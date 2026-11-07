// Slack profile status (SPEC 14, "Your status"; SPEC 7, "People"): your own from the avatar menu, and other people's on their avatar's hover.
import { expect } from './expect'
import { domTest } from './test'

domTest('a status set from the avatar menu reaches Slack and shows in the menu, and Clear status takes it away', async ({ juno, fake, clock, step }) => {
  const { accountMenu } = juno
  const sheet = juno.win.getByRole('dialog', { name: 'Set a status' })
  const sent = () => fake.calls.filter((call) => call.method === 'users.profile.set').map((call) => JSON.parse(String(call.args['profile'])) as Record<string, unknown>)

  await step('a preset fills the sheet, Save sends it, and the menu shows it', async () => {
    await accountMenu.choose(/^Set a status/)
    await expect(sheet).toBeVisible()
    await sheet.getByRole('option', { name: /Working remotely/ }).click()
    await expect(sheet.getByRole('textbox', { name: 'Status' })).toHaveValue('Working remotely')
    await sheet.getByRole('combobox', { name: 'Clear after' }).selectOption('1h')
    const before = sent().length
    const now = clock.now()
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => sent().slice(before).map(({ status_text, status_emoji }) => ({ status_text, status_emoji }))).toEqual([{ status_text: 'Working remotely', status_emoji: ':house_with_garden:' }])
    const expiration = Number(sent().at(-1)?.['status_expiration'])
    expect(expiration * 1000).toBeGreaterThan(now + 50 * 60_000)
    expect(expiration * 1000).toBeLessThan(now + 70 * 60_000)
    await accountMenu.open()
    await expect(accountMenu.item(/^Working remotely/)).toBeVisible()
    await expect(accountMenu.root.locator('[data-account-status-emoji]')).toHaveCount(1)
  })

  await step('the status row opens the sheet on the status, and Clear status clears it in Slack and in the menu', async () => {
    await accountMenu.item(/^Working remotely/).click()
    await expect(sheet.getByRole('textbox', { name: 'Status' })).toHaveValue('Working remotely')
    const before = sent().length
    await sheet.getByRole('button', { name: 'Clear status' }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => sent().slice(before)).toEqual([{ status_text: '', status_emoji: '', status_expiration: 0 }])
    await accountMenu.open()
    await expect(accountMenu.item(/^Set a status/)).toBeVisible()
    await expect(accountMenu.root.locator('[data-account-status-emoji]')).toHaveCount(0)
  })
}, { clock: true })

domTest("another person's status comes from Slack's event, shows on their avatar's hover, and goes at its expiry", async ({ juno, fake, clock, step }) => {
  const text = 'Can someone check the staging deploy?'
  const tooltip = juno.win.getByRole('tooltip')
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text })
  await juno.sidebar.row('#eng').open()
  await expect(juno.topic.message(text)).toBeVisible()
  const avatar = juno.topic.list.locator('[data-tooltip-person="U0MAYA"]').first()

  await step('the status set on her own client shows under her name on hover, with when it clears', async () => {
    fake.setStatus({ user: 'U0MAYA', text: 'Out sick', emoji: ':face_with_thermometer:', expiration: Math.floor(clock.now() / 1000) + 30 * 60 })
    await avatar.hover()
    await expect(tooltip).toContainText('Message Maya')
    await expect(tooltip.locator('[data-person-status]')).toContainText('Out sick')
    await expect(tooltip.locator('[data-person-status]')).toContainText('until')
  })

  await step('at its expiry the status goes, with the tooltip still open', async () => {
    await clock.fastForward(31 * 60_000)
    await expect(tooltip.locator('[data-person-status]')).toHaveCount(0)
    await expect(tooltip).toContainText('Message Maya')
  })
}, { clock: true })
