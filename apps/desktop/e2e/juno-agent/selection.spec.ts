// The open Juno panel following text highlighted in a topic, in the browser:
// which rows the selection spans is read from the page's layout, and the last
// step is a mouse drag. Ask Juno from the selection's toolbar and ⌘J with a
// selection are in the DOM lane (`dom/juno-agent/panel.test.ts`).
import type { FakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { Locator } from '@playwright/test'
import type { Juno } from '../driver/juno'
import { hooks } from '../fixtures'
import { expect, JunoChatPane, test } from './chat'

test.use({ synced: true })

test.describe.configure({ timeout: 90_000 })

const POSTGRES = 'Draft plan is in the doc'

async function ready(juno: Juno): Promise<void> {
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await juno.setWindowSize(1400)
}

/** Drags the mouse across `words` in a message, as the owner highlights them. */
async function highlight(juno: Juno, row: Locator, words: string): Promise<void> {
  const at = await row.evaluate((el, words) => {
    const walker = document.createTreeWalker(el.querySelector('[data-msg-text]')!, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const i = node.textContent!.indexOf(words)
      if (i < 0) continue
      const range = document.createRange()
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const first = range.getBoundingClientRect()
      range.setStart(node, i + words.length - 1)
      range.setEnd(node, i + words.length)
      const last = range.getBoundingClientRect()
      return { from: first.left + 1, to: last.right - 1, y: first.top + first.height / 2 }
    }
    throw new Error(`"${words}" is not in the message`)
  }, words)
  await juno.win.mouse.move(at.from, at.y)
  await juno.win.mouse.down()
  await juno.win.mouse.move(at.to, at.y, { steps: 6 })
  await juno.win.mouse.up()
  await expect.poll(() => juno.win.evaluate(() => document.getSelection()?.toString())).toBe(words)
}

test('the open panel follows later selections: ⌘J asks about them, Backspace on the chip removes it, and a drag while the field has focus gives a new chip', async ({ juno, model }) => {
  await ready(juno)
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.menu('juno')
  await followSelection(juno, model)
})

async function followSelection(juno: Juno, model: FakeOpenRouter): Promise<void> {
  const panel = JunoChatPane.panel(juno.win)
  await expect(panel.composer).toBeFocused()

  // From Dev's reply into the owner's: the open panel's chip follows the selection.
  const from = juno.topic.message('4 minutes is fine')
  const to = juno.topic.message("Good. What's the rollback")
  await from.evaluate((start, end) => {
    const text = (row: Element) => document.createTreeWalker(row.querySelector('[data-msg-text]')!, NodeFilter.SHOW_TEXT).nextNode()!
    const range = document.createRange()
    range.setStart(text(start), 0)
    range.setEnd(text(end!), 'Good'.length)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  }, await to.elementHandle())
  const chip = panel.root.locator('[data-panel-selection]')
  await expect(chip).toHaveText('2 messages: “4 minutes is fine for us…”')

  // ⌘J with the selection asks about it: the highlight clears, the panel stays, its field has focus.
  await juno.tabs.menu('juno')
  await expect.poll(() => juno.win.evaluate(() => document.getSelection()?.toString())).toBe('')
  await expect(panel.composer).toBeFocused()
  await expect(chip).toHaveText('2 messages: “4 minutes is fine for us…”')

  await chip.focus()
  await juno.win.keyboard.press('Backspace')
  await expect(chip).toHaveCount(0)
  await expect(panel.composer).toBeFocused()
  await panel.send('and now?')
  await panel.expectJuno('You said: and now?')
  expect(model.inputs().at(-1)).not.toContain('<selection')

  // A drag over a message highlights it while the panel's field has focus, and the chip takes it.
  // The press takes focus from the field; resting a few frames before moving, as a person does, must not lose the drag's start.
  // The message's first words, at the start of the line: the hover toolbar sits at its end.
  await expect(panel.composer).toBeFocused()
  await highlight(juno, juno.topic.message(POSTGRES), 'Draft plan is in the doc')
  await expect(chip).toHaveText('Leo: “Draft plan is in the doc”')
}
