// The Juno chat in the app against the fake Slack and a fake OpenRouter:
// the Juno tab, a question written on Home with its @ and # picks, and an
// answer read as it arrives. The panel beside a topic is in panel.spec.ts.
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.use({ synced: true })

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'

async function ready(juno: Juno): Promise<void> {
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
}

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

async function setWindowWidth(juno: Juno, width: number): Promise<void> {
  await juno.setWindowSize(width)
}

test('a question written on Home goes to the Juno chat with its picks, the field where Home’s was, and Back returns to Home', { tag: '@canary' }, async ({ juno, model }) => {
  await ready(juno)
  const { write, tabs } = juno
  await juno.expectNothingOpen()
  await write.expectDestination('Juno')
  await write.composer.pressSequentially('What did @Ma')
  await expect(write.suggestion('Maya')).toBeVisible()
  await write.composer.press('Enter')
  await write.composer.pressSequentially('say today?')
  const before = await write.field.boundingBox()
  await write.send()
  await tabs.expectActive('Juno')
  const chat = JunoChatPane.tab(juno.win)
  await chat.expectOwner('What did @Maya say today?')
  await chat.expectJuno('You said: What did @Maya say today?')
  expect(model.inputs().at(-1)).toBe('<message id="n1"><person id="U0MAYA" name="Maya"/>What did @Maya say today?</message>')
  const after = await chat.root.locator('[data-composer-field]').boundingBox()
  const edges = (box: typeof before) => ({ x: box?.x, width: box?.width, bottom: (box?.y ?? 0) + (box?.height ?? 0) })
  expect(edges(after)).toEqual(edges(before))
  await juno.nav.back()
  await tabs.expectActive('Home')
  await expect(write.composer).toHaveValue('')
})

test('the Juno tab sends a message at once with its @ and # picks, shows the answer, a reaction from Juno and a reply, copies a long message, and a second Juno tab shows the same chat', async ({ juno, model }) => {
  await ready(juno)
  await junoNav(juno).click()
  await juno.tabs.expectActive('Juno')
  const chat = JunoChatPane.tab(juno.win)
  await expect(chat.composer).toBeFocused()

  await test.step('a message sends at once and shows the answer', async () => {
    await chat.send('what is on today?')
    await chat.expectOwner('what is on today?')
    await chat.expectJuno('You said: what is on today?')
    expect(model.inputs().at(-1)).toBe('<message id="n1">what is on today?</message>')
  })

  await test.step('@ and # picks reach Juno by id and show as plain names', async () => {
    // @ and # use the topic composer's suggestions; Juno reads each pick's id, and the bubble shows plain names.
    await chat.composer.pressSequentially('Ask @Ma')
    await expect(chat.suggestion('Maya')).toBeVisible()
    await expect(chat.composer).toHaveAttribute('aria-activedescendant', /.+/)
    await chat.composer.press('Enter')
    await expect(chat.suggestions).toHaveCount(0)
    await expect(chat.composerChips).toHaveText(['@Maya'])
    await chat.composer.pressSequentially('about #en')
    await expect(chat.suggestion('eng')).toBeVisible()
    await chat.composer.press('Tab')
    await expect(chat.composer).toHaveValue('Ask @Maya about #eng ')
    await expect(chat.composerChips).toHaveText(['@Maya', '#eng'])
    await expect(chat.composerChips.last()).toHaveAttribute('data-mark', 'channel')
    await chat.composer.press('Enter')
    await chat.expectJuno('You said: Ask @Maya about #eng')
    expect(model.inputs().at(-1)).toBe('<message id="n2"><person id="U0MAYA" name="Maya"/><channel id="C0ENG" name="#eng"/>Ask @Maya about #eng</message>')
    const picked = chat.ownerBubble('Ask @Maya about #eng')
    await expect(picked.locator('p')).toHaveText('Ask @Maya about #eng')
    await expect(picked.locator('a, [data-person], [data-channel], [data-mark]')).toHaveCount(0)
    await expect(chat.composerChips).toHaveCount(0)
  })

  await test.step('a reaction from Juno and a reply that quotes a bubble', async () => {
    // Juno reacts to the owner: the badge sits on the owner's bubble.
    await chat.send('please react')
    await chat.expectJuno('Reacted to please react')
    await expect(chat.ownerBubble('please react').getByLabel('Reacted 🎉')).toBeVisible()

    // The owner's reactions on Juno's bubbles, from the menu's grid and the picker, are in chat-reactions.spec.ts.

    // A reply quotes the bubble in the composer and over the sent bubble, and Juno gets the bubble in full.
    await chat.reply('You said: what is on today?')
    await expect(chat.root.locator('[data-composer-quote]')).toContainText('You said: what is on today?')
    await chat.send('which one?')
    await expect(chat.ownerBubble('which one?').locator('[data-quote="bubble"]')).toContainText('You said: what is on today?')
    await expect.poll(() => model.inputs().at(-1)).toContain('<quote from="juno">You said: what is on today?</quote>which one?')
  })

  await test.step('bold from the model shows with no markup', async () => {
    // Markdown bold and the HTML bold models write both show as bold words, with no markup on screen.
    await chat.send('show formatting')
    const rich = chat.junoBubble('Staging is green, and deploys run at 14:00.')
    await expect(rich).toBeVisible({ timeout: 15_000 })
    await expect(rich.locator('strong')).toHaveText(['Staging', 'deploys'])
    await expect(rich.locator('strong').first()).toHaveCSS('font-weight', '600')
    await expect(rich).not.toContainText('<')
    await expect(rich).not.toContainText('*')
  })

  await test.step('Copy puts all of a long message on the clipboard', async () => {
    // Copy in a message's menu puts all of a long message on the clipboard: over the old 2048-character
    // limit and like a long Slack message, 5,000 characters of plain words.
    const long = 'Notes for the copy check, one line of many. '.repeat(114).slice(0, 5_000).trim()
    await chat.send(long)
    await chat.expectOwner(long.slice(0, 200))
    await (await chat.menu(long.slice(0, 200), { owner: true })).choose('copy')
    await expect.poll(() => juno.clipboard()).toBe(long)
    await expect(juno.win.getByText('Could not copy')).toHaveCount(0)
  })

  await test.step('a second Juno tab shows the same chat', async () => {
    // ⌘-click opens a second Juno tab with the one chat: a message sent in one shows in both.
    await junoNav(juno).click({ modifiers: ['Meta'] })
    await expect(juno.tabs.tab('Juno')).toHaveCount(2)
    await juno.tabs.expectActiveAt('Juno', 1)
    await chat.send('sent from the second tab')
    await chat.expectOwner('sent from the second tab')
    await chat.expectJuno('You said: sent from the second tab')
    await juno.tabs.selectAt('Juno', 0)
    await juno.tabs.expectActiveAt('Juno', 0)
    await chat.expectOwner('sent from the second tab')
    await chat.expectJuno('You said: sent from the second tab')
    // A plain click focuses the Juno tab active last.
    await juno.tabs.selectAt('Juno', 1)
    await junoNav(juno).click()
    await juno.tabs.expectActiveAt('Juno', 1)
    await expect(juno.tabs.tab('Juno')).toHaveCount(2)
  })
})

test('an answer that arrives while the chat is on screen in the focused window is read, with no "new" divider', async ({ juno }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)
  expect(await juno.win.evaluate(() => document.hasFocus())).toBe(true)
  // Records any "new" divider that shows in a Juno chat, even for a frame.
  await juno.win.evaluate(() => {
    const seen = window as unknown as { dividerSeen: boolean }
    seen.dividerSeen = false
    new MutationObserver(() => {
      if (document.querySelector('[data-juno-chat] [data-new-divider]') !== null) seen.dividerSeen = true
    }).observe(document.body, { childList: true, subtree: true })
  })
  const dividerSeen = () => juno.win.evaluate(() => (window as unknown as { dividerSeen: boolean }).dividerSeen)
  const count = juno.win.getByTitle(/unread from Juno$/)

  await junoNav(juno).click()
  const tab = JunoChatPane.tab(juno.win)
  await tab.send('what is on today?')
  await tab.expectJuno('You said: what is on today?')
  await expect(count).toHaveCount(0)
  expect(await dividerSeen()).toBe(false)

  // The panel beside a topic too.
  await juno.sidebar.row(POSTGRES).open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await panel.send('and tomorrow?')
  await panel.expectJuno('You said: and tomorrow?')
  await expect(count).toHaveCount(0)

  // Read, so the chat opens again at the bottom with no divider.
  await junoNav(juno).click()
  await tab.expectJuno('You said: and tomorrow?')
  expect(await dividerSeen()).toBe(false)
})
