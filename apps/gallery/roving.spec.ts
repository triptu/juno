import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Widgets that are one Tab stop (roving tabindex): the message hover toolbar
 * and the radio groups of the view sheet and the channel icon picker. Tab
 * reaches one item and leaves on the next press; the arrows, Home and End
 * move inside; a radio group's arrows choose as they move.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

const focusedName = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')

test('the hover toolbar is one Tab stop: arrows, Home and End move along it, and Tab leaves it', async ({ page }) => {
  await open(page, 'HoverToolbar', 'where/main')
  const toolbar = page.getByRole('toolbar', { name: 'Message actions' })
  await expect(toolbar.locator('button[tabindex="0"]')).toHaveCount(1)
  await toolbar.getByRole('button', { name: 'React 👍' }).focus()
  await page.keyboard.press('ArrowRight')
  expect(await focusedName(page)).toBe('React ✅')
  await page.keyboard.press('End')
  expect(await focusedName(page)).toBe('More')
  await page.keyboard.press('ArrowRight')
  expect(await focusedName(page)).toBe('React 👍')
  await page.keyboard.press('ArrowLeft')
  expect(await focusedName(page)).toBe('More')
  await page.keyboard.press('Home')
  expect(await focusedName(page)).toBe('React 👍')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  expect(await focusedName(page)).toBe('Start thread')
  // The button last focused is the stop, and Tab leaves the toolbar.
  await expect(toolbar.locator('button[tabindex="0"]')).toHaveCount(1)
  await expect(toolbar.locator('button[tabindex="0"]')).toHaveAttribute('aria-label', 'Start thread')
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('[role="toolbar"]') === null)).toBe(true)
})

test('Esc in the toolbar goes back to its message', async ({ page }) => {
  await open(page, 'Message', 'interaction/focus')
  await page.getByRole('toolbar', { name: 'Message actions' }).getByRole('button', { name: 'Quote' }).focus()
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-message-row'))).toBe(true)
})

test('the channel icon picker: each group is one Tab stop on its choice, and the arrows choose', async ({ page }) => {
  await open(page, 'ChannelIconPicker', 'interactive/live')
  const colours = page.getByRole('radiogroup', { name: 'Colour' })
  const icons = page.getByRole('radiogroup', { name: 'Icon' })
  await expect(colours.locator('[tabindex="0"]')).toHaveCount(1)
  await expect(icons.locator('[tabindex="0"]')).toHaveCount(1)
  await expect(colours.getByRole('radio', { checked: true })).toHaveAttribute('tabindex', '0')
  await expect(colours.locator('[aria-pressed]')).toHaveCount(0)

  const chosen = icons.getByRole('radio', { checked: true })
  const before = await chosen.getAttribute('aria-label')
  await chosen.focus()
  await page.keyboard.press('ArrowRight')
  const after = icons.getByRole('radio', { checked: true })
  await expect(after).not.toHaveAttribute('aria-label', before ?? '')
  await expect(after).toBeFocused()
  await page.keyboard.press('Home')
  await expect(icons.getByRole('radio', { name: 'First letter' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(icons.getByRole('radio', { checked: true })).toBeFocused()
  await expect(icons.getByRole('radio', { name: 'First letter' })).toHaveAttribute('aria-checked', 'false')
})

test('the view sheet: Icon and Colour are radio groups with one Tab stop each', async ({ page }) => {
  await open(page, 'Sidebar', 'views/sheet-edit')
  for (const name of ['Icon', 'Colour']) {
    const group = page.getByRole('radiogroup', { name })
    await expect(group.locator('[tabindex="0"]')).toHaveCount(1)
    await expect(group.getByRole('radio', { checked: true })).toHaveAttribute('tabindex', '0')
    await expect(group.locator('[aria-pressed]')).toHaveCount(0)
  }
})
