// Second break pass of 10-17: Home's composer, the keys held after ⌘N and
// ⌘T, and short windows, used fast from the keyboard. Findings are in
// docs/reviews/2026-10-17-break-pass-b.md.
import { brief, paste } from './attach'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'

async function setWindowSize(juno: Juno, width: number, height: number): Promise<void> {
  await juno.setWindowSize(width, height)
}

// Related checks share a launch: each step starts where the one before it left Home.
test("Home's destination from the keyboard: Backspace, keys on the chip, and a fast first @", async ({ juno }) => {
  await test.step('holding Backspace to clear the text keeps the destination; a new Backspace in the empty field goes back to Juno', async () => {
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

  await test.step('keys typed on the destination chip go into the field; arrows and Space still drive the chip', async () => {
    const { write, tabs, win } = juno

    await tabs.menu('new-message')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await expect(write.chip).toBeFocused()
    await win.keyboard.type('What changed today?')
    await expect(write.composer).toBeFocused()
    await expect(write.composer).toHaveValue('What changed today?')
    await write.expectDestination('Juno')

    await win.keyboard.press('Shift+Tab')
    await expect(write.chip).toBeFocused()
    await win.keyboard.press('ArrowDown')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await win.keyboard.press('Space')
    await expect(write.search).toBeFocused()
    await write.search.press('Escape')
    await expect(write.composer).toHaveValue('What changed today?')
  })

  await test.step('a first @ and a name typed fast with Enter picks the person typed, not a row from before', async () => {
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
})

test("Home's drafts: typing during a send, a draft shown again, and a file Juno cannot read", async ({ juno, fake }) => {
  await test.step('text typed while a Home send waits for Slack stays in the field', async () => {
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

  await test.step('a Home draft shown again takes typing at its end', async () => {
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

  await test.step('a file Juno cannot read, attached with Juno chosen, says so until a person or channel is chosen', async () => {
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

test('the smallest window and keys held for a new Home: the destination list fits, and a paste after ⌘T lands in order', async ({ juno }) => {
  await test.step('in the smallest window the destination list from ⌘N fits above the chip, its search in view', async () => {
    const { write, tabs, win } = juno

    await setWindowSize(juno, 720, 480)
    await expect.poll(() => win.evaluate(() => innerHeight)).toBeLessThan(500)
    await tabs.menu('new-message')
    await expect(write.search).toBeFocused()
    await expect(write.option('Maya')).toBeVisible()
    // In view and not under anything that clips it: the point at its middle is the search itself.
    await expect(write.search).toBeInViewport({ ratio: 1 })
    const hit = await write.search.evaluate((search) => {
      const box = search.getBoundingClientRect()
      const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return at === search
    })
    expect(hit, 'the search is the element at its own middle').toBe(true)
    await win.keyboard.type('jon')
    await win.keyboard.press('Enter')
    await write.expectDestination('Jonas')
  })

  await test.step('text pasted right after ⌘T goes into the new Home, in order with the keys typed around it', async () => {
    const { write, topic, sidebar, tabs, win } = juno

    await sidebar.row(POSTGRES).open()
    await topic.composer.focus()
    // ⌘T reaches the page before the menu runs it; keys and a ⌘V in that time are held for the new tab.
    await win.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', metaKey: true, bubbles: true, cancelable: true })))
    await win.keyboard.type('Re: ')
    await win.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/plain', 'the launch brief')
      ;(document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await win.keyboard.type('?')
    await tabs.menu('new-tab')
    await tabs.expectActiveAt('Home', 0)
    await expect(write.composer).toHaveValue('Re: the launch brief?')
    await tabs.select(POSTGRES)
    await expect(topic.composer).toHaveValue('')
  })
})
