// The Juno tab against the fake Slack and a fake OpenRouter, its bubbles from the keyboard, and the
// header's switcher (SPEC 13.10) with Activity (13.9) in the panel and the tab. A question written on Home, the @ and
// # picks (they insert with execCommand) and an answer read as it arrives (an IntersectionObserver)
// are in `e2e/juno-agent/panel.spec.ts`; the panel beside a topic is in panel.test.ts.
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { answer } from '../../e2e/juno-agent/model'
import { JunoChatPane, readySynced } from '../driver/agent'
import { MessageMenuDriver } from '../driver/topic'
import type { Juno } from '../driver/juno'
import { expect } from '../expect'
import { domTest } from '../test'

const model = () => startFakeOpenRouter({ answer })

const TOPIC = 'Draft plan is in the doc'

const junoNav = (juno: Juno) => juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ })

domTest('the Juno tab sends at once, shows answers, reactions and replies, copies a long message, reacts from the keyboard, shows one chat in two tabs, and its switcher moves between the chat and Activity', async ({ juno, model, step }) => {
  await readySynced(juno)
  await junoNav(juno).click()
  await juno.tabs.expectActive('Juno')
  const chat = JunoChatPane.tab(juno.win)
  await expect(chat.composer).toBeFocused()

  await step('the keyboard reaches a bubble, ⇧F10 opens its menu, and the menu’s keys react', async () => {
    await junoNav(juno).click()
    await expect(chat.composer).toBeFocused()
    await chat.send('keyboard menu target')
    await chat.expectJuno('You said: keyboard menu target')

    // ↑ in the empty composer: the newest bubble; ↑ again: your own before it; ↓ twice: the newest, then back to
    // the composer; Esc from a bubble: back to the composer too.
    await chat.composer.press('ArrowUp')
    const bubble = chat.junoBubble('You said: keyboard menu target').locator('[data-chat-row]')
    await expect(bubble).toBeFocused()
    await juno.win.keyboard.press('ArrowUp')
    await expect(chat.ownerBubble('keyboard menu target').locator('[data-chat-row]')).toBeFocused()
    await juno.win.keyboard.press('ArrowDown')
    await expect(bubble).toBeFocused()
    await juno.win.keyboard.press('ArrowDown')
    await expect(chat.composer).toBeFocused()
    await chat.composer.press('ArrowUp')
    await juno.win.keyboard.press('ArrowUp')
    await juno.win.keyboard.press('Escape')
    await expect(chat.composer).toBeFocused()
    // ⇧F10 on the bubble: its menu.
    await chat.composer.press('ArrowUp')
    await expect(bubble).toBeFocused()
    await juno.win.keyboard.press('Shift+F10')
    const menu = new MessageMenuDriver(juno.dom)
    await expect(menu.root).toBeVisible()
    // ↓ to the grid's first cell, Enter reacts with it; focus goes back to the bubble.
    await juno.win.keyboard.press('ArrowDown')
    await expect(menu.cell('+1')).toBeFocused()
    await juno.win.keyboard.press('Enter')
    await expect(menu.root).toHaveCount(0)
    await expect(chat.junoBubble('You said: keyboard menu target').getByLabel('Reacted 👍')).toBeVisible()
    await expect(bubble).toBeFocused()
  })

  await step('a message sends at once and shows the answer', async () => {
    await chat.send('what is on today?')
    await chat.expectOwner('what is on today?')
    await chat.expectJuno('You said: what is on today?')
    expect(model.inputs().at(-1)).toMatch(/^<message id="n\d+">what is on today\?<\/message>$/)
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

  await step('the panel switches to Activity and back in place, a run says what started it, what it read and what it did, and in the Juno tab Back and Forward walk the switches', async () => {
    await juno.sidebar.row(TOPIC).open()
    await juno.tabs.menu('juno')
    const panel = JunoChatPane.panel(juno.win)
    await panel.send('what is on today in this topic?')
    await panel.expectJuno('You said: what is on today in this topic?')

    // The switcher names the chat, and Activity opens in the panel: the topic stays beside it.
    const header = juno.win.locator('aside[data-juno-panel] [data-juno-header]')
    await expect(header.getByRole('button', { name: 'Juno', exact: true })).toBeVisible()
    await switchTo(juno, 'aside[data-juno-panel]', 'Activity')
    await expect(juno.win.locator('aside[data-juno-panel] [data-juno-header="activity"]')).toBeVisible()
    await expect(header.getByRole('button', { name: 'Juno · Activity' })).toBeVisible()
    await juno.topic.expectTitle(TOPIC)

    // One row per run: the message's words, not "You"; what it read by name and how it ended; the model, quietly.
    const run = juno.win.locator('aside[data-juno-panel] [data-activity-run]').first()
    await expect(run.locator('[data-activity-trigger="message"]')).toHaveText('what is on today in this topic?')
    await expect(run.locator('[data-activity-summary]')).toHaveText(`Read ${TOPIC} · Replied`)
    await expect(run.locator('[data-activity-usage]')).not.toBeEmpty()

    // A click opens it in place, with the line for a run that read outside content.
    await run.getByRole('button', { expanded: false }).click()
    await expect(run.getByRole('button', { expanded: true })).toBeVisible()
    await expect(run.locator('[data-activity-tainted]')).toBeVisible()

    // Back to the chat, from the same place.
    await switchTo(juno, 'aside[data-juno-panel]', 'Chat')
    await panel.expectJuno('You said: what is on today in this topic?')
    await expect(juno.win.locator('aside[data-juno-panel] [data-juno-header="chat"]')).toBeVisible()
    await juno.topic.expectTitle(TOPIC)

    // In the Juno tab the switcher moves within the tab, and each move is a history entry.
    await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
    await chat.send('hello there')
    await chat.expectJuno('You said: hello there')

    await switchTo(juno, 'main', 'Activity')
    await juno.tabs.expectActive('Activity')
    await expect(juno.win.locator('main [data-activity-run] [data-activity-trigger]').filter({ hasText: 'hello there' })).toBeVisible()
    // Every Juno page has the same switcher in the same place.
    await switchTo(juno, 'main', 'Scheduled')
    await juno.tabs.expectActive('Scheduled')
    await expect(juno.win.locator('main [data-juno-header="scheduled"]')).toBeVisible()

    await juno.nav.back()
    await juno.tabs.expectActive('Activity')
    await juno.nav.back()
    await chat.expectJuno('You said: hello there')
    await juno.nav.forward()
    await juno.tabs.expectActive('Activity')
    await switchTo(juno, 'main', 'Chat')
    await chat.expectJuno('You said: hello there')
  })
}, { model, timeout: 120_000 })

/** Picks `label` from the switcher of the Juno header inside `where`. */
async function switchTo(juno: Juno, where: 'aside[data-juno-panel]' | 'main', label: string): Promise<void> {
  await juno.win.locator(`${where} [data-juno-header] button[aria-haspopup="menu"]`).click()
  await juno.win.getByRole('menu', { name: 'Juno pages' }).getByRole('menuitem', { name: label, exact: true }).click()
}
