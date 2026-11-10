// What a message does (spec section 7): edit and delete your own from the
// keyboard and the message menu; reactions from the menu's grid, the emoji
// picker it turns into and the chips, and one Slack keeps refusing; Quote,
// whole and selected; and Start or open a thread from Main. Forward… and Also
// send to #eng are in send.test.ts. Every change
// shows at once and reaches the fake Slack through the outbox, once. How the
// outbox spaces and drops tries is the engine's (outbox-reactions.flow.test.ts).
// A message's fills are the gallery's.
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import type { Query } from './query'
import { MessageMenuDriver } from './driver/topic'
import { domTest, type DomContext } from './test'

const ENG_MAIN = '#eng'
const POSTGRES = 'Draft plan is in the doc'

type Context = Pick<DomContext, 'juno' | 'fake' | 'step'>
type AppContext = Pick<DomContext, 'juno' | 'fake' | 'app'>

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

// One launch on #eng's Main: each step sends its own message, so ↑ from the composer selects the newest one.
domTest('edits, deletes, reacts, quotes and opens threads from Main', async ({ juno, fake, app, step }) => {
  await openMain(juno)
  const context = { juno, fake, step }
  await step('the keyboard: ↑ selects, E edits, Delete asks once, and E and Delete do nothing on others’ messages', () => keyboardActions(context))
  await step('reactions: a quick reaction, its chip toggled off, and one from the full picker', () => reactToMessage(context))
  await step('a custom emoji reaction shows its image from the first frame, never its :name:', () => customEmojiReaction(context))
  await step('a custom emoji added while Juno runs shows its image on a reaction', () => newCustomEmoji(context))
  await step('a reaction Slack keeps refusing stops after five tries with one toast, and Retry starts again', () => refusedReaction(context))
  await step('Quote puts the message in the composer as "> " lines; a selection quotes only itself', () => quoteMessage(context))
  await step('Edit and Delete from the menus, and Edit after the message changed elsewhere', () => menuActions(context))
  await step('Open thread and Start thread from Main open the message’s thread, and ⌘-click opens it in a background tab', () => threads(context))
  await step('an edit whose save fails while another message is being edited leaves that editor open', () => failedEditKeepsOtherEditor({ juno, fake, app }))
})

/**
 * The save of one message is still out when the user opens the editor on another; then the engine connection
 * drops, which fails the save. Only the failed edit ends: the open editor keeps its text.
 */
async function failedEditKeepsOtherEditor({ juno, fake, app }: AppContext): Promise<void> {
  await openMain(juno)
  await juno.topic.composer.fill('')
  const { topic } = juno
  await sendOwn(juno, fake, 'Deploy is at noon')
  await sendOwn(juno, fake, 'Retro is at four')
  const field = topic.list.getByRole('textbox', { name: 'Edit message' })

  // The engine's answer to the save is held, as a slow engine holds it, so the save is still out when the connection drops.
  const release = app.holdReplies('messages.edit')
  await topic.composer.press('ArrowUp')
  await juno.win.keyboard.press('ArrowUp')
  await expect(topic.message('Deploy is at noon')).toBeFocused()
  await juno.win.keyboard.press('e')
  await expect(field).toHaveValue('Deploy is at noon')
  await field.fill('Deploy is at one')
  await field.press('Enter')
  await expect(topic.composer).toBeFocused()

  await topic.composer.press('ArrowUp')
  await expect(topic.message('Retro is at four')).toBeFocused()
  await juno.win.keyboard.press('e')
  await expect(field).toHaveValue('Retro is at four')

  // The connection drops: the save out on it fails. The editor on the other message is not the failed edit's.
  const online = app.engineOffline()
  await expect.poll(() => app.connection).toBe('reconnecting')
  online()
  await expect.poll(() => app.connection).toBe('connected')
  release()
  // The edit reached the engine before the drop; its text comes back with the window, after the failure was handled.
  await expect(topic.message('Deploy is at one')).toBeVisible({ timeout: 15_000 })
  await expect(field).toHaveValue('Retro is at four')
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(topic.composer).toBeFocused()
}

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

/**
 * Regression: a custom emoji picked from the full picker showed `:juno_party:` as text on the chip until Slack echoed the
 * reaction, because the window query looked up images only for stored reactions, not for the outbox's own. The call is
 * held so the chip's pending state can be read; a recorder started before the pick catches every state in between.
 */
async function customEmojiReaction({ juno, fake }: Context): Promise<void> {
  const { topic } = juno
  const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Release notes are out for the custom reaction' })
  const row = topic.message('Release notes are out for the custom reaction')
  await expect(row).toBeVisible()
  const reactionsOf = () => fake.messages('C0ENG').find((m) => m.ts === message.ts)?.reactions ?? []
  const chip = row.locator('[data-reaction="juno_party"]')
  const chipStates: string[] = []
  const record = () => {
    const node = chip.el()
    if (node === undefined) return
    const state = node.querySelector('img') === null ? node.textContent ?? '' : `img:${node.querySelector('img')?.getAttribute('src') ?? ''}`
    if (chipStates.at(-1) !== state) chipStates.push(state)
  }
  const Observer = (juno.win.window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
  const observer = new Observer(record)
  observer.observe(row.el()!, { subtree: true, childList: true, characterData: true, attributes: true })
  try {
    fake.holdNext({ method: 'reactions.add', before: true })
    const menu = await topic.messageMenu('Release notes are out for the custom reaction')
    await menu.more.click()
    await expect(menu.search).toBeFocused()
    await menu.search.fill('juno_party')
    await menu.search.press('Enter')
    await expect(menu.root).toHaveCount(0)

    // While Slack has not answered, the chip is the outbox's own: it already shows the image.
    await expect(chip).toBeVisible()
    await expect(chip.locator('img')).toHaveAttribute('src', `${fake.url}/emoji/juno_party.svg`)
    await expect(chip).not.toContainText(':juno_party:')
    expect(reactionsOf()).toEqual([])

    fake.release()
    await expect.poll(() => reactionsOf().some((r) => r.name === 'juno_party')).toBe(true)
    await expect(chip.locator('img')).toHaveAttribute('src', `${fake.url}/emoji/juno_party.svg`)
  } finally {
    observer.disconnect()
  }
  record()
  expect(chipStates.length).toBeGreaterThan(0)
  expect(chipStates.filter((state) => state.includes(':juno_party:')), 'chip states that showed the code as text').toEqual([])
}

/** Regression: an emoji added to the workspace after the boot showed as `:name:` until the next launch. */
async function newCustomEmoji({ juno, fake }: Context): Promise<void> {
  const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'The drum fill landed' })
  const row = juno.topic.message('The drum fill landed')
  await expect(row).toBeVisible()
  fake.addEmoji({ name: 'ba-dum-tsss', url: `${fake.url}/emoji/juno_party.svg` })
  fake.addReaction({ channel: 'C0ENG', ts: message.ts, name: 'ba-dum-tsss', user: 'U0PRIYA' })
  const chip = row.locator('[data-reaction="ba-dum-tsss"]')
  await expect(chip.locator('img')).toHaveAttribute('src', `${fake.url}/emoji/juno_party.svg`)
  await expect(chip).not.toContainText(':ba-dum-tsss:')
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


async function threads({ juno, fake, step }: Context): Promise<void> {
  const { topic, tabs } = juno
  await step('Open thread from Main opens the message’s thread with its composer', async () => {
    await openMain(juno)
    await topic.chooseInMessageMenu(POSTGRES, 'reply')
    await topic.expectTitle(/Postgres|Draft plan/)
    await expect(topic.composer).toHaveAttribute('aria-label', 'Reply')
  })
  await step('Start thread from Main opens a new topic for the message', async () => {
    await openMain(juno)
    const ts = await sendOwn(juno, fake, 'A new topic from Main')
    await topic.chooseInMessageMenu('A new topic from Main', 'reply')
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
  await step('⌘-click on a message in Main opens its thread in a tab right after this one; its link and its sender keep their own', async () => {
    await openMain(juno)
    fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Retro notes are in <https://example.com/retro|the retro doc>' })
    const plain = topic.message('Retro notes are in')
    await expect(plain).toBeVisible()
    const strip = () => tabs.root.getByRole('tab').all().map((tab) => ({ title: tab.getAttribute('data-tooltip') ?? '', active: tab.getAttribute('aria-selected') === 'true' }))
    const active = () => strip().find((tab) => tab.active)?.title
    const nextToActive = () => strip()[strip().findIndex((tab) => tab.active) + 1]?.title ?? ''
    const mainTab = active()
    const before = strip().length

    // The link opens in the browser and the name opens Maya's DM behind; neither opens a thread. The DM's tab comes
    // through the same queue as a thread's would, after it, so once it shows a wrong thread tab would show too.
    await plain.getByRole('link', { name: 'the retro doc' }).click({ modifiers: ['Meta'] })
    await expect.poll(() => juno.browserLinks()).toContain('https://example.com/retro')
    await plain.getByRole('button', { name: 'Maya', exact: true }).click({ modifiers: ['Meta'] })
    await tabs.expectCount(before + 1)
    expect(strip().some((tab) => /Retro notes/.test(tab.title))).toBe(false)

    // On a message with a thread: that thread, in a new tab right after this one, which stays active at Main.
    await topic.message(POSTGRES).locator('[data-msg-text]').first().click({ modifiers: ['Meta'] })
    await tabs.expectCount(before + 2)
    await expect.poll(nextToActive).toMatch(/Postgres|Draft plan/)
    expect(active()).toBe(mainTab)
    await topic.expectTitle('Main')

    // On a message with no replies: a new thread for it, as Start thread opens one.
    await plain.locator('[data-msg-text]').first().click({ modifiers: ['Meta'] })
    await tabs.expectCount(before + 3)
    await expect.poll(nextToActive).toMatch(/Retro notes/)
    expect(active()).toBe(mainTab)
    await tabs.select('Retro notes')
    await expect(topic.composer).toHaveAttribute('aria-label', 'Reply')
  })
}

async function refusedReaction({ juno, fake }: Context): Promise<void> {
  await openMain(juno)
  const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Reaction delivery target' })
  const row = juno.topic.message('Reaction delivery target')
  await expect(row).toBeVisible()
  const sent = () => fake.messages('C0ENG').find((m) => m.ts === message.ts)?.reactions?.some((r) => r.name === 'eyes') === true
  const tries = () => fake.calls.filter((c) => c.method === 'reactions.add').length
  const before = tries()
  fake.forceError({ method: 'reactions.add', error: 'internal_error', times: 5 })
  await (await new MessageMenuDriver(juno.win).openOnRow(row)).react('eyes')
  // The "not sent yet" line between the tries lasts about a second under the test timing; the engine's outbox-reactions flow checks it.
  await expect(row.locator('[data-reaction-issue="failed"]')).toBeVisible({ timeout: 20_000 })
  await juno.expectToast('Reaction not sent')
  expect(tries() - before).toBe(5)
  await expect(row.getByRole('button', { name: '1 👀, including you' })).toHaveCount(0)
  await row.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(sent).toBe(true)
  await expect(row.locator('[data-reaction-issue]')).toHaveCount(0)
  expect(tries() - before).toBe(6)
}
