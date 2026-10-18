import { expect, test, type Page } from '@playwright/test'

const log = (page: Page) => page.locator('[data-activation-log]')
const note = (page: Page) => page.locator('[data-memory-doc="people"] [data-memory-entry]').first()
const field = (page: Page) => page.getByRole('textbox', { name: 'Note' })

/** Edit shows while the pointer is on the row (`revealTrailing`). */
async function startEdit(page: Page) {
  await note(page).hover()
  await note(page).getByRole('button', { name: /^Edit / }).click()
}

/**
 * Editing a note on What Juno remembers (SPEC 13.8), at the panel's 360px:
 * the field wraps and opens at the note's full height, Return saves,
 * Shift+Return adds a line, ⌘Return saves and Escape cancels.
 */
test.describe('editing a note', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/MemoryDocsPage?__state=behaviour/edit-keys')
    await expect(note(page)).toBeVisible()
  })

  test('shows the whole of a long note, wrapped, with nothing to scroll', async ({ page }) => {
    const text = await note(page).locator('[dir="auto"]').first().innerText()
    await startEdit(page)
    await expect(field(page)).toBeFocused()
    await expect(field(page)).toHaveValue(text)
    const box = await field(page).evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }))
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight)
    // Wrapped onto more than one line.
    expect(box.clientHeight).toBeGreaterThan(60)
  })

  test('Shift+Return adds a line and Return saves', async ({ page }) => {
    await startEdit(page)
    await field(page).press('Shift+Enter')
    await field(page).pressSequentially('Out on Fridays.')
    await expect(field(page)).toHaveValue(/\nOut on Fridays\.$/)
    await field(page).press('Enter')
    await expect(log(page)).toHaveText('save')
    await expect(field(page)).toHaveCount(0)
    // The saved note keeps its line break.
    await expect.poll(() => note(page).locator('[dir="auto"]').first().innerText()).toMatch(/\nOut on Fridays\.$/)
  })

  test('⌘Return saves too', async ({ page }) => {
    await startEdit(page)
    await field(page).press('Meta+Enter')
    await expect(log(page)).toHaveText('save')
    await expect(field(page)).toHaveCount(0)
  })

  test('Escape cancels and keeps the note as it was', async ({ page }) => {
    const before = await note(page).locator('[dir="auto"]').first().innerText()
    await startEdit(page)
    await field(page).pressSequentially(' Draft.')
    await field(page).press('Escape')
    await expect(log(page)).toHaveText('cancel')
    await expect(field(page)).toHaveCount(0)
    await expect(note(page).locator('[dir="auto"]').first()).toHaveText(before)
  })

  test('Return on an empty draft does nothing', async ({ page }) => {
    await startEdit(page)
    await field(page).fill('')
    await field(page).press('Enter')
    await expect(field(page)).toHaveValue('')
    await expect(log(page)).not.toHaveText('save')
  })
})
