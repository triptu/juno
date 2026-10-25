// The Juno chat in the browser: a question written on Home with its @ and #
// picks, which insert with execCommand, and where the field lands; and an
// answer read as it arrives, which an IntersectionObserver decides. The rest
// of the Juno tab is in the DOM lane (`dom/juno-agent/chat.test.ts`).
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

test('a question written on Home goes to the Juno chat with its picks, the field where Home’s was, and Back returns to Home; the Juno tab takes @ and # picks too', async ({ juno, model }) => {
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
  // After the answer nothing on screen moves.
  await juno.expectAtRest()
  expect(model.inputs().at(-1)).toBe('<message id="n1"><person id="U0MAYA" name="Maya"/>What did @Maya say today?</message>')
  const after = await chat.root.locator('[data-composer-field]').boundingBox()
  const edges = (box: typeof before) => ({ x: box?.x, width: box?.width, bottom: (box?.y ?? 0) + (box?.height ?? 0) })
  expect(edges(after)).toEqual(edges(before))
  await juno.nav.back()
  await tabs.expectActive('Home')
  await expect(write.composer).toHaveValue('')

  // The Juno tab's composer takes the same picks (they insert with execCommand, which happy-dom lacks).
  await junoNav(juno).click()
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
