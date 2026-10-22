// What a message does (spec section 7): edit and delete your own from the
// keyboard and the message menu; reactions from the menu's grid, the emoji
// picker it turns into and the chips; Quote, whole and selected; and Start or
// open a thread from Main. Every change shows at once and reaches the fake
// Slack through the outbox.
import type { FakeSlack } from '@juno/fake-slack'
import { expect, test, type Fixtures } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const POSTGRES = 'Draft plan is in the doc'

async function openMain(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
}

/** Sends `text` and waits for Slack's copy. Answers its ts in the fake. */
async function sendOwn(juno: Juno, fake: FakeSlack, text: string): Promise<string> {
  await juno.topic.send(text)
  await juno.topic.expectSent(text)
  return fake.messages('C0ENG').find((m) => m.text === text)!.ts
}

const slackText = (fake: FakeSlack, ts: string) => fake.messages('C0ENG').find((m) => m.ts === ts)?.text

// One Main: each step sends its own message, so ↑ from the composer selects the newest one.
test('edits and deletes with the keyboard and menus, reacts and quotes messages', async ({ juno, fake }) => {
  await openMain(juno)
  const context = { juno, fake }
  await test.step('the keyboard: ↑ selects, E edits, Delete asks once, and E and Delete do nothing on others’ messages', () => keyboardActions(context))
  await test.step('reactions: a quick reaction, its chip toggled off, and one from the full picker', () => reactToMessage(context))
  await test.step('Quote puts the message in the composer as "> " lines; a selection quotes only itself', () => quoteMessage(context))
  await test.step('Edit and Delete from the menus, and Edit after the message changed elsewhere', () => menuActions(context))
})

async function keyboardActions({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  await juno.topic.composer.fill('')
  const { topic } = juno
  await test.step('the keyboard: ↑ selects the newest message, E edits it in place, Enter saves', async () => {
    const ts = await sendOwn(juno, fake, 'Shiping the fix today')

    await topic.composer.press('ArrowUp')
    const row = topic.message('Shiping the fix today')
    await expect(row).toBeFocused()
    await row.press('e')
    // The field replaces the body, so the row is found by the field from here on.
    const field = topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('Shiping the fix today')
    await field.fill('Shipping the fix today')
    await field.press('Enter')

    // The new text shows at once, marked edited, and the composer has focus again.
    await expect(topic.message('Shipping the fix today')).toContainText('edited')
    await expect(field).toHaveCount(0)
    await expect(topic.composer).toBeFocused()
    await expect.poll(() => slackText(fake, ts)).toBe('Shipping the fix today')
    const updates = fake.calls.filter((call) => call.method === 'chat.update')
    expect(updates).toHaveLength(1)
    expect(updates[0]!.args['ts']).toBe(ts)
  })
  await test.step('the keyboard: Delete asks once at the message’s top right; Esc keeps the message, Enter deletes it', async () => {
    const ts = await sendOwn(juno, fake, 'Posted in the wrong channel')

    await topic.composer.press('ArrowUp')
    const row = topic.message('Posted in the wrong channel')
    await expect(row).toBeFocused()
    await row.press('Delete')
    const confirm = row.locator('[data-delete-confirm]')
    await expect(confirm).toContainText('Delete this message?')
    await expect(confirm).toBeVisible()
    await row.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(row).toBeFocused()

    await row.press('Backspace')
    await expect(confirm).toBeVisible()
    await row.press('Enter')
    await expect(topic.message('Posted in the wrong channel')).toHaveCount(0)
    await expect(topic.composer).toBeFocused()
    await expect.poll(() => fake.messages('C0ENG').some((m) => m.ts === ts)).toBe(false)
    expect(fake.calls.filter((call) => call.method === 'chat.delete')).toHaveLength(1)
  })
  await test.step('the keyboard: ↑ and ↓ move the selection, Esc goes back to the composer, and E does nothing on others’ messages', async () => {
    fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Can someone look at the replica lag?' })
    await topic.expectMessage('Can someone look at the replica lag?')
    await sendOwn(juno, fake, 'Looking now')

    await topic.composer.press('ArrowUp')
    await expect(topic.message('Looking now')).toBeFocused()
    await juno.win.keyboard.press('ArrowUp')
    const theirs = topic.message('Can someone look at the replica lag?')
    await expect(theirs).toBeFocused()
    await juno.win.keyboard.press('e')
    await expect(theirs.getByRole('textbox', { name: 'Edit message' })).toHaveCount(0)
    await juno.win.keyboard.press('Delete')
    await expect(theirs.locator('[data-delete-confirm]')).toHaveCount(0)
    await juno.win.keyboard.press('ArrowDown')
    await expect(topic.message('Looking now')).toBeFocused()
    await juno.win.keyboard.press('Escape')
    await expect(topic.composer).toBeFocused()
    // ↑ only selects from an empty composer; with text it moves the caret.
    await topic.composer.fill('half a thought')
    await topic.composer.press('ArrowUp')
    await expect(topic.composer).toBeFocused()
  })
}

async function reactToMessage({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  await juno.topic.composer.fill('')
  const { topic } = juno
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: `Staging is green again <@${fake.selfId}>` })
  const row = topic.message('Staging is green again')
  await expect(row).toBeVisible()
  const ts = fake.messages('C0ENG').find((m) => m.text?.startsWith('Staging is green again'))!.ts
  const reactionsOf = () => fake.messages('C0ENG').find((m) => m.ts === ts)?.reactions ?? []

  await (await topic.messageMenu('Staging is green again')).react('+1')
  const chip = row.getByRole('button', { name: '1 👍, including you' })
  await expect(chip).toBeVisible()
  await expect.poll(reactionsOf).toEqual([expect.objectContaining({ name: '+1', count: 1 })])

  // Another person's 👀 arrives while ours is on its way; both are counted.
  fake.holdNext({ method: 'reactions.add', before: true })
  await (await topic.messageMenu('Staging is green again')).react('eyes')
  await expect(row.getByRole('button', { name: '1 👀, including you' })).toBeVisible()
  fake.addReaction({ channel: 'C0ENG', ts, name: 'eyes', user: 'U0PRIYA' })
  await expect(row.getByRole('button', { name: '2 👀, including you' })).toBeVisible()
  fake.release()
  await expect.poll(() => reactionsOf().find((r) => r.name === 'eyes')?.count).toBe(2)
  await expect(row.getByRole('button', { name: '2 👀, including you' })).toBeVisible()

  // The chip takes it back, and so does choosing a reacted emoji again in the grid, which shows it chosen.
  await chip.click()
  await expect(row.getByRole('button', { name: /^\d+ 👍/ })).toHaveCount(0)
  await expect.poll(() => reactionsOf().some((r) => r.name === '+1')).toBe(false)
  const menu = await topic.messageMenu('Staging is green again')
  await expect(menu.cell('eyes')).toHaveAttribute('aria-pressed', 'true')
  await expect(menu.cell('+1')).toHaveAttribute('aria-pressed', 'false')
  await menu.react('eyes')
  await expect(row.getByRole('button', { name: '1 👀', exact: true })).toBeVisible()
  await expect.poll(() => reactionsOf().find((r) => r.name === 'eyes')?.count).toBe(1)

  // While its menu is open the message keeps its hover fill; More reactions turns the menu into the picker.
  await row.hover()
  const hovered = await row.evaluate((element) => getComputedStyle(element).backgroundColor)
  const open = await topic.messageMenu('Staging is green again')
  await juno.win.mouse.move(0, 0)
  await expect(row).toHaveAttribute('data-popover-active', '')
  await expect(row).toHaveCSS('background-color', hovered)
  await open.more.click()
  await expect(open.search).toBeFocused()
  await open.search.fill('rocket')
  await open.search.press('Enter')
  await expect(open.root).toHaveCount(0)
  await expect(row).not.toHaveAttribute('data-popover-active')
  await expect(row.getByRole('button', { name: '1 🚀, including you' })).toBeVisible()
  await expect.poll(() => reactionsOf().some((r) => r.name === 'rocket')).toBe(true)
}

async function quoteMessage({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  await juno.topic.composer.fill('')
  const { topic } = juno
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Billing webhooks retry for 30 minutes, so nothing gets dropped.' })
  const row = topic.message('Billing webhooks retry')
  await expect(row).toBeVisible()

  await topic.composer.fill('Agreed.')
  await (await topic.messageMenu('Billing webhooks retry')).choose('quote')
  await expect(topic.composer).toHaveValue('Agreed.\n> Billing webhooks retry for 30 minutes, so nothing gets dropped.\n')
  await expect(topic.composer).toBeFocused()
  await topic.composer.fill('')

  // Select "retry for 30 minutes" with the mouse.
  const text = row.locator('[data-msg-text] p').first()
  const box = (await text.boundingBox())!
  await text.evaluate((node) => {
    const words = node.firstChild!
    const start = words.textContent!.indexOf('retry')
    const range = document.createRange()
    range.setStart(words, start)
    range.setEnd(words, start + 'retry for 30 minutes'.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await text.dispatchEvent('pointerup', { bubbles: true, clientX: box.x + 20, clientY: box.y + 5 })
  const quote = juno.win.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Quote' })
  await expect(quote).toBeVisible()
  await quote.click()
  await expect(topic.composer).toHaveValue('> retry for 30 minutes\n')
  await expect(quote).toHaveCount(0)
  await topic.composer.fill('')

  // With words selected in the message, its menu copies and quotes only them, and the selection's bar steps aside.
  await text.evaluate((node) => {
    const words = node.firstChild!
    const start = words.textContent!.indexOf('nothing')
    const range = document.createRange()
    range.setStart(words, start)
    range.setEnd(words, start + 'nothing gets dropped'.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await text.dispatchEvent('pointerup', { bubbles: true, clientX: box.x + 20, clientY: box.y + 5 })
  await expect(quote).toBeVisible()
  // Right-clicked on the selected words, which keep their selection.
  const words = await text.evaluate((node) => {
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
    const box = node.getBoundingClientRect()
    return { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 }
  })
  const menu = await juno.messageMenu.openOn(text, words)
  await expect(quote).toHaveCount(0)
  expect(await menu.labels()).toContain('Copy')
  await menu.choose('quote')
  await expect(topic.composer).toHaveValue('> nothing gets dropped\n')
}

async function menuActions({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  await juno.topic.composer.fill('')
  const { topic } = juno
  await test.step('Edit and Delete… from the message menu', async () => {
    const ts = await sendOwn(juno, fake, 'Retro at 3')

    const row = topic.message('Retro at 3')
    const menu = await topic.messageMenu('Retro at 3')
    await juno.win.mouse.move(0, 0)
    await expect(row).toHaveAttribute('data-popover-active', '')
    // Ask Juno shows while AI assist is on, and Tell me if nobody replies is enabled once Juno may schedule.
    const labels = (await menu.labels()).filter((label) => label !== 'Ask Juno').map((label) => label.replace(/^\((.*)\)$/, '$1'))
    expect(labels).toEqual(['Quote', '-', 'Copy text', 'Forward…', 'Open in Slack', '-', 'Tell me if nobody replies', '-', 'Edit', 'Delete…'])
    await menu.choose('edit')
    const editing = topic.list.locator('[data-editing]')
    const field = editing.getByRole('textbox', { name: 'Edit message' })
    await field.fill('Retro at 4')
    await editing.getByRole('button', { name: 'Save' }).click()
    await expect(topic.message('Retro at 4')).toContainText('edited')
    await expect.poll(() => slackText(fake, ts)).toBe('Retro at 4')

    await (await topic.messageMenu('Retro at 4')).choose('delete')
    const confirm = topic.message('Retro at 4').locator('[data-delete-confirm]')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(topic.message('Retro at 4')).toHaveCount(0)
    await expect.poll(() => fake.messages('C0ENG').some((m) => m.ts === ts)).toBe(false)
  })
  await test.step('a message edited elsewhere while its menu is open: Edit starts from the new text', async () => {
    const ts = await sendOwn(juno, fake, 'Standup at 10')

    const menu = await topic.messageMenu('Standup at 10')
    fake.editMessage({ channel: 'C0ENG', ts, text: 'Standup at 11' })
    await expect(topic.message('Standup at 11')).toBeVisible()
    await menu.choose('edit')

    const field = topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(field).toHaveValue('Standup at 11')
  })
}

test('an edit started while the message is sending stays open, with what was typed, when Slack takes the message', async ({ juno, fake }) => {
  await openMain(juno)
  const { topic } = juno
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await topic.send('Typo in thsi one')
  await expect(topic.message('Typo in thsi one')).toHaveAttribute('data-pending', 'sending')
  await topic.composer.press('ArrowUp')
  await topic.message('Typo in thsi one').press('e')
  const field = topic.list.getByRole('textbox', { name: 'Edit message' })
  await field.fill('Typo in this one, still typing')

  fake.release()
  await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Typo in thsi one')).toBe(true)
  await expect(topic.list.locator('[data-message-row][data-pending]')).toHaveCount(0)
  await expect(field).toHaveValue('Typo in this one, still typing')
  await expect(field).toBeFocused()
  await field.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Typo in this one, still typing')).toBe(true)
})

test('an edit made while the message is still sending reaches Slack once it has the message', async ({ juno, fake }) => {
  await openMain(juno)
  const { topic } = juno
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await topic.send('Typo in thsi one')
  await expect(topic.message('Typo in thsi one')).toHaveAttribute('data-pending', 'sending')
  await topic.composer.press('ArrowUp')
  await juno.win.keyboard.press('e')
  const field = topic.list.getByRole('textbox', { name: 'Edit message' })
  await field.fill('Typo in this one')
  await field.press('Enter')
  await expect(topic.message('Typo in this one')).toBeVisible()
  expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(0)

  fake.release()
  await topic.expectSent('Typo in this one')
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Typo in this one').length).toBe(1)
  expect(fake.messages('C0ENG').some((m) => m.text === 'Typo in thsi one')).toBe(false)
})

test('Open thread and Start thread from Main open the message’s thread', async ({ juno, fake }) => {
  await openMain(juno)
  const { topic } = juno
  await test.step('Open thread from Main opens the message’s thread with its composer', async () => {
    const menu = await topic.messageMenu(POSTGRES)
    expect((await menu.labels())[0]).toBe('Open thread')
    await menu.choose('reply')
    await topic.expectTitle(/Postgres|Draft plan/)
    await expect(topic.composer).toHaveAttribute('aria-label', 'Reply')
  })
  // Back to Main for the next message.
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await test.step('Start thread from Main opens a new topic for the message', async () => {
    const ts = await sendOwn(juno, fake, 'A new topic from Main')
    const menu = await topic.messageMenu('A new topic from Main')
    expect((await menu.labels())[0]).toBe('Start thread')
    await menu.choose('reply')
    await topic.expectTitle(/A new topic from Main/)
    await expect(topic.composer).toHaveAttribute('aria-label', 'Reply')
    expect(fake.messages('C0ENG').find((message) => message.ts === ts)?.reply_count ?? 0).toBe(0)
  })
})

test('⌘-click Start thread in the menu opens the thread in a background tab; this tab and its scroll stay', async ({ juno, fake }) => {
  await openMain(juno)
  const { topic, tabs } = juno
  await sendOwn(juno, fake, 'A topic for later')
  await sendOwn(juno, fake, 'One more line under it')
  const active = tabs.root.getByRole('tab', { selected: true })
  const mainTab = await active.getAttribute('data-tooltip')
  const before = await tabs.titles()
  await topic.scroller.evaluate((scroller) => {
    scroller.scrollTop = Math.max(0, scroller.scrollTop - 24)
  })
  const scrollTop = await topic.scroller.evaluate((scroller) => scroller.scrollTop)

  const menu = await topic.messageMenu('A topic for later')
  await menu.item('reply').click({ modifiers: ['Meta'] })
  await expect(menu.root).toHaveCount(0)
  // The thread's tab joins the strip right after this one, which stays active, still at Main.
  await tabs.expectCount(before.length + 1)
  await expect.poll(() => tabs.titles()).toEqual(expect.arrayContaining([expect.stringMatching(/A topic for later/)]))
  await expect(active).toHaveAttribute('data-tooltip', mainTab!)
  await topic.expectTitle('Main')
  expect(await topic.scroller.evaluate((scroller) => scroller.scrollTop)).toBe(scrollTop)

  // ⌘Enter on Start thread does the same from the keyboard.
  const other = await topic.messageMenu('One more line under it')
  await other.item('reply').hover()
  await juno.win.keyboard.press('Meta+Enter')
  await tabs.expectCount(before.length + 2)
  await expect(active).toHaveAttribute('data-tooltip', mainTab!)

  // The background tab opens on the new thread, ready to reply.
  await tabs.select('A topic for later')
  await topic.expectTitle(/A topic for later/)
  await expect(topic.composer).toHaveAttribute('aria-label', 'Reply')
})
