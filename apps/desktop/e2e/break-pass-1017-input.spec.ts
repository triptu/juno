// Break pass of 10-17: typing and the keyboard on Home, the composers and
// the edit field, and dark mode. Findings are in
// docs/reviews/2026-10-17-break-pass.md.
import { SELF_ID } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'

test('Home works from the keyboard alone: ⌘N, pick with Enter, write, Shift Tab to the chip, send', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  // ⌘N opens Home's destination list with its search focused.
  await juno.tabs.menu('new-message')
  await expect(juno.write.search).toBeFocused()
  await juno.win.keyboard.type('eng')
  await expect(juno.write.option('eng')).toBeVisible()
  await juno.win.keyboard.press('Enter')
  await juno.write.expectDestination('#eng')
  await expect(juno.write.composer).toBeFocused()
  await juno.win.keyboard.type('Keyboard only')
  // Shift Tab reaches the chip (Attach files is out of the Tab order); Enter opens its list, Esc goes back to the chip without a change.
  await juno.win.keyboard.press('Shift+Tab')
  await expect(juno.write.chip).toBeFocused()
  await juno.win.keyboard.press('Enter')
  await expect(juno.write.search).toBeFocused()
  await juno.win.keyboard.press('Escape')
  await expect(juno.write.chip).toBeFocused()
  await juno.write.expectDestination('#eng')
  await expect(juno.write.composer).toHaveValue('Keyboard only')
  await juno.write.composer.focus()
  await juno.win.keyboard.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Keyboard only').length).toBe(1)
  await juno.tabs.expectActive('Home')
})

test('dark mode leaves no light surface on Home, the switcher and Settings', async ({ juno, fake }) => {
  for (let i = 0; i < 6; i++) fake.injectMessage({ channel: 'C0ENG', user: SELF_ID, text: `Frequent send ${i}` })
  await juno.signIn()
  await juno.waitForSync()
  await juno.setTheme('Dark')
  const lightSurfaces = () =>
    juno.win.evaluate(() => {
      const light: string[] = []
      for (const element of document.querySelectorAll<HTMLElement>('body *')) {
        // Rows off screen skip style (content-visibility), and hidden actions are at opacity 0.
        if (!element.checkVisibility({ opacityProperty: true, contentVisibilityAuto: true })) continue
        const match = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(getComputedStyle(element).backgroundColor)
        if (match === null || (match[4] !== undefined && Number(match[4]) < 0.5)) continue
        const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
        if (0.2126 * r + 0.7152 * g + 0.0722 * b > 200) light.push(`${element.tagName.toLowerCase()} "${element.getAttribute('aria-label') ?? element.textContent?.slice(0, 30)}" ${match[0]} in ${element.parentElement?.closest('[aria-label]')?.getAttribute('aria-label')}`)
      }
      return light
    })
  await expect(juno.write.recent.getByRole('button').first()).toBeVisible()
  expect(await lightSurfaces()).toEqual([])
  await juno.write.chip.click()
  await expect(juno.write.list).toBeVisible()
  expect(await lightSurfaces()).toEqual([])
  await juno.win.keyboard.press('Escape')
  await juno.sidebar.row('#eng').open()
  await juno.topic.openSwitcher()
  expect(await lightSurfaces()).toEqual([])
  await juno.win.keyboard.press('Escape')
  await juno.openSettings('General')
  expect(await lightSurfaces()).toEqual([])
})

test('Enter right after typing in the destination search picks the match', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.menu('new-message')
  // As a person types once the list shows its search.
  await expect(juno.write.search).toBeFocused()
  await juno.win.keyboard.type('eng')
  await juno.win.keyboard.press('Enter')
  await juno.write.expectDestination('#eng')
  await expect(juno.write.composer).toBeFocused()
  await juno.win.keyboard.type('Typed fast')
  await juno.win.keyboard.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Typed fast').length).toBe(1)
  // ⌘N used the launch tab's Home: one tab, empty again.
  await juno.tabs.expectCount(1)
  await expect(juno.write.composer).toHaveValue('')
})

test('the inline edit field suggests emoji, and Esc there closes the list, not the edit', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.topic.send('Edit with emoji')
  await juno.topic.expectSent('Edit with emoji')
  await juno.topic.chooseInMessageMenu('Edit with emoji', 'edit')
  const edit = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(edit).toBeFocused()
  await edit.pressSequentially(' :tad')
  const list = juno.win.getByRole('listbox', { name: 'Emoji' })
  await expect(list).toBeVisible()
  await expect(list).toBeInViewport({ ratio: 1 })
  await edit.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(edit).toBeVisible()
  await expect(edit).toHaveValue('Edit with emoji :tad')
  // As in the composer, the list stays closed for that word; written again, it opens.
  for (let i = 0; i < 4; i++) await edit.press('Backspace')
  await edit.pressSequentially(':tada')
  await expect(list).toBeVisible()
  await edit.press('Enter')
  await expect(edit).toHaveValue('Edit with emoji 🎉 ')
  await edit.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === 'Edit with emoji 🎉')).toBe(true)
})

test(':thumbs offers 👍 first, before any recent use', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.composer.pressSequentially(':thumbs')
  await expect(juno.topic.suggestions.getByRole('option').first()).toHaveAccessibleName(':thumbsup:')
  await juno.topic.composer.press('Enter')
  await expect(juno.topic.composer).toHaveValue('👍 ')
})
