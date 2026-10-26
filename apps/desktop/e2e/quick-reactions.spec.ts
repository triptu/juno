/**
 * Quick reactions (SPEC 7, 14), what needs the browser: reordered by keyboard
 * and by drag, the message menu's emoji grid starts with them in that order
 * and one click reacts; the picker, whose cells are drawn as its list
 * scrolls, marks the chosen ones, and a choice in Settings is not a use. The
 * form's add, remove, reset, limit and stored aliases are dom/quick-reactions.test.ts's.
 */
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const CHOSEN = ['rocket', 'pray', '+1', 'eyes', 'tada']

const pills = (juno: Juno) => juno.settings.root.locator('[data-quick-reaction]')
const pillNames = (juno: Juno) => pills(juno).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-quick-reaction')))

/** The picker floats on `body`, outside the settings page. */
const picker = (juno: Juno) => juno.win.locator('[role="dialog"][data-emoji-picker]')
const frequentlyUsed = (juno: Juno) => picker(juno).locator('[data-emoji-section][aria-label="Frequently used"]')

async function add(juno: Juno, query: string): Promise<void> {
  await juno.settings.root.locator('button[aria-label="Add reaction"]').click()
  const search = picker(juno).locator('input')
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

// The defaults first: the second step starts from what the first leaves.
test('the picker marks the chosen quick reactions and choosing one does not record recent use; five set in Settings start the menu’s emoji grid in order and react in one click', async ({ juno, fake }) => {
  await juno.openSettings('Appearance')
  await test.step('the picker marks the chosen quick reactions, and choosing one in Settings does not record recent use', async () => {
    await juno.settings.root.locator('button[aria-label="Add reaction"]').click()
    await expect(frequentlyUsed(juno).locator('[data-emoji="+1"]')).toHaveAttribute('aria-disabled', 'true')
    await juno.win.keyboard.press('Escape')
    await expect(picker(juno)).toHaveCount(0)
    await add(juno, 'juno_wave')
    // Quick reactions fill the end of Frequently used; a recorded use would put juno_wave first.
    await expect.poll(() => frequentInSettings(juno)).toEqual(['+1', 'white_check_mark', 'eyes', 'juno_wave'])
    await juno.settings.root.locator('button[aria-label="Remove juno_wave"]').click()
    await expect.poll(() => frequentInSettings(juno)).toEqual(['+1', 'white_check_mark', 'eyes'])
  })
  await test.step('five quick reactions set in Settings start the menu’s emoji grid in order and react in one click', async () => {
    await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes'])

    // Remove ✅, add three from the picker.
    await juno.settings.root.locator('button[aria-label="Remove white_check_mark"]').click()
    await add(juno, 'tada')
    await add(juno, 'pray')
    await add(juno, 'rocket')
    await expect.poll(() => pillNames(juno)).toEqual(['+1', 'eyes', 'tada', 'pray', 'rocket'])

    // ⌥← moves the focused pill; it keeps focus.
    const list = juno.settings.root.locator('[role="list"][aria-label="Quick reactions"]')
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
    await expect(row.locator('[data-reaction="rocket"][aria-pressed="true"]')).toHaveText('🚀1')
    await expect.poll(() => fake.messages('C0ENG').find((m) => m.ts === ts)?.reactions?.map((r) => r.name)).toEqual(['rocket'])
  })
})

/**
 * Frequently used in Settings' picker, then Esc. Each open keeps the list it
 * opened with, and the engine's new list arrives a moment after a change.
 */
async function frequentInSettings(juno: Juno): Promise<Array<string | null>> {
  await juno.settings.root.locator('button[aria-label="Add reaction"]').click()
  await expect(picker(juno).locator('input')).toBeFocused()
  const names = await frequentlyUsed(juno).locator('[data-emoji]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-emoji')))
  await juno.win.keyboard.press('Escape')
  await expect(picker(juno)).toHaveCount(0)
  return names
}
