/**
 * Privacy mode for screen sharing (SPEC section 5): message text is marked
 * hidden in the sidebar, and so are titles that are only a
 * message's first words, notifications leave the text out, the sidebar
 * footer turns it off, and it survives a relaunch. The blur itself, All
 * topics' virtual list and Reload in Electron are the other lanes'.
 */
import { expect } from './expect'
import { domTest } from './test'

const RINA = 'Rina finished the onsite'
const ALERTS_MAIN = '#alerts-prod'

domTest('privacy mode blurs previews from the account menu, hides notification text, survives a relaunch and turns off from the footer', async ({ juno, slack, relaunch }) => {
  const { sidebar, privacy, accountMenu } = juno
  const rina = sidebar.row(RINA)
  await rina.expectVisible()
  await privacy.expectBlurred(rina.preview, false)
  await expect(privacy.footer).toHaveCount(0)

  await accountMenu.open()
  await accountMenu.item(/^Hide message text/).click()
  await expect(accountMenu.root).toHaveCount(0)
  await privacy.expectBlurred(rina.preview)
  await expect(privacy.footer).toBeVisible()
  // With AI off the title is the message's first words, so it is hidden too.
  await privacy.expectBlurred(rina.titleText)

  // The menu offers the way back.
  await accountMenu.open()
  await expect(accountMenu.item(/^Show message text/)).toBeVisible()
  await accountMenu.close()

  // A notification says where it came from, not what was written. #alerts-prod is a bot channel, in Automated.
  await juno.notificationHoursNow()
  await sidebar.selectView('Automated')
  await sidebar.row(ALERTS_MAIN).chooseInMenu('notify-always')
  await juno.expectToast('#alerts-prod: Always')
  await sidebar.filter('All')
  slack.as('Leo').postIn('alerts-prod', 'Payroll export failed for 3 people')
  await expect.poll(async () => (await juno.osNotifications()).map((shown) => shown.body), { timeout: 15_000 }).toContain('Message hidden')
  expect((await juno.osNotifications()).some((shown) => shown.body.includes('Payroll'))).toBe(false)

  // Still on after a relaunch, from the first render; off from the footer.
  const second = await relaunch()
  await expect(second.privacy.footer).toBeVisible()
  expect(second.win.document.documentElement.hasAttribute('data-privacy')).toBe(true)
  const rinaAgain = second.sidebar.row(RINA)
  await rinaAgain.expectVisible()
  await second.privacy.expectBlurred(rinaAgain.preview)
  await second.privacy.showButton.click()
  await expect(second.privacy.footer).toHaveCount(0)
  await second.privacy.expectBlurred(rinaAgain.preview, false)
})
