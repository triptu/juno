/**
 * Quick reactions (SPEC 7, 14), the form in Settings › Appearance: Add opens
 * the emoji picker over the page, a pick shows in the message menu's grid,
 * remove and reset come back to the default, and a workspace alias adds its
 * real emoji. Reordering by drag, and the picker's
 * cells, drawn as its list scrolls, are quick-reactions.spec.ts's.
 */
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'
import { readUserDb } from '../e2e/driver/userDb'

const pills = (juno: Juno) => juno.settings.root.getByRole('list', { name: 'Quick reactions' }).getByRole('listitem')
const pillNames = (juno: Juno) => pills(juno).all().map((node) => node.getAttribute('data-quick-reaction'))

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

/** The first `count` emoji of #eng's message's grid, then the menu closes. */
async function gridStart(juno: Juno, text: string, count: number): Promise<string[]> {
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await expect(juno.topic.message(text)).toBeVisible()
  const menu = await juno.topic.messageMenu(text)
  const names = (await menu.grid()).slice(0, count)
  await menu.close()
  return names
}

domTest('adds, removes and resets quick reactions, and a workspace alias adds its real emoji', async ({ juno, fake, userData, step }) => {
  await step('Add opens the emoji picker over the page; a pick shows in the menu’s grid, and remove and reset come back to the default', async () => {
    fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'The picker test message' })
    await juno.openSettings('Appearance')
    await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes'])

    // The picker floats over the page, not inside the card; Esc closes it and gives focus back to Add.
    const addButton = juno.settings.root.getByRole('button', { name: 'Add reaction' })
    await addButton.click()
    await expect(picker(juno)).toBeVisible()
    await expect(juno.settings.root.getByRole('dialog', { name: 'Emoji' })).toHaveCount(0)
    await juno.win.keyboard.press('Escape')
    await expect(picker(juno)).toHaveCount(0)
    await expect(addButton).toBeFocused()

    // A pick adds it and closes the picker.
    await add(juno, 'tada')
    await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes', 'tada'])

    await expect.poll(() => gridStart(juno, 'The picker test message', 4)).toEqual(['+1', 'white_check_mark', 'eyes', 'tada'])

    await juno.openSettings('Appearance')
    await juno.settings.root.getByRole('button', { name: 'Remove eyes' }).click()
    await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'tada'])
    await juno.settings.root.getByRole('button', { name: 'Reset to default' }).click()
    await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes'])
    await expect(juno.settings.root.getByRole('button', { name: 'Reset to default' })).toBeDisabled()

    await expect.poll(() => gridStart(juno, 'The picker test message', 3)).toEqual(['+1', 'white_check_mark', 'eyes'])
  })

  await step('a workspace alias adds its real emoji', async () => {
    await juno.openSettings('Appearance')
    await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes'])
    await add(juno, 'hello_juno')
    await expect.poll(() => pillNames(juno)).toEqual(['+1', 'white_check_mark', 'eyes', 'juno_wave'])
    await expect(juno.settings.root.locator('[data-quick-reaction="juno_wave"] img')).toHaveCount(1)
    await expect.poll(() => readUserDb(userData, fake.teamId, (db) => db.prepare("SELECT value_json FROM prefs WHERE key = 'quickReactions'").get()?.['value_json'])).toContain(`${fake.url}/emoji/juno_wave.svg`)
  })
})

