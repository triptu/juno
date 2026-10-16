/**
 * Quick reactions (SPEC 7, 14): chosen in Settings › Appearance, up to
 * seven, added from the emoji picker, removed, and reordered by keyboard and
 * by drag. The message toolbar shows them in that order, one click reacts,
 * and the choice survives a relaunch.
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

async function add(juno: Juno, query: string): Promise<void> {
  await juno.settings.root.getByRole('button', { name: 'Add reaction' }).click()
  const search = juno.settings.root.getByRole('textbox', { name: 'Search emoji' })
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
