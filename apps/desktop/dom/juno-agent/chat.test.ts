// The Juno tab against the fake Slack and a fake OpenRouter. A question written on Home, the @ and
// # picks (they insert with execCommand) and an answer read as it arrives (an IntersectionObserver)
// are in `e2e/juno-agent/chat.spec.ts`; the panel beside a topic is in panel.test.ts.
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { answer } from '../../e2e/juno-agent/model'
import { JunoChatPane, readySynced } from '../driver/agent'
import type { Juno } from '../driver/juno'
import { expect } from '../expect'
import { domTest } from '../test'

const model = () => startFakeOpenRouter({ answer })

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

domTest('the Juno tab sends a message at once, shows the answer, a reaction from Juno and a reply, copies a long message, and a second Juno tab shows the same chat', async ({ juno, model, step }) => {
  await readySynced(juno)
  await junoNav(juno).click()
  await juno.tabs.expectActive('Juno')
  const chat = JunoChatPane.tab(juno.win)
  await expect(chat.composer).toBeFocused()

  await step('a message sends at once and shows the answer', async () => {
    await chat.send('what is on today?')
    await chat.expectOwner('what is on today?')
    await chat.expectJuno('You said: what is on today?')
    expect(model.inputs().at(-1)).toBe('<message id="n1">what is on today?</message>')
  })

  await step('a reaction from Juno and a reply that quotes a bubble', async () => {
    // Juno reacts to the owner: the badge sits on the owner's bubble.
    await chat.send('please react')
    await chat.expectJuno('Reacted to please react')
    await expect(chat.ownerBubble('please react').getByLabel('Reacted 🎉')).toBeVisible()

    // A reply quotes the bubble in the composer and over the sent bubble, and Juno gets the bubble in full.
    await chat.reply('You said: what is on today?')
    await expect(chat.root.locator('[data-composer-quote]')).toContainText('You said: what is on today?')
    await chat.send('which one?')
    await expect(chat.ownerBubble('which one?').locator('[data-quote="bubble"]')).toContainText('You said: what is on today?')
    await expect.poll(() => model.inputs().at(-1)).toContain('<quote from="juno">You said: what is on today?</quote>which one?')
  })

  await step('bold from the model shows with no markup', async () => {
    // Markdown bold and the HTML bold models write both show as bold words, with no markup on screen.
    await chat.send('show formatting')
    const rich = chat.junoBubble('Staging is green, and deploys run at 14:00.')
    await expect(rich).toBeVisible({ timeout: 15_000 })
    await expect(rich.locator('strong')).toHaveText(['Staging', 'deploys'])
    await expect(rich).not.toContainText('<')
    await expect(rich).not.toContainText('*')
  })

  await step('Copy puts all of a long message on the clipboard', async () => {
    // Over the old 2048-character limit and like a long Slack message, 5,000 characters of plain words.
    const long = 'Notes for the copy check, one line of many. '.repeat(114).slice(0, 5_000).trim()
    await chat.send(long)
    await chat.expectOwner(long.slice(0, 200))
    await (await chat.menu(long.slice(0, 200), { owner: true })).choose('copy')
    await expect.poll(() => juno.clipboard()).toBe(long)
    await expect(juno.win.getByText('Could not copy')).toHaveCount(0)
  })

  await step('a second Juno tab shows the same chat', async () => {
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
}, { model, timeout: 90_000 })
