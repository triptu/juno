import type { Fixtures } from './fixtures'
/**
 * Quick reactions (SPEC 7, 14): chosen in Settings › Appearance, up to
 * eleven, added from the emoji picker, removed, and reordered by keyboard and
 * by drag. The message menu's emoji grid starts with them in that order, one
 * click reacts, and the choice survives a relaunch. Add opens the emoji
 * picker as a popover over the page, with the chosen emoji marked.
 */
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'
import { readUserDb } from './driver/userDb'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const CHOSEN = ['rocket', 'pray', '+1', 'eyes', 'tada']

const pills = (juno: Juno) => juno.settings.root.getByRole('list', { name: 'Quick reactions' }).getByRole('listitem')
const pillNames = (juno: Juno) => pills(juno).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-quick-reaction')))

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

/** Opens #eng's Main and the menu of a message from someone else. */
async function menuOf(juno: Juno, text: string) {
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await expect(juno.topic.message(text)).toBeVisible()
  return juno.topic.messageMenu(text)
}

/** The first `count` emoji of a message's grid, then the menu closes. */
async function gridStart(juno: Juno, text: string, count: number): Promise<string[]> {
  const menu = await menuOf(juno, text)
  const names = (await menu.grid()).slice(0, count)
  await menu.close()
  return names
}

test('five quick reactions set in Settings start the menu’s emoji grid in order, react in one click, and survive a relaunch', async ({ juno, fake, relaunch }) => {
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
  const menu = await menuOf(juno, 'Release notes are ready for review')
  expect((await menu.grid()).slice(0, 5)).toEqual(CHOSEN)
  const row = juno.topic.message('Release notes are ready for review')
  const ts = fake.messages('C0ENG').find((m) => m.text === 'Release notes are ready for review')!.ts
  await menu.react('rocket')
  await expect(row.getByRole('button', { name: '1 🚀, including you' })).toBeVisible()
  await expect.poll(() => fake.messages('C0ENG').find((m) => m.ts === ts)?.reactions?.map((r) => r.name)).toEqual(['rocket'])

  const second = await relaunch()
  await second.waitForSync()
  await expect.poll(() => gridStart(second, 'Release notes are ready for review', 5)).toEqual(CHOSEN)
  await second.openSettings('Appearance')
  await expect.poll(() => pillNames(second)).toEqual(CHOSEN)
})

test('adds, removes and resets quick reactions, then enforces the eleven-reaction limit', async ({ juno, fake }) => {
  const context = { juno, fake }
  await test.step('Add opens the emoji picker over the page; a pick shows in the menu’s grid, and remove and reset come back to the default', () => editQuickReactions(context))
  await test.step('at eleven, Add stays focusable, says "Up to 11" and opens nothing', () => limitQuickReactions(context))
})

async function editQuickReactions({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
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
  await expect(picker(juno).getByRole('group', { name: 'Frequently used' }).getByRole('button', { name: ':+1:, added' })).toHaveAttribute('aria-disabled', 'true')

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

  await expect.poll(() => gridStart(juno, 'The picker test message', 4)).toEqual(['+1', 'white_check_mark', 'eyes', 'tada'])

  await juno.openSettings('Appearance')
  await juno.settings.root.getByRole('button', { name: 'Remove eyes' }).click()
  await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'tada'])
  await juno.settings.root.getByRole('button', { name: 'Reset to default' }).click()
  await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes'])
  await expect(juno.settings.root.getByRole('button', { name: 'Reset to default' })).toBeDisabled()

  await expect.poll(() => gridStart(juno, 'The picker test message', 3)).toEqual(['+1', 'white_check_mark', 'eyes'])
}

async function limitQuickReactions({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  await juno.openSettings('Appearance')
  for (const name of ['tada', 'pray', 'rocket', 'fire', '100', 'heart', 'joy', 'sparkles']) await add(juno, name)
  await expect.poll(() => pillNames(juno)).toHaveLength(11)
  const full = juno.settings.root.getByRole('button', { name: 'Up to 11' })
  await expect(full).toHaveAttribute('aria-disabled', 'true')
  await full.focus()
  await expect(full).toBeFocused()
  // Playwright counts aria-disabled as disabled, so the press is forced.
  await full.click({ force: true })
  await expect(picker(juno)).toHaveCount(0)
}


test('a workspace alias adds its real emoji to quick reactions', async ({ juno, fake, userData }) => {
  await juno.openSettings('Appearance')
  await add(juno, 'hello_juno')
  await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes', 'juno_wave'])
  await expect(juno.settings.root.locator('[data-quick-reaction="juno_wave"] img')).toBeVisible()
  await expect.poll(() => readUserDb(userData, fake.teamId, (db) => db.prepare("SELECT value_json FROM prefs WHERE key = 'quickReactions'").get()?.['value_json'])).toContain(`${fake.url}/emoji/juno_wave.svg`)
  await juno.settings.root.getByRole('button', { name: 'Add reaction' }).click()
  await expect(picker(juno).getByRole('heading', { name: 'Frequently used', exact: true })).toBeVisible()
  await expect(picker(juno).getByRole('button', { name: ':juno_wave:, added', exact: true }).first()).toHaveAttribute('aria-disabled', 'true')
})


test('choosing a quick reaction in Settings does not record recent use', async ({ juno }) => {
  await juno.openSettings('Appearance')
  await add(juno, 'juno_wave')
  await juno.settings.root.getByRole('button', { name: 'Remove juno_wave' }).click()
  await juno.settings.root.getByRole('button', { name: 'Add reaction' }).click()
  await expect(picker(juno).getByRole('group', { name: 'Frequently used' }).locator('[data-emoji="juno_wave"]')).toHaveCount(0)
})
