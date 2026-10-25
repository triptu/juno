// Reactions in the Juno chat (SPEC 13.1) from the keyboard: arrows reach a bubble, ⇧F10 opens its
// menu, and its grid reacts. The pointer's reactions, the emoji picker (a virtual list), the badges
// at every width and theme, and ↑ through a draft's lines are layout, in
// `e2e/juno-agent/chat-reactions.spec.ts`.
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { answer } from '../../e2e/juno-agent/model'
import { JunoChatPane, readySynced } from '../driver/agent'
import { MessageMenuDriver } from '../driver/topic'
import { expect } from '../expect'
import { domTest } from '../test'

domTest('the keyboard reaches a bubble, ⇧F10 opens its menu, and the menu’s keys react', async ({ juno }) => {
  await readySynced(juno)
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const chat = JunoChatPane.tab(juno.win)
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
  expect(await menu.labels()).toEqual(['Reply', 'Copy', '-', 'Remove…'])
  // ↓ to the grid's first cell, Enter reacts with it; focus goes back to the bubble.
  await juno.win.keyboard.press('ArrowDown')
  await expect(menu.cell('+1')).toBeFocused()
  await juno.win.keyboard.press('Enter')
  await expect(menu.root).toHaveCount(0)
  await expect(chat.junoBubble('You said: keyboard menu target').getByLabel('Reacted 👍')).toBeVisible()
  await expect(bubble).toBeFocused()
}, { model: () => startFakeOpenRouter({ answer }) })
