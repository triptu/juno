// Menus and lists built on OptionList have one active row, as a native menu
// does: the pointer and the arrow keys move the same highlight, and no row
// keeps a hover highlight of its own beside it.
import type { Locator, Page } from '@playwright/test'
import type { Juno } from './driver/juno'
import { expect, syncedTest as test } from './fixtures'

test.describe.configure({ timeout: 60_000 })

/** The names of the rows drawn highlighted: any row with a background. */
function highlighted(list: Locator): Promise<string[]> {
  return list.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"]')]
      .filter((row) => getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)')
      .map((row) => row.textContent ?? ''),
  )
}

test('the avatar menu and the palette have one active row under the pointer and the arrow keys, and menu triggers open on press', async ({ juno, win }) => {
  await test.step('the avatar menu has one active item: hover, then the keyboard, then hover again', async () => {
    const { accountMenu } = juno
    await accountMenu.open()
    // The menu opens centred under the avatar (inventory 2.1), not off to its left.
    const avatar = await win.locator('aside [aria-label="Account and settings"]').boundingBox()
    const menu = await accountMenu.root.boundingBox()
    expect(Math.abs(menu!.x + menu!.width / 2 - (avatar!.x + avatar!.width / 2))).toBeLessThanOrEqual(1)
    expect(menu!.y).toBeGreaterThan(avatar!.y + avatar!.height)
    const list = accountMenu.root.getByRole('menu', { name: 'Account' })
    const notifications = accountMenu.item(/^Notifications/)

    await notifications.hover()
    await expect.poll(() => highlighted(list)).toEqual([expect.stringMatching(/^Notifications/)])
    await expect(list).toHaveAttribute('aria-activedescendant', (await notifications.getAttribute('id')) ?? '')

    // The keyboard goes on from the hovered item while the pointer rests on it.
    await win.keyboard.press('Tab')
    await expect(list).toBeFocused()
    await win.keyboard.press('ArrowUp')
    await expect.poll(() => highlighted(list)).toEqual([expect.stringMatching(/^Hide message text/)])

    await accountMenu.item(/^Set yourself/).hover()
    await expect.poll(() => highlighted(list)).toEqual([expect.stringMatching(/^Set yourself/)])
    await win.keyboard.press('ArrowDown')
    await expect.poll(() => highlighted(list)).toEqual([expect.stringMatching(/^Hide message text/)])

    // Leaving the menu clears the highlight, as a native menu does.
    await accountMenu.root.getByRole('heading', { name: 'Session' }).hover()
    await expect.poll(() => highlighted(list)).toEqual([])
    await accountMenu.close()
  })
  await test.step('the palette has one active row under the pointer and the arrow keys', async () => {
    const { palette } = juno
    await palette.open()
    const list = palette.root.getByRole('listbox', { name: 'Results' })
    const rows = list.getByRole('option')
    await expect(rows.nth(2)).toBeVisible()

    await rows.nth(2).hover()
    await expect.poll(async () => (await highlighted(list)).length).toBe(1)
    const hovered = await rows.nth(2).textContent()
    expect(await highlighted(list)).toEqual([hovered])

    await win.keyboard.press('ArrowDown')
    const next = await rows.nth(3).textContent()
    await expect.poll(() => highlighted(list)).toEqual([next])

    await rows.nth(1).hover()
    await expect.poll(async () => highlighted(list)).toEqual([await rows.nth(1).textContent()])
    await win.keyboard.press('Escape')
    await palette.expectClosed()
  })
  await test.step('menu triggers open on mouse down and the release leaves them open', () => pressToOpen(juno, win))
})

async function pressToOpen(juno: Juno, win: Page): Promise<void> {
  const press = async (trigger: Locator) => {
    const box = (await trigger.boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.mouse.down()
  }
  const account = juno.sidebar.accountButton
  await press(account)
  await expect(juno.accountMenu.root).toBeVisible()
  await win.mouse.up()
  await expect(juno.accountMenu.root).toBeVisible()
  await expect(account).toHaveAttribute('aria-expanded', 'true')
  // A second press toggles closed; its click must not reopen it.
  await press(account)
  await expect(juno.accountMenu.root).toHaveCount(0)
  await win.mouse.up()
  await expect(juno.accountMenu.root).toHaveCount(0)
  await account.click()
  await expect(juno.accountMenu.root).toBeVisible()
  await win.keyboard.press('Escape')

  await juno.sidebar.row('#eng').open()
  const switcher = win.getByRole('dialog', { name: 'Topics in this channel' })
  await press(juno.topic.titleButton)
  await expect(switcher).toBeVisible()
  await expect(switcher.getByRole('textbox', { name: 'Search this channel' })).toBeFocused()
  await win.mouse.up()
  await expect(switcher).toBeVisible()
  await juno.topic.expectTitle('Main')
  await press(juno.topic.titleButton)
  await expect(switcher).toHaveCount(0)
  await win.mouse.up()
  await expect(switcher).toHaveCount(0)
  // Custom popovers need a separate press to choose an item: releasing over one is harmless.
  await press(juno.topic.titleButton)
  await expect(switcher).toBeVisible()
  await switcher.getByRole('option').nth(1).hover()
  await win.mouse.up()
  await expect(switcher).toBeVisible()
  await juno.topic.expectTitle('Main')
  await win.keyboard.press('Escape')
  // Enter, Space, ↓ and AT's detail=0 click still open from focus.
  for (const key of ['Enter', 'Space', 'ArrowDown']) {
    await juno.topic.titleButton.focus()
    await win.keyboard.press(key)
    await expect(switcher).toBeVisible()
    await win.keyboard.press('Escape')
  }
  await juno.topic.titleButton.evaluate((button: HTMLButtonElement) => button.click())
  await expect(switcher).toBeVisible()
  await win.keyboard.press('Escape')
  await juno.topic.titleButton.click()
  await expect(switcher).toBeVisible()
  await win.keyboard.press('Escape')

  // Native Electron menus use the existing held-menu seam: opening is observable before release.
  await juno.chooseNextMenuItem(null, { hold: true })
  const before = await juno.menusAsked()
  await press(juno.topic.moreButton)
  await expect(juno.topic.moreButton).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => juno.menusAsked()).toBe(before + 1)
  expect((await juno.lastMenu()).labels).toContain('Copy Slack link')
  await win.mouse.up()
  await expect(juno.topic.moreButton).toHaveAttribute('aria-expanded', 'true')
  expect(await juno.menusAsked()).toBe(before + 1)
  await juno.topic.expectTitle('Main')
  await juno.releaseMenu()
  await expect(juno.topic.moreButton).toHaveAttribute('aria-expanded', 'false')
}
