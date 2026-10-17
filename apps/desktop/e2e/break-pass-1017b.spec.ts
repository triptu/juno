// Second break pass of 10-17: Home's composer, the keys held after ⌘N and
// ⌘T, and short windows, used fast from the keyboard. Findings are in
// docs/reviews/2026-10-17-break-pass-b.md.
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'

async function setWindowSize(juno: Juno, width: number, height: number): Promise<void> {
  await juno.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!), [width, height] as const)
}

test('a first @ and a name typed fast with Enter picks the person typed, not a row from before', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, win } = juno

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

test('a Home draft shown again takes typing at its end', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
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

test('in the smallest window the destination list from ⌘N fits above the chip, its search in view', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
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

test('holding Backspace to clear the text keeps the destination; a new Backspace in the empty field goes back to Juno', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, win } = juno

  await write.recentRow('Maya').click()
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

test('text typed while a Home send waits for Slack stays in the field', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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

test('text pasted right after ⌘T goes into the new Home, in order with the keys typed around it', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
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
