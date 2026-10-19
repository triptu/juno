// The text menu (SPEC 15, "Feels native"): main opens the macOS menu of Cut,
// Copy, Paste and spelling on fields and selected text that no Juno menu took.
import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

/** Where the field's first word is: its padding, then half a line down. */
function firstWord(field: Locator): Promise<{ readonly x: number; readonly y: number }> {
  return field.evaluate((element) => {
    const style = getComputedStyle(element)
    const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2
    return { x: Number.parseFloat(style.paddingLeft) + 8, y: Number.parseFloat(style.paddingTop) + line / 2 }
  })
}

const EDIT_ITEMS = ['Cut', 'Copy', 'Paste', 'Paste and Match Style', 'Select All']

/** A menu's labels whether on or off: the test seam writes an off item as "(label)". */
const names = (labels: ReadonlyArray<string>): string[] => labels.map((label) => label.replace(/^\((.*)\)$/, '$1'))

// One topic for the three menus. Each step starts with an empty composer; the last counts menus from its own baseline.
test('the text menu on the composer and selected text in #eng', async ({ juno }) => {
  await juno.sidebar.row('#eng').open()

  await test.step('the composer has Cut, Copy and Paste, and Paste pastes', () => pasteFromTheMenu(juno))
  await test.step('a misspelled word offers guesses, and picking one replaces it', () => pickASpellingGuess(juno))
  await test.step("Juno's own menus win over the text menu, with text selected", () => junoMenusWin(juno))
})

async function pasteFromTheMenu(juno: Juno): Promise<void> {
  const composer = juno.topic.composer
  await composer.fill('Hello ')
  await juno.topic.caretToEnd()
  await juno.app.evaluate(({ clipboard }) => clipboard.writeText('from the menu'))

  await juno.chooseNextMenuItem('paste')
  const box = await composer.boundingBox()
  // Past the end of the text, so nothing is selected.
  const point = { x: box!.width - 24, y: (await firstWord(composer)).y }
  await composer.click({ button: 'right', position: point })
  const menu = await juno.lastMenu()
  // Nothing is selected, so Cut and Copy are off.
  expect(menu.labels).toEqual(['(Cut)', '(Copy)', 'Paste', 'Paste and Match Style', 'Select All'])
  // It opens where the right-click was.
  expect(Math.abs(menu.at!.x - (box!.x + point.x))).toBeLessThanOrEqual(1)
  expect(Math.abs(menu.at!.y - (box!.y + point.y))).toBeLessThanOrEqual(1)
  await expect(composer).toHaveValue('Hello from the menu')
}

async function pickASpellingGuess(juno: Juno): Promise<void> {
  const composer = juno.topic.composer
  await composer.fill('')
  await composer.click()
  await composer.pressSequentially('teh fix ')
  const word = await firstWord(composer)

  // Chromium marks the word a moment after it is typed (on Linux once its dictionary has loaded).
  await expect
    .poll(
      async () => {
        await juno.chooseNextMenuItem(null)
        await composer.click({ button: 'right', position: word })
        return (await juno.lastMenu()).labels
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toContain('Learn Spelling')
  const { labels } = await juno.lastMenu()
  expect(labels).toContain('the')
  // Guesses come first, then Learn Spelling, then the edit items.
  expect(labels.indexOf('the')).toBeLessThan(labels.indexOf('Learn Spelling'))
  // Paste is off when the clipboard is empty, so ignore whether each is on.
  expect(names(labels.slice(-5))).toEqual(EDIT_ITEMS)

  await juno.chooseNextMenuItem('replace:the')
  await composer.click({ button: 'right', position: word })
  await juno.lastMenu()
  await expect(composer).toHaveValue('the fix ')
}

async function junoMenusWin(juno: Juno): Promise<void> {
  const composer = juno.topic.composer
  await composer.fill('')
  const text = 'Words to select in a message'
  await juno.topic.send(text)
  await juno.topic.expectSent(text)
  const words = juno.topic.message(text).getByText(text)
  const selected = () => juno.win.evaluate(() => window.getSelection()?.toString() ?? '')
  const asked = await juno.menusAsked()

  // The message menu, on its selected text.
  await words.selectText()
  const message = await juno.topic.chooseInMessageMenu(text, null)
  expect(message.labels).toContain('Copy Slack link')
  expect(message.labels).not.toContain('Paste')

  // A tab's menu, and a sidebar row's, while the message text stays selected.
  await words.selectText()
  expect(await selected()).toContain(text)
  await juno.chooseNextMenuItem(null)
  await juno.tabs.tab('eng').click({ button: 'right' })
  expect((await juno.lastMenu()).labels).toContain('Close tab')

  await words.selectText()
  await juno.chooseNextMenuItem(null)
  await juno.sidebar.row('#eng').root.click({ button: 'right', position: { x: 40, y: 20 } })
  expect((await juno.lastMenu()).labels).toContain('Open in new tab')

  // Then the composer's text menu. Main takes right-clicks in order, so a text
  // menu opened by any of the three above would be counted before this one.
  await juno.chooseNextMenuItem(null)
  await juno.topic.composer.click({ button: 'right' })
  expect(names((await juno.lastMenu()).labels)).toEqual(EDIT_ITEMS)
  expect((await juno.menusAsked()) - asked).toBe(4)
}
