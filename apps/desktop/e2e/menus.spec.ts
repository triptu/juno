// Menus and lists built on OptionList have one active row, as a native menu
// does: the pointer and the arrow keys move the same highlight, and no row
// keeps a hover highlight of its own beside it.
import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'

/** The names of the rows drawn highlighted: any row with a background. */
function highlighted(list: Locator): Promise<string[]> {
  return list.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"]')]
      .filter((row) => getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)')
      .map((row) => row.textContent ?? ''),
  )
}

test('the avatar menu and the palette each have one active row under the pointer and the arrow keys', async ({ juno, win }) => {
  await juno.signIn()
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
  // The avatar menu opened before the sync's end, as it did alone; the palette after it.
  await juno.waitForSync()
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
  })
})
