// Second break pass of 10-17: Home's composer used fast from the keyboard.
// Keys typed on the chip and keys held after ⌘T reach the field through
// `execCommand`, so they stay in the browser lane
// (`e2e/break-pass-1017b.spec.ts`). Findings are in
// docs/reviews/2026-10-17-break-pass-b.md.
import { brief, paste } from './attach'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'

// Related checks share a launch: each step starts where the one before it left Home.
domTest("Home's destination from the keyboard: Backspace, a fast first @, and ⌘N and +", async ({ juno, step }) => {
  await step('holding Backspace to clear the text keeps the destination; a new Backspace in the empty field goes back to Juno', async () => {
    const { write, win } = juno

    await write.pickConversation('ma', 'Maya')
    await write.expectDestination('Maya')
    await write.composer.pressSequentially('ok')
    // A held key: the first press, then repeats past the last character.
    for (let i = 0; i < 4; i++) await win.keyboard.down('Backspace')
    await win.keyboard.up('Backspace')
    await expect(write.composer).toHaveValue('')
    await write.expectDestination('Maya')
    await write.composer.press('Backspace')
    await write.expectDestination('Juno')
  })

  await step('a first @ and a name typed fast with Enter picks the person typed, not a row from before', async () => {
    const { write, win } = juno

    // Empty again: the step above left its text in the field.
    await write.composer.fill('')
    await write.composer.pressSequentially('@')
    await expect(write.sendTo).toBeVisible()
    // No wait: the rows for "@j" are still on their way when Enter lands.
    await win.keyboard.type('j')
    await win.keyboard.press('Enter')
    await win.keyboard.type('Hi')
    await write.expectDestination('Jonas')
    await expect(write.composer).toHaveValue('Hi')
    await expect(write.composer).toBeFocused()
  })

  await step('New Message (⌘N) opens Home’s destination list, and a new Home when this one has a draft; "+" opens Home ready to write', async () => {
    const { write, tabs, sidebar, topic } = juno

    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    // No Home tab is open, so ⌘N opens one and leaves the topic in its tab.
    await tabs.menu('new-message')
    await tabs.expectCount(2)
    await tabs.expectActiveAt('Home', 0)
    await expect(write.search).toBeFocused()
    // Esc closes the list; that focus goes back to the chip is the browser lane's.
    await write.search.press('Escape')

    await write.write('Half a thought')
    await tabs.menu('new-message')
    await tabs.expectCount(3)
    await tabs.expectActiveAt('Home', 1)
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await expect(write.composer).toHaveValue('')

    await tabs.newTabButton.click()
    await tabs.expectCount(4)
    await tabs.expectActiveAt('Home', 2)
    await expect(write.composer).toBeFocused()
    await write.expectDestination('Juno')
  })
})

domTest("Home's drafts: typing during a send, a draft shown again, and a file Juno cannot read", async ({ juno, fake, step }) => {
  await step('text typed while a Home send waits for Slack stays in the field', async () => {
    const { write, win } = juno

    await write.pickConversation('jon', 'Jonas')
    fake.holdNext({ method: 'conversations.open', before: true })
    await write.write('Welcome aboard')
    await write.send()
    await expect.poll(() => fake.heldCount({ method: 'conversations.open' })).toBe(1)
    await win.keyboard.type('Next one')
    fake.release({ method: 'conversations.open' })
    await juno.expectToast('Sent to Jonas')
    await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['text'])).toEqual(['Welcome aboard'])
    await expect(write.composer).toHaveValue('Next one')
    await write.expectDestination('Juno')
  })

  await step('a Home draft shown again takes typing at its end', async () => {
    const { write, topic, sidebar, nav, win } = juno

    await write.write('A long thought')
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await nav.back()
    await expect(write.composer).toHaveValue('A long thought')
    await expect(write.composer).toBeFocused()
    await win.keyboard.type(' and more')
    await expect(write.composer).toHaveValue('A long thought and more')
  })

  await step('a file Juno cannot read, attached with Juno chosen, says so until a person or channel is chosen', async () => {
    const { write } = juno
    const note = write.root.locator('[data-attachment-note]')

    await write.write('Brief for the launch')
    await paste(write.composer, [brief()])
    await expect(write.root.getByRole('button', { name: 'Remove launch-brief.pdf' })).toBeVisible()
    await expect(note).toHaveText('Juno reads images and text files. Pick a person or channel to send the others.')
    await write.pickConversation('eng', 'eng')
    await expect(note).toHaveCount(0)
    await expect(write.root.getByRole('button', { name: 'Remove launch-brief.pdf' })).toBeVisible()
    // Back to Juno: the files stay, and the line comes back.
    await write.composer.fill('')
    await write.composer.press('Backspace')
    await write.expectDestination('Juno')
    await expect(note).toBeVisible()
  })
})

