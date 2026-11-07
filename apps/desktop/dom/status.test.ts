// Slack profile status (SPEC 14, "Your status"; SPEC 7, "People"): your own from the avatar menu, and other people's on their avatar's hover.
import { expect } from './expect'
import { domTest } from './test'

const MINUTE = 60_000

domTest('a status set from the avatar menu reaches Slack and shows in the menu, and Clear status takes it away', async ({ juno, fake, clock, step }) => {
  const { accountMenu } = juno
  const sheet = juno.win.getByRole('dialog', { name: 'Set a status' })
  const field = sheet.getByRole('textbox', { name: 'Status' })
  const clearAfter = sheet.getByRole('combobox', { name: 'Clear after' })
  const sent = () => fake.calls.filter((call) => call.method === 'users.profile.set').map((call) => JSON.parse(String(call.args['profile'])) as Record<string, unknown>)
  const seconds = () => Math.floor(clock.now() / 1000)
  // A status set on another of your clients, as Slack sends it to Juno.
  const ownStatus = async (text: string, expiration: number) => {
    fake.setStatus({ user: fake.selfId, text, emoji: ':palm_tree:', expiration })
    await accountMenu.open()
    await expect(accountMenu.item(text)).toBeVisible()
  }

  await step('the sheet opens with focus in the field; a preset, clicked or picked with ↓ and Enter, fills it and leaves focus there', async () => {
    await accountMenu.choose(/^Set a status/)
    await expect(sheet).toBeVisible()
    await expect(field).toBeFocused()
    // Focus elsewhere in the sheet, as after a Tab: the pick still brings it back to the field.
    ;(sheet.getByRole('button', { name: 'Cancel' }).el() as unknown as HTMLElement).focus()
    await sheet.getByRole('option', { name: /Working remotely/ }).click()
    await expect(field).toHaveValue('Working remotely')
    await expect(field).toBeFocused()
    await sheet.getByRole('button', { name: 'Clear', exact: true }).click()
    await field.press('ArrowDown')
    await field.press('ArrowDown')
    await field.press('Enter')
    await expect(field).toHaveValue('Commuting')
    await expect(field).toBeFocused()
    await expect(sheet).toBeVisible()
  })

  await step('Save sends the preset with its time, and the menu shows it', async () => {
    const before = sent().length
    const now = clock.now()
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => sent().slice(before).map(({ status_text, status_emoji }) => ({ status_text, status_emoji }))).toEqual([{ status_text: 'Commuting', status_emoji: ':bus:' }])
    const expiration = Number(sent().at(-1)?.['status_expiration'])
    expect(expiration * 1000).toBeGreaterThan(now + 25 * MINUTE)
    expect(expiration * 1000).toBeLessThan(now + 35 * MINUTE)
    await accountMenu.open()
    await expect(accountMenu.item(/^Commuting/)).toBeVisible()
  })

  await step('the emoji button opens the picker under it with the sheet still open, and Escape closes only the picker', async () => {
    await accountMenu.item(/^Commuting/).click()
    const emojiButton = sheet.getByRole('button', { name: /^Emoji: bus/ })
    await emojiButton.click()
    await expect(juno.win.getByRole('dialog', { name: 'Emoji' })).toBeVisible()
    await expect(sheet).toBeVisible()
    await juno.win.press('Escape')
    await expect(juno.win.getByRole('dialog', { name: 'Emoji' })).toHaveCount(0)
    await expect(sheet).toBeVisible()
    await expect(emojiButton).toBeFocused()
    await sheet.getByRole('button', { name: 'Cancel' }).click()
    await expect(sheet).toHaveCount(0)
  })

  await step('a status that never clears opens at Don’t clear, and Save keeps it so', async () => {
    await ownStatus('Vacationing', 0)
    await accountMenu.item('Vacationing').click()
    await expect(clearAfter).toHaveValue('never')
    const before = sent().length
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => sent().slice(before).map((profile) => profile['status_expiration'])).toEqual([0])
  })

  await step('a kept time that passes while the sheet is open becomes Today, and Save sends a time still to come', async () => {
    await ownStatus('At the dentist', seconds() + 30 * 60)
    await accountMenu.item('At the dentist').click()
    await expect(clearAfter).toHaveValue('keep')
    const mark = fake.calls.length
    await clock.fastForward(31 * MINUTE)
    await expect(clearAfter).toHaveValue('today')
    // The jump drops the socket (past its pong timeout): Save waits for the reconnect.
    await expect.poll(() => fake.calls.slice(mark).some((call) => call.method === 'client.getWebSocketURL')).toBe(true)
    await juno.expectEngineLive()
    const before = sent().length
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => sent().length).toBe(before + 1)
    expect(Number(sent().at(-1)?.['status_expiration'])).toBeGreaterThan(seconds())
  })

  await step('a refusal Juno has no words for keeps the sheet open and names Slack’s code', async () => {
    await accountMenu.open()
    await accountMenu.item('At the dentist').click()
    fake.forceError({ method: 'users.profile.set', error: 'team_added_to_org' })
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet.getByRole('alert')).toContainText('team_added_to_org')
    await expect(sheet.getByRole('alert')).not.toContainText('Try again')
  })

  await step('Clear status clears it in Slack and in the menu', async () => {
    const before = sent().length
    await sheet.getByRole('button', { name: 'Clear status' }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(() => sent().slice(before)).toEqual([{ status_text: '', status_emoji: '', status_expiration: 0 }])
    await accountMenu.open()
    await expect(accountMenu.item(/^Set a status/)).toBeVisible()
  })
}, { clock: true })

domTest("another person's status shows on their avatar's hover, fresh from Slack, and goes at its expiry", async ({ juno, fake, clock, step }) => {
  const text = 'Can someone check the staging deploy?'
  const tooltip = juno.win.getByRole('tooltip')
  const status = tooltip.locator('[data-person-status]')
  const seconds = () => Math.floor(clock.now() / 1000)
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text })
  await juno.sidebar.row('#eng').open()
  await expect(juno.topic.message(text)).toBeVisible()
  const avatar = juno.topic.list.locator('[data-tooltip-person="U0MAYA"]').first()
  // Off the avatar and back: the tooltip hides and shows again, and the pointer reaches the avatar anew.
  const hoverAgain = async () => {
    await juno.topic.message(text).hover()
    await expect(tooltip).toHaveCount(0)
    await avatar.hover()
    await expect(tooltip).toContainText('Message Maya')
  }
  // A jump past the socket's pong timeout drops it: wait for the reconnect and its catch-up.
  const fastForward = async (millis: number) => {
    const mark = fake.calls.length
    await clock.fastForward(millis)
    await expect.poll(() => fake.calls.slice(mark).some((call) => call.method === 'client.getWebSocketURL')).toBe(true)
    await juno.expectEngineLive()
  }

  await step('a status Slack did not send shows on the first hover, with when it clears', async () => {
    fake.setStatus({ user: 'U0MAYA', text: 'Out sick', emoji: ':face_with_thermometer:', expiration: seconds() + 30 * 60, quiet: true })
    await avatar.hover()
    await expect(tooltip).toContainText('Message Maya')
    await expect(status).toContainText('Out sick')
    await expect(status).toContainText('until')
  })

  await step('at its expiry the status goes, with the tooltip still open', async () => {
    await fastForward(31 * MINUTE)
    await expect(status).toHaveCount(0)
    await expect(tooltip).toContainText('Message Maya')
  })

  await step('once Juno’s copy is a few minutes old, the next hover brings a new status, and later its clearing', async () => {
    fake.setStatus({ user: 'U0MAYA', text: 'In a meeting', emoji: ':spiral_calendar_pad:', quiet: true })
    await hoverAgain()
    await expect(status).toContainText('In a meeting')
    fake.setStatus({ user: 'U0MAYA', text: '', emoji: '', quiet: true })
    await fastForward(6 * MINUTE)
    await hoverAgain()
    await expect(status).toHaveCount(0)
  })

  await step('a status Slack sends shows at once in the open tooltip', async () => {
    fake.setStatus({ user: 'U0MAYA', text: 'Focus time', emoji: ':headphones:' })
    await expect(status).toContainText('Focus time')
  })
}, { clock: true })
