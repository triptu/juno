// Joining and leaving a channel with no new chrome (SPEC 5, 7 and 10): ⌘K finds a public channel you are not in, Enter
// shows it read-only with Join channel in the composer's place, Join makes it yours, and Leave channel in its row's menu
// takes it out of the sidebar, turns the open tab back into the preview, and Undo joins again.
import { expect } from './expect'
import { domTest } from './test'

// #social's one message; you are not in #social.
const BOARD_GAMES = 'Board games at six?'

domTest('a channel you are not in is found in ⌘K, previewed, joined, and left with Undo', async ({ juno, fake, step }) => {
  const { palette, sidebar, topic } = juno
  const asked = (method: string) => fake.calls.filter((call) => call.method === method).map((call) => call.args['channel'])
  const note = topic.root.locator('[data-read-only-note]')

  await step('⌘K lists #social as not joined, and Enter shows its messages with Join channel, outside the sidebar', async () => {
    await palette.open()
    await palette.type('social')
    await palette.expectResults()
    await expect(palette.row('social')).toContainText('Not joined')
    await palette.expectActive(/social/)
    await palette.press('Enter')
    await palette.expectClosed()
    await topic.expectMessage(BOARD_GAMES)
    await expect(note).toContainText('You’re not in #social.')
    await expect(topic.composer).toHaveCount(0)
    // The messages are on screen, so the sidebar has had the same store to read.
    await sidebar.row('#social').expectAbsent()
  })

  await step('Join channel joins at once: the composer takes focus, Slack is asked once, and a new message brings it to the sidebar', async () => {
    await note.getByRole('button', { name: 'Join channel' }).click()
    await expect(topic.composer).toBeFocused()
    // The toast shows once Slack has answered.
    await juno.expectToast('Joined #social')
    expect(asked('conversations.join')).toEqual(['C0SOCIAL'])
    fake.injectMessage({ channel: 'C0SOCIAL', user: 'U0PRIYA', text: 'Snacks are on me.' })
    await sidebar.row('#social').expectVisible()
  })

  await step('Leave channel in its row menu takes it out of the sidebar and back to the preview, and Undo joins again', async () => {
    await sidebar.row('#social').chooseInMenu('leave-channel')
    await juno.expectToast('Left #social')
    expect(asked('conversations.leave')).toEqual(['C0SOCIAL'])
    await sidebar.row('#social').expectAbsent()
    await expect(note).toContainText('You’re not in #social.')

    await juno.undoFromToast()
    await expect(topic.composer).toBeVisible()
    await expect.poll(() => asked('conversations.join')).toEqual(['C0SOCIAL', 'C0SOCIAL'])
    await sidebar.row('#social').expectVisible()
  })
})
