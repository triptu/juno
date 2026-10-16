import { expect, test } from './fixtures'

// No full stop: the AI title (the first sentence, cut short) replaces the message text once the title job runs.
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const SWITCH = 'Mark messages read in Slack too'
const CATCH_UP = 'Mark earlier reads in Slack'

test('default mirroring, peeking, switching off and catching up earlier reads', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const marks = () => slack.fake.calls.filter((call) => call.method === 'conversations.mark' || call.method === 'subscriptions.thread.mark')
  slack.fake.resetCalls()
  await juno.sidebar.row(RINA).peek()
  await juno.peek.expectShowing(RINA)
  await juno.peek.expectMessage('Strong systems design')
  await juno.peek.release()
  await juno.peek.expectClosed()
  expect(marks()).toHaveLength(0)

  await juno.sidebar.row(RINA).open()
  await juno.sidebar.row(RINA).expectRead()
  await expect.poll(() => marks().length).toBe(1)
  await juno.openSettings('General')
  const toggle = juno.settings.root.getByRole('switch', { name: SWITCH })
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await expect(toggle).not.toBeChecked()
  slack.fake.resetCalls()
  await juno.sidebar.row(ROADMAP).open()
  await juno.sidebar.row(ROADMAP).expectRead()
  await juno.openSettings('General')
  await expect(toggle).not.toBeChecked()
  expect(marks()).toHaveLength(0)
  await toggle.check()
  slack.fake.holdNext({ method: 'subscriptions.thread.mark' })
  const catchUp = juno.settings.root.getByRole('button', { name: CATCH_UP })
  await catchUp.scrollIntoViewIfNeeded()
  const before = await catchUp.locator('..').boundingBox()
  await catchUp.click()
  const progress = juno.settings.root.getByText(/Marking earlier reads in Slack/)
  await expect(progress).toBeVisible()
  expect(await progress.locator('..').boundingBox()).toEqual(before)
  slack.fake.release({ method: 'subscriptions.thread.mark' })
  await expect.poll(() => marks().length).toBe(1)
  await expect(juno.settings.root.getByRole('button', { name: CATCH_UP })).toHaveCount(0)
  await expect(juno.settings.root.getByText(/Marking earlier reads in Slack/)).toHaveCount(0)
  await expect(juno.settings.root.getByText('Earlier reads are in Slack')).toBeVisible()
})
