/**
 * Quick reactions (SPEC 7, 14): chosen in Settings › Appearance, up to
 * seven, added from the emoji picker, removed, and reordered by keyboard and
 * by drag. The message toolbar shows them in that order, one click reacts,
 * and the choice survives a relaunch. Add opens the message toolbar's picker
 * as a popover over the page, with the chosen emoji marked.
 */
import type { Locator } from '@playwright/test'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const CHOSEN = ['rocket', 'pray', '+1', 'eyes', 'tada']
const TOOLBAR = ['React 🚀', 'React 🙏', 'React 👍', 'React 👀', 'React 🎉']

const pills = (juno: Juno) => juno.settings.root.getByRole('list', { name: 'Quick reactions' }).getByRole('listitem')
const pillNames = (juno: Juno) => pills(juno).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-quick-reaction')))
const toolbarLabels = (row: Locator) => row.getByRole('toolbar').getByRole('button', { name: /^React / }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))

/** The picker floats on `body`, outside the settings page. */
const picker = (juno: Juno) => juno.win.getByRole('dialog', { name: 'Emoji' })

async function add(juno: Juno, query: string): Promise<void> {
  await juno.settings.root.getByRole('button', { name: 'Add reaction' }).click()
  const search = picker(juno).getByRole('textbox', { name: 'Search emoji' })
  await expect(search).toBeFocused()
  await search.fill(query)
  await search.press('Enter')
  await expect(search).toHaveCount(0)
}

/** Opens #eng's Main and answers a message from someone else, hovered so its toolbar shows. */
async function hoveredMessage(juno: Juno, text: string): Promise<Locator> {
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  const row = juno.topic.message(text)
  await expect(row).toBeVisible()
  await row.hover()
  await expect(row.getByRole('toolbar')).toBeVisible()
  return row
}

test('five quick reactions set in Settings show in the toolbar in order, react in one click, and survive a relaunch', async ({ juno, fake, slackApp, userData, running }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openSettings('Appearance')
  await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes'])

  // Remove ✅, add three from the picker.
  await juno.settings.root.getByRole('button', { name: 'Remove white_check_mark' }).click()
  await add(juno, 'tada')
  await add(juno, 'pray')
  await add(juno, 'rocket')
  await expect.poll(() => pillNames(juno)).toEqual(['+1', 'eyes', 'tada', 'pray', 'rocket'])

  // ⌥← moves the focused pill; it keeps focus.
  const list = juno.settings.root.getByRole('list', { name: 'Quick reactions' })
  const rocket = list.locator('[data-quick-reaction="rocket"]')
  await rocket.focus()
  for (let i = 0; i < 4; i++) await juno.win.keyboard.press('Alt+ArrowLeft')
  await expect(rocket).toBeFocused()
  await expect.poll(() => pillNames(juno)).toEqual(['rocket', '+1', 'eyes', 'tada', 'pray'])

  // A drag puts 🙏 where 👍 was.
  await list.locator('[data-quick-reaction="pray"]').dragTo(list.locator('[data-quick-reaction="+1"]'))
  await expect.poll(() => pillNames(juno)).toEqual(CHOSEN)

  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Release notes are ready for review' })
  // The message moves #eng to the top. Clicking before it moves would land on the row that takes its place.
  await juno.sidebar.expectTop('#eng')
  const row = await hoveredMessage(juno, 'Release notes are ready for review')
  expect(await toolbarLabels(row)).toEqual(TOOLBAR)
  const ts = fake.messages('C0ENG').find((m) => m.text === 'Release notes are ready for review')!.ts
  await row.getByRole('button', { name: 'React 🚀' }).click()
  await expect(row.getByRole('button', { name: '1 🚀, including you' })).toBeVisible()
  await expect.poll(() => fake.messages('C0ENG').find((m) => m.ts === ts)?.reactions?.map((r) => r.name)).toEqual(['rocket'])

  await running.close()
  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const second = new Juno(again.app, again.win)
    await second.waitForSync()
    const rowAgain = await hoveredMessage(second, 'Release notes are ready for review')
    await expect.poll(() => toolbarLabels(rowAgain)).toEqual(TOOLBAR)
    await second.openSettings('Appearance')
    await expect.poll(() => pillNames(second)).toEqual(CHOSEN)
  } finally {
    await again.close()
  }
})

test('Add opens the emoji picker over the page; a pick shows in the toolbar, and remove and reset come back to the default', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'The picker test message' })
  await juno.openSettings('Appearance')
  await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes'])

  // The picker is whole: not clipped by the card, with its grid, and the chosen emoji marked.
  const addButton = juno.settings.root.getByRole('button', { name: 'Add reaction' })
  await addButton.click()
  await expect(picker(juno)).toBeVisible()
  await expect(juno.settings.root.getByRole('dialog', { name: 'Emoji' })).toHaveCount(0)
  // Nothing covers or clips its bottom edge: the grid is on top there.
  const bottomIsPicker = await picker(juno).evaluate((panel) => {
    const box = panel.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 12)
    return box.height > 300 && hit !== null && panel.contains(hit)
  })
  expect(bottomIsPicker).toBe(true)
  await expect(picker(juno).getByRole('button', { name: ':+1:, added' }).first()).toHaveAttribute('aria-disabled', 'true')

  // Esc closes it and gives focus back to Add.
  await juno.win.keyboard.press('Escape')
  await expect(picker(juno)).toHaveCount(0)
  await expect(addButton).toBeFocused()

  // A click in the grid adds it and closes the picker.
  await addButton.click()
  await picker(juno).getByRole('textbox', { name: 'Search emoji' }).fill('tada')
  await picker(juno).locator('[data-emoji-results]').getByRole('button', { name: ':tada:' }).first().click()
  await expect(picker(juno)).toHaveCount(0)
  await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes', 'tada'])

  const row = await hoveredMessage(juno, 'The picker test message')
  await expect.poll(() => toolbarLabels(row)).toEqual(['React 👍', 'React ✅', 'React 👀', 'React 🎉'])

  await juno.openSettings('Appearance')
  await juno.settings.root.getByRole('button', { name: 'Remove eyes' }).click()
  await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'tada'])
  await juno.settings.root.getByRole('button', { name: 'Reset to default' }).click()
  await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes'])
  await expect(juno.settings.root.getByRole('button', { name: 'Reset to default' })).toBeDisabled()

  const again = await hoveredMessage(juno, 'The picker test message')
  await expect.poll(() => toolbarLabels(again)).toEqual(['React 👍', 'React ✅', 'React 👀'])
})

test('at seven, Add stays focusable, says "Up to 7" and opens nothing', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openSettings('Appearance')
  for (const name of ['tada', 'pray', 'rocket', 'fire']) await add(juno, name)
  await expect.poll(() => pillNames(juno)).toHaveLength(7)
  const full = juno.settings.root.getByRole('button', { name: 'Up to 7' })
  await expect(full).toHaveAttribute('aria-disabled', 'true')
  await full.focus()
  await expect(full).toBeFocused()
  // Playwright counts aria-disabled as disabled, so the press is forced.
  await full.click({ force: true })
  await expect(picker(juno)).toHaveCount(0)
})
