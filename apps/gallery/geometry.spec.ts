import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Insets are measured, not eyeballed. A scroll area's 10px gutter sits on
 * the right only, so content that ignores it is 10px further from the right
 * edge than from the left. These checks hold the sidebar's rows, filter row,
 * nav and title bar to one inset on both sides, and the message list and the
 * Juno chat to a column centred in its pane, to the pixel, with a scrollbar
 * and without one.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

interface Inset {
  readonly left: number
  readonly right: number
}

/** The sidebar parts' distances from its content box (inside the right border), in CSS px. */
function sidebarInsets(page: Page) {
  return page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Sidebar"]')!
    const box = aside.getBoundingClientRect()
    const right = box.right - parseFloat(getComputedStyle(aside).borderRightWidth)
    const inset = (element: Element | null): Inset => {
      const b = element!.getBoundingClientRect()
      return { left: b.left - box.left, right: right - b.right }
    }
    const filters = aside.querySelector('[aria-label="Quick filters"]')!
    const buttons = [...filters.querySelectorAll('button')]
    const list = aside.querySelector('[aria-label="Topics"]') as HTMLElement
    return {
      rows: [...aside.querySelectorAll('[data-topic-row]')].map(inset),
      nav: [...aside.querySelectorAll('nav [role="button"], nav button')].map(inset),
      firstPill: inset(buttons[0]!),
      unread: inset(buttons.at(-1)!),
      account: inset(aside.querySelector('header button[aria-label^="Account"]')),
      overflows: list.scrollHeight > list.clientHeight,
    }
  })
}

test.describe('sidebar inset', () => {
  for (const [id, overflows] of [
    ['list/default', true],
    ['views/overflowing', true],
    ['list/dms-only', false],
  ] as const) {
    test(`${id}: rows, filters, nav and title bar share one inset on both sides`, async ({ page }) => {
      await open(page, 'Sidebar', id)
      const at = await sidebarInsets(page)
      expect(at.overflows).toBe(overflows)
      const inset = at.nav[0]!.left
      expect(inset).toBe(10)
      expect(at.rows.length).toBeGreaterThan(0)
      for (const row of at.rows) expect(row).toEqual({ left: inset, right: inset })
      for (const item of at.nav) expect(item).toEqual({ left: inset, right: inset })
      expect(at.firstPill.left).toBe(inset)
      expect(at.unread.right).toBe(inset)
      expect(at.account.right).toBe(inset)
    })
  }

  test('privacy/on: the footer widget sits at the inset on the left, right and bottom, with Show 4px from its edges', async ({ page }) => {
    await open(page, 'Sidebar', 'privacy/on')
    const at = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="Sidebar"]')!
      const box = aside.getBoundingClientRect()
      const right = box.right - parseFloat(getComputedStyle(aside).borderRightWidth)
      const widget = aside.querySelector('[data-privacy-footer]')!.getBoundingClientRect()
      const show = aside.querySelector('[data-privacy-footer] button')!.getBoundingClientRect()
      const row = aside.querySelector('[data-topic-row]')!.getBoundingClientRect()
      return {
        widget: { left: widget.left - box.left, right: right - widget.right, bottom: box.bottom - widget.bottom },
        show: { top: show.top - widget.top, right: widget.right - show.right, bottom: widget.bottom - show.bottom },
        row: { left: row.left - box.left, right: right - row.right },
      }
    })
    expect(at.widget).toEqual({ left: 10, right: 10, bottom: 10 })
    expect(at.row).toEqual({ left: 10, right: 10 })
    expect(at.show).toEqual({ top: 4, right: 4, bottom: 4 })
  })

  test('views do not make the filter row taller or move the list', async ({ page }) => {
    const measure = () =>
      page.evaluate(() => {
        const filters = document.querySelector('[aria-label="Quick filters"]')!.getBoundingClientRect()
        const row = document.querySelector('[data-pill-row]') as HTMLElement
        const list = document.querySelector('[aria-label="Topics"]')!.getBoundingClientRect()
        return { height: filters.height, top: filters.top, listTop: list.top, rowOverflows: row.scrollWidth > row.clientWidth }
      })
    await open(page, 'Sidebar', 'list/default')
    const plain = await measure()
    await open(page, 'Sidebar', 'views/overflowing')
    const views = await measure()
    expect(views.rowOverflows).toBe(true)
    expect(plain.rowOverflows).toBe(false)
    expect({ height: views.height, top: views.top, listTop: views.listTop }).toEqual({ height: plain.height, top: plain.top, listTop: plain.listTop })
  })
})

test.describe('centred columns', () => {
  for (const [component, id] of [
    ['TopicView', 'thread/long-thread'],
    ['TopicView', 'header/narrow-thread'],
    ['TopicView', 'data/empty'],
    ['JunoChatList', 'chat/conversation'],
    ['JunoChatList', 'chat/empty'],
  ] as const) {
    test(`${component} ${id}: the column is as far from the left edge as from the right`, async ({ page }) => {
      await open(page, component, id)
      const at = await page.evaluate(() => {
        const scroller = document.querySelector('[data-scroll]') as HTMLElement
        const box = scroller.getBoundingClientRect()
        const column = scroller.firstElementChild!.getBoundingClientRect()
        return { left: column.left - box.left, right: box.right - column.right, gutter: scroller.offsetWidth - scroller.clientWidth }
      })
      expect(at.gutter).toBe(10)
      expect(at.left).toBe(at.right)
    })
  }
})

for (const state of ['recent', 'results', 'people', 'overflowing']) {
  test(`palette ${state}: rows have symmetric insets`, async ({ page }) => {
    await open(page, 'CommandPalette', `states/${state}`)
    const insets = await page.getByRole('dialog', { name: 'Search and commands' }).evaluate((panel) => {
      const box = panel.getBoundingClientRect()
      return [...panel.querySelectorAll('[role="option"]')].map((row) => {
        const rect = row.getBoundingClientRect()
        return { left: rect.left - box.left, right: box.right - rect.right }
      })
    })
    expect(insets.length).toBeGreaterThan(0)
    for (const inset of insets) expect(inset.left).toBe(inset.right)
  })
}

test.describe('composer controls', () => {
  test('the attach button mirrors the send button: 6px from its edge, centred on the one-line field', async ({ page }) => {
    await open(page, 'Composer', 'attachments/attach-button')
    const at = await page.evaluate(() => {
      const field = document.querySelector('[data-composer-field]')!
      const box = field.getBoundingClientRect()
      const border = parseFloat(getComputedStyle(field).borderLeftWidth)
      const attach = document.querySelector('button[aria-label="Attach files"]')!.getBoundingClientRect()
      const send = document.querySelector('[data-composer-field] button[aria-label="Send"]')!.getBoundingClientRect()
      return {
        height: box.height,
        attach: { start: attach.left - box.left - border, top: attach.top - box.top - border, bottom: box.bottom - border - attach.bottom, size: attach.width },
        send: { end: box.right - border - send.right, top: send.top - box.top - border, bottom: box.bottom - border - send.bottom, size: send.width },
      }
    })
    expect(at.height).toBe(40)
    expect(at.attach.size).toBe(28)
    expect(at.attach.start).toBe(6)
    expect(at.send.end).toBe(at.attach.start)
    expect(at.attach.top).toBe(at.attach.bottom)
    expect(at.send.top).toBe(at.send.bottom)
    expect(at.attach.top).toBe(at.send.top)
  })
})

test.describe('composer attachments', () => {
  test('the check bar, the chip row and the attach button share the 6px inset; the bar is 6px from the end too', async ({ page }) => {
    await open(page, 'Composer', 'attachments/check-bar-with-chips')
    const at = await page.evaluate(() => {
      const field = document.querySelector('[data-composer-field]')!
      const box = field.getBoundingClientRect()
      const border = parseFloat(getComputedStyle(field).borderLeftWidth)
      const inset = (element: Element) => {
        const b = element.getBoundingClientRect()
        return { start: b.left - box.left - border, end: box.right - border - b.right, top: b.top - box.top - border, bottom: b.bottom - box.top - border }
      }
      const chips = [...field.querySelectorAll('[data-attachment]')].map(inset)
      return {
        bar: inset(field.firstElementChild!),
        chips,
        attach: inset(field.querySelector('button[aria-label="Attach files"]')!),
        send: inset(field.querySelector('button[aria-label="Send"]')!),
      }
    })
    expect(at.attach.start).toBe(6)
    expect(at.bar.start).toBe(at.attach.start)
    expect(at.chips[0]!.start).toBe(at.attach.start)
    expect(at.bar.end).toBe(at.send.end)
    expect(at.bar.top).toBe(6)
    expect(at.chips[0]!.top - at.bar.bottom).toBe(6)
  })

  for (const id of ['checks/narrow-audience-and-check', 'checks/narrow-wrong-place']) {
    test(`${id}: in a 336px field the choices move under the finding and keep the bar's insets`, async ({ page }) => {
      await open(page, 'Composer', id)
      await expect(page.locator('[data-send-check]')).not.toContainText('%')
      const at = await page.evaluate(() => {
        const bar = document.querySelector('[data-send-check]')!
        const box = bar.getBoundingClientRect()
        const [, text, choices] = [...bar.children].map((child) => child.getBoundingClientRect())
        return { textWidth: text!.width, textBottom: text!.bottom, choicesTop: choices!.top, end: box.right - choices!.right, bottom: box.bottom - choices!.bottom, top: text!.top - box.top }
      })
      // The finding keeps a readable width rather than a word per line.
      expect(at.textWidth).toBeGreaterThanOrEqual(200)
      expect(at.choicesTop).toBeGreaterThan(at.textBottom)
      expect(at.end).toBe(8)
      expect(at.bottom).toBe(at.top)
    })
  }

  test('image and file chips are the same 44px frame, with the remove button 4px from the top and end', async ({ page }) => {
    await open(page, 'AttachmentChips', 'state/ready')
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('[data-attachment]')].map((chip) => {
        const box = chip.getBoundingClientRect()
        const remove = chip.querySelector('button')!.getBoundingClientRect()
        const frame = getComputedStyle(chip.querySelector('[data-chip-frame]')!)
        return { height: box.height, radius: getComputedStyle(chip).borderTopLeftRadius, border: `${frame.borderTopWidth} ${frame.borderTopStyle}`, top: remove.top - box.top, end: box.right - remove.right, size: remove.width }
      }),
    )
    expect(chips.length).toBe(4)
    for (const chip of chips) expect(chip).toEqual({ height: 44, radius: '14px', border: '1px solid', top: 4, end: 4, size: 20 })
  })
})

test.describe('message images', () => {
  test('one image fits 360 by 240', async ({ page }) => {
    await open(page, 'MessageList', 'files/thumbnails')
    const single = await page.evaluate(() =>
      [...document.querySelectorAll('[data-thumbnail]')]
        .filter((thumb) => thumb.closest('[data-thumbnail-grid]') === null)
        .map((element) => {
          const b = element.getBoundingClientRect()
          return { width: b.width, height: b.height }
        }),
    )
    expect(single.length).toBeGreaterThan(0)
    for (const thumb of single) {
      expect(thumb.width).toBeLessThanOrEqual(360)
      expect(thumb.height).toBeLessThanOrEqual(240)
    }
  })

  // Every grid is the 360 × 240 thumbnail box: 2 side by side, 3 with the first tall, 4 in 2 × 2, more as "+N" on the fourth.
  const layouts = {
    'grid-2': [[177, 240], [177, 240]],
    'grid-3': [[177, 240], [177, 117], [177, 117]],
    'grid-4': [[177, 117], [177, 117], [177, 117], [177, 117]],
    'grid-6': [[177, 117], [177, 117], [177, 117], [177, 117]],
  } as const
  for (const [state, cells] of Object.entries(layouts)) {
    test(`a message's pictures: ${state}`, async ({ page }) => {
      await open(page, 'MessageList', `media/${state}`)
      const at = await page.evaluate(() => {
        const grid = document.querySelector('[data-thumbnail-grid]')!
        const size = (element: Element) => {
          const b = element.getBoundingClientRect()
          return { left: b.left, width: b.width, height: b.height }
        }
        return { grid: size(grid), cells: [...grid.querySelectorAll('[data-thumbnail]')].map(size), more: [...grid.querySelectorAll('[data-more]')].map((node) => node.textContent) }
      })
      expect({ width: at.grid.width, height: at.grid.height }).toEqual({ width: 360, height: 240 })
      expect(at.cells.map((cell) => [cell.width, cell.height])).toEqual(cells)
      expect(at.cells[1]!.left - (at.cells[0]!.left + at.cells[0]!.width)).toBe(6)
      expect(at.more).toEqual(state === 'grid-6' ? ['+2'] : [])
    })
  }
})

test.describe('settings chips', () => {
  // How far a chip and the text of the row's buttons end from the card's right edge.
  const ends = (page: Page, chipSelector: string, card: string) =>
    page.evaluate(
      ([chipSelector, card]) => {
        const chip = document.querySelector(chipSelector!)!
        // The card: the This Mac group itself, or the group around the Codex row.
        const holder = chip.closest(card!)!
        const group = holder.hasAttribute('data-codex') ? holder.parentElement! : holder
        const right = group.getBoundingClientRect().right
        const text = (element: Element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          return right - range.getBoundingClientRect().right
        }
        return { chip: right - chip.getBoundingClientRect().right, buttons: [...group.querySelectorAll('button')].map(text) }
      },
      [chipSelector, card],
    )

  test('This Mac: the owner chip ends where the Move and Restore text ends', async ({ page }) => {
    await open(page, 'ThisMacSection', 'this-mac/active')
    const at = await ends(page, '[data-owner-chip]', '[data-ownership]')
    expect(at.buttons.length).toBe(2)
    for (const button of at.buttons) expect(at.chip).toBe(button)
    expect(at.chip).toBe(24)
  })

  // The Codex card has no text buttons: its chip ends at the row's 15px inset, like the values and fields of the cards above it.
  test('Codex: with no text button in its card, the ready chip ends at the 15px inset', async ({ page }) => {
    await open(page, 'JunoSettingsPage', 'settings/ready')
    expect((await ends(page, '[data-codex-chip]', '[data-codex]')).chip).toBe(15)
  })
})

test.describe('settings forms', () => {
  test('Add a server: Add ends at the fields’ trailing edge, 15px from the card, and a refusal starts at the leading one', async ({ page }) => {
    await open(page, 'ConnectionsPage', 'connections/badaddress')
    const at = await page.evaluate(() => {
      const card = document.querySelector('[data-add-server]')!.getBoundingClientRect()
      const field = document.querySelector('[data-add-server] input')!.parentElement!.getBoundingClientRect()
      const add = [...document.querySelectorAll('[data-add-server] button')].at(-1)!.getBoundingClientRect()
      const error = document.querySelector('[data-add-server] [data-connection-error]')!.getBoundingClientRect()
      return { fieldStart: field.left - card.left, fieldEnd: card.right - field.right, addEnd: card.right - add.right, errorStart: error.left - card.left }
    })
    expect(at.fieldEnd).toBe(15)
    expect(at.addEnd).toBe(at.fieldEnd)
    expect(at.errorStart).toBe(at.fieldStart)
  })

  test('Connections: each server is one compact row with Configure, and no divider over the card’s bottom edge', async ({ page }) => {
    await open(page, 'ConnectionsPage', 'connections/servers')
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-connection-id]')].map((row) => ({
        id: row.getAttribute('data-connection-id'),
        configure: [...row.querySelectorAll('button')].some((button) => button.textContent === 'Configure'),
        tools: row.querySelectorAll('[data-tool]').length,
        border: getComputedStyle(row).borderBottomWidth,
      })),
    )
    expect(rows.map((row) => row.id)).toEqual(['notion', 'littlebird', 't3', 'server-docs'])
    for (const row of rows) expect(row).toMatchObject({ configure: true, tools: 0 })
    expect(rows.at(-1)?.border).toBe('0px')
  })

  test('Restore from backup: the folder box is drawn as the phrase field under it, its text on the same line', async ({ page }) => {
    await open(page, 'RestoreSheet', 'restore/ready')
    const at = await page.evaluate(() => {
      const folderText = document.querySelector('[data-restore-folder]')!
      const folder = folderText.parentElement!
      const input = document.querySelector('[data-sheet] input')!
      const field = input.parentElement!
      const look = (element: Element) => {
        const style = getComputedStyle(element)
        return { height: element.getBoundingClientRect().height, radius: style.borderRadius, border: style.borderTopColor, fill: style.backgroundColor }
      }
      const button = folder.querySelector('button')!.getBoundingClientRect()
      const box = folder.getBoundingClientRect()
      return { folder: look(folder), field: look(field), folderText: folderText.getBoundingClientRect().left, inputText: input.getBoundingClientRect().left, buttonEnd: box.right - button.right, buttonTop: button.top - box.top, buttonBottom: box.bottom - button.bottom }
    })
    expect(at.folder).toEqual(at.field)
    expect(at.folderText).toBe(at.inputText)
    // Choose folder sits evenly in the box: as far from the end as from the top and bottom.
    expect(at.buttonEnd).toBe(at.buttonTop)
    expect(at.buttonTop).toBe(at.buttonBottom)
  })
})


test('Configure: every tool row lines up with the Tool, Enabled and Auto-review columns', async ({ page }) => {
  await open(page, 'ConnectionToolsSheet', 'configure/tools')
  const at = await page.evaluate(() => {
    const [tool, enabled, review] = [...document.querySelectorAll('[role="columnheader"]')].map((node) => node.getBoundingClientRect())
    return [...document.querySelectorAll('[data-tool]')].map((row) => {
      const [name, toggle, rule] = [...row.children].map((cell) => cell.getBoundingClientRect())
      const box = row.querySelector('input[type="checkbox"]')!.getBoundingClientRect()
      return {
        name: name!.left - tool!.left,
        toggle: Math.round(box.left + box.width / 2 - (enabled!.left + enabled!.width / 2)),
        rule: rule!.left - review!.left,
        cell: toggle!.left - enabled!.left,
      }
    })
  })
  // Every tool in the fixture, including the locked delete and the tool that is not offered.
  expect(at.length).toBe(10)
  for (const row of at) expect(row).toEqual({ name: 0, toggle: 0, rule: 0, cell: 0 })
})

test('Backup cuts the path in the middle and keeps the row insets', async ({ page }) => {
  await open(page, 'BackupSection', 'backup/long-path')
  const path = page.locator('[data-backup-folder]')
  await expect(path).toHaveAttribute('title', '/Users/maya/Library/CloudStorage/Dropbox/Workspace archives/Shared folders/Desktop clients/Juno backup')
  await expect(path).toContainText('…')
  await expect(path).toContainText('/Juno backup')
  const at = await path.evaluate((node) => {
    const card = node.closest('[data-backup]')!.getBoundingClientRect()
    const row = node.closest('[data-backup]')!.firstElementChild!
    const button = row.querySelector('button')!.getBoundingClientRect()
    const box = node.getBoundingClientRect()
    return { start: box.left - card.left, end: card.right - button.right, fits: node.scrollWidth <= node.clientWidth, gap: button.left - box.right }
  })
  expect(at.start).toBe(15)
  expect(at.end).toBe(at.start)
  expect(at.fits).toBe(true)
  expect(at.gap).toBeGreaterThan(0)
})

test('Home Automated keeps its two lines aligned and its actions evenly inset', async ({ page }) => {
  await open(page, 'Home', 'items/automated')
  const row = page.locator('[data-home-item=automated]')
  await row.hover()
  await expect(row.locator('[data-home-title]')).toHaveText('Move #releases?')
  await expect(row.locator('[data-home-meta]')).toHaveText('To Automated')
  const at = await row.evaluate((node) => {
    const title = node.querySelector('[data-home-title]')!.getBoundingClientRect()
    const meta = node.querySelector('[data-home-meta]')!.getBoundingClientRect()
    const buttons = [...node.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
    const slot = node.getBoundingClientRect()
    return { title: title.left, meta: meta.left, buttons: buttons.map((box) => ({ top: box.top - slot.top, bottom: slot.bottom - box.bottom })), gap: buttons[1]!.left - buttons[0]!.right }
  })
  expect(at.title).toBe(at.meta)
  for (const button of at.buttons) expect(button).toEqual({ top: 12, bottom: 12 })
  expect(at.gap).toBeGreaterThan(0)
})
