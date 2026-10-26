// What a message does (spec section 7): edit and delete your own from the
// keyboard and the message menu; reactions from the menu's grid, the emoji
// picker it turns into and the chips; Quote, whole and selected; and Start or
// open a thread from Main. Every change shows at once and reaches the fake
// Slack through the outbox. A message's fills are the gallery's.
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import type { Query } from './query'
import { domTest, type DomContext } from './test'

const ENG_MAIN = '#eng'
const POSTGRES = 'Draft plan is in the doc'

type Context = Pick<DomContext, 'juno' | 'fake' | 'step'>

async function openMain(juno: Juno): Promise<void> {
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

/** Selects `words` in the first paragraph of `text`, as a drag over them does, and lets go. */
async function selectWords(text: Query, words: string): Promise<void> {
  const node = await text.element()
  const run = node.firstChild!
  const start = run.textContent!.indexOf(words)
  const range = node.ownerDocument.createRange()
  range.setStart(run, start)
  range.setEnd(run, start + words.length)
  const selection = node.ownerDocument.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  const W = node.ownerDocument.defaultView as unknown as { PointerEvent: typeof PointerEvent }
  node.dispatchEvent(new W.PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
}

// One Main: each step sends its own message, so ↑ from the composer selects the newest one.
domTest('edits and deletes with the keyboard and menus, reacts and quotes messages', async ({ juno, fake, step }) => {
  await openMain(juno)
  const context = { juno, fake, step }
  await step('the keyboard: ↑ selects, E edits, Delete asks once, and E and Delete do nothing on others’ messages', () => keyboardActions(context))
  await step('reactions: a quick reaction, its chip toggled off, and one from the full picker', () => reactToMessage(context))
  await step('Quote puts the message in the composer as "> " lines; a selection quotes only itself', () => quoteMessage(context))
  await step('Edit and Delete from the menus, and Edit after the message changed elsewhere', () => menuActions(context))
})

async function keyboardActions({ juno, fake, step }: Context): Promise<void> {
  await juno.topic.composer.fill('')
  const { topic } = juno
  await step('the keyboard: ↑ selects the newest message, E edits it in place, Enter saves', async () => {
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
  await step('the keyboard: Delete asks once; Esc keeps the message, Enter deletes it', async () => {
    const ts = await sendOwn(juno, fake, 'Posted in the wrong channel')

    await topic.composer.press('ArrowUp')
    const row = topic.message('Posted in the wrong channel')
    await expect(row).toBeFocused()
    await row.press('Delete')
    const confirm = row.locator('[data-delete-confirm]')
    await expect(confirm).toContainText('Delete this message?')
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
  await step('the keyboard: ↑ and ↓ move the selection, ↓ on the newest or Esc goes back to the composer, and E does nothing on others’ messages', () => moveSelection(juno, fake))
}

async function moveSelection(juno: Juno, fake: FakeSlack): Promise<void> {
  const { topic } = juno
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
  // ↓ on the newest message goes back to the composer, the inverse of ↑.
  await juno.win.keyboard.press('ArrowDown')
  await expect(topic.composer).toBeFocused()
  await topic.composer.press('ArrowUp')
  await expect(topic.message('Looking now')).toBeFocused()
  await juno.win.keyboard.press('Escape')
  await expect(topic.composer).toBeFocused()
  // ↑ with a draft: composer.spec.ts.
}

async function reactToMessage({ juno, fake }: Context): Promise<void> {
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

  // While its menu is open, and the picker More reactions turns it into, the message is marked as the menu's.
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Preview builds are back to five minutes' })
  const plain = topic.message('Preview builds are back to five minutes')
  await expect(plain).toBeVisible()
  const plainTs = fake.messages('C0ENG').find((m) => m.text === 'Preview builds are back to five minutes')!.ts
  const open = await topic.messageMenu('Preview builds are back to five minutes')
  juno.win.unhover()
  await expect(plain).toHaveAttribute('data-popover-active', '')
  await open.more.click()
  await expect(open.search).toBeFocused()
  await expect(plain).toHaveAttribute('data-popover-active', '')
  await open.search.fill('rocket')
  await open.search.press('Enter')
  await expect(open.root).toHaveCount(0)
  await expect(plain).not.toHaveAttribute('data-popover-active')
  await expect(plain.getByRole('button', { name: '1 🚀, including you' })).toBeVisible()
  await expect.poll(() => (fake.messages('C0ENG').find((m) => m.ts === plainTs)?.reactions ?? []).some((r) => r.name === 'rocket')).toBe(true)
}

async function quoteMessage({ juno, fake }: Context): Promise<void> {
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

  // Select "retry for 30 minutes".
  const text = row.locator('[data-msg-text] p').first()
  await selectWords(text, 'retry for 30 minutes')
  const quote = juno.win.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Quote' })
  await expect(quote).toBeVisible()
  await quote.click()
  await expect(topic.composer).toHaveValue('> retry for 30 minutes\n')
  await expect(quote).toHaveCount(0)
  await topic.composer.fill('')

  // With words selected in the message, its menu copies and quotes only them, and the selection's bar steps aside.
  await selectWords(text, 'nothing gets dropped')
  await expect(quote).toBeVisible()
  const menu = await topic.messageMenu('Billing webhooks retry')
  await expect(quote).toHaveCount(0)
  expect(await menu.labels()).toContain('Copy')
  await menu.choose('quote')
  await expect(topic.composer).toHaveValue('> nothing gets dropped\n')
}

async function menuActions({ juno, fake, step }: Context): Promise<void> {
  await juno.topic.composer.fill('')
  const { topic } = juno
  await step('Edit and Delete… from the message menu', async () => {
    const ts = await sendOwn(juno, fake, 'Retro at 3')

    const row = topic.message('Retro at 3')
    const menu = await topic.messageMenu('Retro at 3')
    juno.win.unhover()
    await expect(row).toHaveAttribute('data-popover-active', '')
    // Your own message's menu ends with Edit and Delete…; message-menu.spec.ts checks a message from someone else has neither.
    // Ask Juno shows while AI assist is on.
    expect((await menu.labels()).filter((label) => label !== 'Ask Juno').slice(-2)).toEqual(['Edit', 'Delete…'])
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
  await step('a message edited elsewhere while its menu is open: Edit starts from the new text', async () => {
    const ts = await sendOwn(juno, fake, 'Standup at 10')

    const menu = await topic.messageMenu('Standup at 10')
    fake.editMessage({ channel: 'C0ENG', ts, text: 'Standup at 11' })
    await expect(topic.message('Standup at 11')).toBeVisible()
    await menu.choose('edit')

    const field = topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(field).toHaveValue('Standup at 11')
  })
}

domTest('an edit made while the message is still sending is kept, and reaches Slack once it has the message', async ({ juno, fake, step }) => {
  await openMain(juno)
  const { topic } = juno
  const field = topic.list.getByRole('textbox', { name: 'Edit message' })

  await step('an edit started while the message is sending stays open, with what was typed, when Slack takes the message', async () => {
    fake.holdNext({ method: 'chat.postMessage', before: true })
    await topic.send('Typo in thsi one')
    await expect(topic.message('Typo in thsi one')).toHaveAttribute('data-pending', 'sending')
    await topic.composer.press('ArrowUp')
    await topic.message('Typo in thsi one').press('e')
    await field.fill('Typo in this one, still typing')

    fake.release()
    await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Typo in thsi one')).toBe(true)
    await expect(topic.list.locator('[data-message-row][data-pending]')).toHaveCount(0)
    await expect(field).toHaveValue('Typo in this one, still typing')
    await expect(field).toBeFocused()
    await field.press('Enter')
    await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Typo in this one, still typing')).toBe(true)
  })

  await step('an edit saved while the message is still sending reaches Slack once it has the message', async () => {
    const updates = () => fake.calls.filter((call) => call.method === 'chat.update').length
    fake.holdNext({ method: 'chat.postMessage', before: true })
    await topic.send('Wrnog word here')
    await expect(topic.message('Wrnog word here')).toHaveAttribute('data-pending', 'sending')
    const before = updates()
    await topic.composer.press('ArrowUp')
    await juno.win.keyboard.press('e')
    await field.fill('Wrong word here')
    await field.press('Enter')
    await expect(topic.message('Wrong word here')).toBeVisible()
    expect(updates()).toBe(before)
    fake.release()
    await topic.expectSent('Wrong word here')
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Wrong word here').length).toBe(1)
    expect(fake.messages('C0ENG').some((m) => m.text === 'Wrnog word here')).toBe(false)
  })

  await step('Edit from a menu opened while the message was sending follows it once it is sent', async () => {
    fake.holdNext({ method: 'chat.postMessage', before: true })
    await topic.send('Menu during send')
    await expect(topic.message('Menu during send')).toHaveAttribute('data-pending', 'sending')
    const menu = await topic.messageMenu('Menu during send')
    fake.release()
    await topic.expectSent('Menu during send')
    await menu.choose('edit')
    await expect(field).toHaveValue('Menu during send')
    await field.fill('Edited after send')
    await field.press('Enter')
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Edited after send').length).toBe(1)
  })
})

domTest('Open thread and Start thread from Main open the message’s thread, and ⌘-click opens it in a background tab', async ({ juno, fake, step }) => {
  await openMain(juno)
  const { topic, tabs } = juno
  await step('Open thread from Main opens the message’s thread with its composer', async () => {
    const menu = await topic.messageMenu(POSTGRES)
    expect((await menu.labels())[0]).toBe('Open thread')
    await menu.choose('reply')
    await topic.expectTitle(/Postgres|Draft plan/)
    await expect(topic.composer).toHaveAttribute('aria-label', 'Reply')
  })
  // Back to Main for the next message.
  await openMain(juno)
  await step('Start thread from Main opens a new topic for the message', async () => {
    const ts = await sendOwn(juno, fake, 'A new topic from Main')
    const menu = await topic.messageMenu('A new topic from Main')
    expect((await menu.labels())[0]).toBe('Start thread')
    await menu.choose('reply')
    await topic.expectTitle(/A new topic from Main/)
    await expect(topic.composer).toHaveAttribute('aria-label', 'Reply')
    expect(fake.messages('C0ENG').find((message) => message.ts === ts)?.reply_count ?? 0).toBe(0)
  })
  await step('⌘-click Start thread in the menu opens the thread in a background tab; this tab stays', async () => {
    await openMain(juno)
    await sendOwn(juno, fake, 'A topic for later')
    await sendOwn(juno, fake, 'One more line under it')
    const active = tabs.root.getByRole('tab', { selected: true })
    const mainTab = await active.getAttribute('data-tooltip')
    const before = await tabs.titles()

    const menu = await topic.messageMenu('A topic for later')
    await menu.item('reply').click({ modifiers: ['Meta'] })
    await expect(menu.root).toHaveCount(0)
    // The thread's tab joins the strip, and this one stays active, still at Main.
    await tabs.expectCount(before.length + 1)
    await expect.poll(() => tabs.titles()).toEqual(expect.arrayContaining([expect.stringMatching(/A topic for later/)]))
    await expect(active).toHaveAttribute('data-tooltip', mainTab!)
    await topic.expectTitle('Main')

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
})
