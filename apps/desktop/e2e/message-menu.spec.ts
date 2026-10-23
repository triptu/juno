// The message menu (SPEC 7, "Message menu"): a right-click opens it when the
// click completes, at the pointer, with the emoji grid on top; the
// context-menu key and ⇧F10 open it at once. More reactions turns it into the
// emoji picker in one motion, growing from the corner of the menu that stays
// put, near every edge of the window. Rows show the keys that work on a
// focused message (T, E, ⌫), which also choose them while the menu is open.
// One sender's messages start a new header after ten quiet minutes.
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { Juno, MessageMenuDriver } from './driver/juno'

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const MINUTE = 60_000

/** Waits until every animation in the menu has finished: the morph. */
const settled = (menu: Locator) => menu.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).filter((animation) => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition)).map((animation) => animation.finished)).then(() => undefined))

const boxOf = async (locator: Locator) => {
  const box = (await locator.boundingBox())!
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height, width: box.width, height: box.height }
}

test('a right-click opens the menu as it comes up, over the same message, with the emoji grid on top', async ({ juno, fake }) => {
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Right-click me when it is done' })
  fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: 'A neighbour to let go over' })
  await juno.sidebar.expectTop('#eng')
  await juno.sidebar.row('#eng').open()
  const target = juno.topic.message('Right-click me when it is done')
  const neighbour = juno.topic.message('A neighbour to let go over')
  await expect(neighbour).toBeVisible()
  const menu = juno.messageMenu

  await test.step('the button going down opens nothing; coming up over the message opens the menu at the pointer', async () => {
    const text = await boxOf(target.locator('[data-msg-text]').first())
    const at = { x: text.left + 20, y: text.top + 6 }
    await juno.win.mouse.move(at.x, at.y)
    await juno.win.mouse.down({ button: 'right' })
    await juno.win.waitForTimeout(150)
    await expect(menu.root).toHaveCount(0)
    await juno.win.mouse.up({ button: 'right' })
    await expect(menu.root).toBeVisible()
    const box = await boxOf(menu.root)
    // To the right of the pointer, downward from it, or moved up only as far as the window's bottom edge needs.
    const view = await juno.win.evaluate(() => window.innerHeight)
    expect(Math.round(box.left)).toBe(Math.round(at.x) + 1)
    if (Math.round(box.top) !== Math.round(at.y) + 1) expect(Math.round(box.bottom)).toBe(view - 6)
    expect(box.top).toBeLessThanOrEqual(at.y + 1)
    // Eleven emoji, the quick reactions first, then More reactions; no why row and no Copy Slack link.
    expect((await menu.grid()).slice(0, 3)).toEqual(['+1', 'white_check_mark', 'eyes'])
    expect(await menu.grid()).toHaveLength(11)
    await expect(menu.more).toHaveAccessibleName('More reactions')
    // Ask Juno shows while AI assist is on.
    const labels = (await menu.labels()).filter((label) => label !== 'Ask Juno')
    expect(labels).toEqual(['Start thread', 'Quote', '-', 'Copy text', 'Forward…', 'Open in Slack'])
    // The message takes its faint fill while its menu is open.
    await expect(target).toHaveAttribute('data-popover-active', '')
    await menu.close()
    await expect(target).not.toHaveAttribute('data-popover-active')
  })

  await test.step('let go over another message, and nothing opens', async () => {
    const from = await boxOf(target.locator('[data-msg-text]').first())
    const to = await boxOf(neighbour.locator('[data-msg-text]').first())
    await juno.win.mouse.move(from.left + 20, from.top + 6)
    await juno.win.mouse.down({ button: 'right' })
    await juno.win.mouse.move(to.left + 20, to.top + 6, { steps: 4 })
    await juno.win.mouse.up({ button: 'right' })
    await juno.win.waitForTimeout(150)
    await expect(menu.root).toHaveCount(0)
  })

  await test.step('the context-menu key opens it at once, and ⇧F10 on a selected message under its first line', async () => {
    await target.locator('[data-msg-text]').first().dispatchEvent('contextmenu')
    await expect(menu.root).toBeVisible()
    await menu.close()
    await juno.topic.composer.focus()
    await juno.topic.composer.press('ArrowUp')
    const last = juno.topic.list.locator('[data-message-row]').last()
    await expect(last).toBeFocused()
    await juno.win.keyboard.press('Shift+F10')
    await expect(menu.root).toBeVisible()
    const text = await boxOf(last.locator('[data-msg-text]').first())
    const box = await boxOf(menu.root)
    expect(Math.abs(box.left - (text.left + 1))).toBeLessThanOrEqual(1)
    // Under the first line, or moved up only as far as the window's bottom edge needs.
    const height = await juno.win.evaluate(() => window.innerHeight)
    if (box.top <= text.top) expect(Math.round(box.bottom)).toBe(height - 6)
    // The keys: ↓ goes to the grid's first cell, → along it, ↓ to the rows.
    await juno.win.keyboard.press('ArrowDown')
    await expect(menu.cell('+1')).toBeFocused()
    await juno.win.keyboard.press('ArrowRight')
    await expect(menu.cell('white_check_mark')).toBeFocused()
    await juno.win.keyboard.press('Escape')
    await expect(menu.root).toHaveCount(0)
  })

  await test.step('a press outside closes it', async () => {
    await menu.openOnRow(target)
    await juno.win.mouse.click(5, 300)
    await expect(menu.root).toHaveCount(0)
  })
})

test('a key the menu shows runs its row; T on a focused message in Main starts its thread, and does nothing in the thread', async ({ juno, fake }) => {
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Something to bring #eng up' })
  await juno.sidebar.expectTop('#eng')
  await juno.sidebar.row('#eng').open()
  const { topic } = juno
  const menu = juno.messageMenu
  await topic.send('Keys in the menu')
  await topic.expectSent('Keys in the menu')
  const row = topic.message('Keys in the menu')

  await test.step('E in the open menu edits, and types nothing', async () => {
    await menu.openOnRow(row)
    expect(await menu.shortcuts()).toEqual({ reply: 'T', edit: 'E', delete: '⌫' })
    await juno.win.keyboard.press('e')
    await expect(menu.root).toHaveCount(0)
    const field = topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('Keys in the menu')
    await field.press('Escape')
    await expect(field).toHaveCount(0)
  })

  await test.step('⌫ in the open menu asks to delete', async () => {
    await menu.openOnRow(row)
    await juno.win.keyboard.press('Backspace')
    await expect(menu.root).toHaveCount(0)
    const confirm = row.locator('[data-delete-confirm]')
    await expect(confirm).toBeVisible()
    await juno.win.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(row).toBeVisible()
  })

  await test.step('T on the focused message starts its thread', async () => {
    await topic.composer.focus()
    await topic.composer.press('ArrowUp')
    await expect(row).toBeFocused()
    await row.press('t')
    await topic.expectTitle(/Keys in the menu/)
    await expect(topic.composer).toHaveAttribute('aria-label', 'Reply')
  })

  await test.step('in the thread the menu shows no T, and T does nothing', async () => {
    await topic.composer.focus()
    await topic.composer.press('ArrowUp')
    const root = topic.message('Keys in the menu')
    await expect(root).toBeFocused()
    await root.press('t')
    await expect(root).toBeFocused()
    await topic.expectTitle(/Keys in the menu/)
    await menu.openOnRow(root)
    expect(await menu.shortcuts()).toEqual({ edit: 'E', delete: '⌫' })
    // T is no key here: it only jumps to a row by its name, and the menu stays open.
    await juno.win.keyboard.press('t')
    await expect(menu.root).toBeVisible()
    await topic.expectTitle(/Keys in the menu/)
    await menu.close()
  })
})

test('the grid reacts and takes a reaction back, and More reactions picks any emoji', async ({ juno, fake }) => {
  const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'React to me from the menu' })
  await juno.sidebar.expectTop('#eng')
  await juno.sidebar.row('#eng').open()
  const row = juno.topic.message('React to me from the menu')
  await expect(row).toBeVisible()
  const reactions = () => fake.messages('C0ENG').find((m) => m.ts === message.ts)?.reactions?.map((r) => r.name) ?? []

  await (await juno.messageMenu.openOnRow(row)).react('eyes')
  await expect(row.getByRole('button', { name: '1 👀, including you' })).toBeVisible()
  await expect.poll(reactions).toEqual(['eyes'])

  // Chosen in the grid; choosing it again takes it back.
  const again = await juno.messageMenu.openOnRow(row)
  await expect(again.cell('eyes')).toHaveAttribute('aria-pressed', 'true')
  await again.react('eyes')
  await expect(row.getByRole('button', { name: /👀/ })).toHaveCount(0)
  await expect.poll(reactions).toEqual([])

  // More reactions: the field has focus in the click's frame, so typing works during the motion, and Enter reacts.
  const menu = await juno.messageMenu.openOnRow(row)
  await menu.more.click()
  await expect(menu.search).toBeFocused()
  await juno.win.keyboard.type('rocket')
  await settled(menu.root)
  const box = await boxOf(menu.root)
  expect([box.width, box.height]).toEqual([314, 360])
  await expect(menu.root.locator('[data-emoji-results] [data-emoji="rocket"]')).toBeVisible()
  await menu.search.press('Enter')
  await expect(menu.root).toHaveCount(0)
  await expect(row.getByRole('button', { name: '1 🚀, including you' })).toBeVisible()
  await expect.poll(reactions).toEqual(['rocket'])

  // Esc closes the whole menu, picker and all.
  const closing = await juno.messageMenu.openOnRow(row)
  await closing.more.click()
  await expect(closing.search).toBeFocused()
  await juno.win.keyboard.press('Escape')
  await expect(closing.root).toHaveCount(0)
  expect(reactions()).toEqual(['rocket'])
})

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/**
 * Opens the menu at `at`, turns it into the picker, and checks every frame of
 * the motion: the surface only grows, and the corner named stays where the
 * menu's was, to a pixel.
 */
async function morphAt(juno: Juno, at: { readonly target: Locator; readonly position: { readonly x: number; readonly y: number } }, corner: Corner): Promise<void> {
  const { win } = juno
  const menu: MessageMenuDriver = await juno.messageMenu.openOn(at.target, at.position)
  const before = await boxOf(menu.root)
  // The material is the menu's first layer once it morphs; read its box every frame until the motion ends.
  const frames = win.evaluate(
    () =>
      new Promise<Array<{ left: number; top: number; right: number; bottom: number }>>((resolve) => {
        const seen: Array<{ left: number; top: number; right: number; bottom: number }> = []
        const tick = () => {
          const root = document.querySelector<HTMLElement>('[data-context-menu][data-morphed]')
          if (root !== null) {
            const box = (root.firstElementChild as HTMLElement).getBoundingClientRect()
            seen.push({ left: box.left, top: box.top, right: box.right, bottom: box.bottom })
            if (root.getAnimations({ subtree: true }).every((animation) => animation instanceof CSSAnimation || animation instanceof CSSTransition || animation.playState !== 'running') && seen.length > 1) return resolve(seen)
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
  await menu.more.click()
  await expect(menu.search).toBeFocused()
  const seen = await frames
  await settled(menu.root)
  const after = await boxOf(menu.root)
  expect([after.width, after.height]).toEqual([314, 360])
  const [y, x] = corner.split('-') as ['top' | 'bottom', 'left' | 'right']
  expect(Math.abs(after[x] - before[x]), `${corner}: ${JSON.stringify({ before, after })}`).toBeLessThanOrEqual(1)
  expect(Math.abs(after[y] - before[y]), `${corner}: ${JSON.stringify({ before, after })}`).toBeLessThanOrEqual(1)
  expect(seen.length).toBeGreaterThan(3)
  for (const frame of seen) {
    expect(Math.abs(frame[x] - before[x]), `${corner} moved during the morph: ${JSON.stringify(frame)}`).toBeLessThanOrEqual(1)
    expect(Math.abs(frame[y] - before[y]), `${corner} moved during the morph: ${JSON.stringify(frame)}`).toBeLessThanOrEqual(1)
  }
  const view = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  expect(after.left).toBeGreaterThanOrEqual(0)
  expect(after.top).toBeGreaterThanOrEqual(0)
  expect(after.right).toBeLessThanOrEqual(view.width)
  expect(after.bottom).toBeLessThanOrEqual(view.height)
  await win.keyboard.press('Escape')
  await expect(menu.root).toHaveCount(0)
}

/** A point on a row's words: near their start, or near their end, past where the picker would fit to the right. */
async function pointOn(win: Page, row: Locator, side: 'left' | 'right') {
  // On the words, not the avatar or the name, which have the person's menu.
  const target = row.locator('[data-msg-text]').first()
  await target.scrollIntoViewIfNeeded()
  const text = await boxOf(target)
  const width = await win.evaluate(() => window.innerWidth)
  const x = side === 'left' ? 24 : text.width - 24
  // The picker fits to the right of a point near the start, and not of one near the end.
  expect(text.left + x + 1 + 314 + 6 <= width).toBe(side === 'left')
  return { target, position: { x, y: 10 } }
}

test('More reactions grows the picker from the corner of the menu that stays put, near every edge of the window', async ({ juno, fake }) => {
  // A narrow window, so a message's words reach near its right edge.
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 700))
  // A resize closes an open menu, so let it land first.
  await expect.poll(() => juno.win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(900)
  await juno.win.waitForTimeout(300)
  for (let i = 0; i < 12; i++) fake.injectMessage({ channel: 'C0ENG', user: i % 2 === 0 ? 'U0MAYA' : 'U0LEO', text: `Corner check ${i}: a line long enough to run across the whole column of the list, to its far edge` })
  await juno.sidebar.expectTop('#eng')
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectMessage('Corner check 11')
  // Rows above lay out at their size estimate until seen, so the end may move: scroll until it holds.
  await expect
    .poll(() => juno.topic.scroller.evaluate((scroller) => {
      scroller.scrollTo({ top: scroller.scrollHeight })
      return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    }))
    .toBeLessThanOrEqual(2)
  const view = await juno.win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const rows = juno.topic.list.locator('[data-message-row]')
  const last = rows.last()
  // The lowest row in view whose words leave room for the picker below a menu opened on them.
  const index = await rows.evaluateAll((nodes, height) => nodes.findLastIndex((node) => {
    const text = node.querySelector('[data-msg-text]')?.getBoundingClientRect()
    return text !== undefined && text.top > 120 && text.top + 10 + 1 + 360 + 6 < height - 10
  }), view.height)
  expect(index).toBeGreaterThanOrEqual(0)
  const upper = rows.nth(index)
  // The last row sits on the composer: the menu shifts up to fit, and the picker grows upward from its bottom.
  expect((await boxOf(last)).bottom).toBeGreaterThan(view.height - 360)

  await test.step('top left: down and to the right', async () => morphAt(juno, await pointOn(juno.win, upper, 'left'), 'top-left'))
  await test.step('top right: down and to the left', async () => morphAt(juno, await pointOn(juno.win, upper, 'right'), 'top-right'))
  await test.step('bottom left: up and to the right', async () => morphAt(juno, await pointOn(juno.win, last, 'left'), 'bottom-left'))
  await test.step('bottom right: up and to the left', async () => morphAt(juno, await pointOn(juno.win, last, 'right'), 'bottom-right'))
})

test('one sender’s messages start a new header after ten quiet minutes', async ({ juno, fake }) => {
  const now = fake.now()
  const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Header gap thread', at: now - 40 * MINUTE })
  const reply = (text: string, ago: number) => fake.workspace.post({ channel: 'C0ENG', threadTs: root.ts, user: 'U0MAYA', text, at: now - ago * MINUTE })
  reply('First after the root', 30)
  reply('Nine minutes later', 21)
  reply('Ten quiet minutes later', 11)
  reply('Right after that', 10)
  await juno.sidebar.row('#eng').open()
  await juno.topic.list.locator(`[data-thread-link="t:C0ENG:${root.ts}"]`).click()
  await juno.topic.expectMessage('Right after that')
  const header = (text: string) => juno.topic.message(text).locator('[data-message-header]')
  await expect(header('First after the root')).toHaveCount(1)
  await expect(header('Nine minutes later')).toHaveCount(0)
  await expect(header('Ten quiet minutes later')).toHaveCount(1)
  await expect(header('Right after that')).toHaveCount(0)
  // A follow-up shows no time beside it, under the pointer or not.
  const follow = juno.topic.message('Nine minutes later')
  await follow.hover()
  await expect(follow.locator('time')).toHaveCount(0)
})
