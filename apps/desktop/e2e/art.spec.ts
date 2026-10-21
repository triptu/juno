import type { Fixtures } from './fixtures'
// Topic art's Redraw art against the fake Slack and the fake AI (SPEC 5 "Row
// anatomy", inventory 15.1 and 16): Redraw art in the row's menu and in the
// header's title menu draws the topic again, the toast's Undo and ⌘Z put the
// previous drawing back, and the menu has no Redraw art when no drawing can
// be made: AI assist off or no OpenRouter key. Home's destination list
// draws a channel with its Main's art, as the sidebar does. At the daily AI limit Redraw
// art says so, and Change limit leads to the field in Settings › AI activity.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })
// These tests watch the background art job.
test.use({ aiJobs: true })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'

test('shares channel art with Home and redraws topic art with Undo', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const context = { juno }
  await test.step("a channel in Home's destination list shows the art its Main row shows in the sidebar", () => homeChannelArt(context))
  await test.step('Redraw art draws a topic again, and Undo puts the previous drawing back', () => redrawTopicArt(context))
})

async function homeChannelArt({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const markup = await juno.sidebar.row('#eng').artMarkup()
  await juno.write.chip.click()
  await juno.write.search.fill('eng')
  const tile = juno.write.option('eng').locator('[data-topic-art]')
  await expect(tile).toHaveAttribute('data-topic-art', 'art', { timeout: 15_000 })
  // The sizes differ, so compare the drawing's hue: the ink colour every stroke starts from.
  const ink = (svg: string) => /stroke="(var\([^"]+\))"/.exec(svg)?.[1]
  expect(ink(markup)).toBeDefined()
  expect(ink(await tile.innerHTML())).toBe(ink(markup))
  await juno.win.keyboard.press('Escape')
  await expect(juno.write.list).toBeHidden()
}

async function redrawTopicArt({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const row = juno.sidebar.row(POSTGRES)
  const first = await row.artMarkup()

  // From the row's menu, undone with the toast's Undo.
  const { labels } = await row.chooseInMenu('redraw')
  expect(labels).toContain('Redraw art')
  await juno.expectToast(`Redrawn · ${POSTGRES}`)
  await expect.poll(() => row.artMarkup()).not.toBe(first)
  await juno.undoFromToast()
  await expect.poll(() => row.artMarkup()).toBe(first)

  // From the header's title menu, undone with ⌘Z.
  await row.open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.topic.chooseInMenu('redraw')
  await juno.expectToast(`Redrawn · ${POSTGRES}`)
  await expect.poll(() => row.artMarkup()).not.toBe(first)
  await juno.undo()
  await expect.poll(() => row.artMarkup()).toBe(first)
}

test('with AI assist off, the topic menu has no Redraw art and a selection offers Quote alone', async ({ juno, fake, slackApp, userData, running }) => {
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  db.prepare(`INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run()
  db.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, aiJobs: true })
  try {
    const { sidebar, topic } = new Juno(again.app, again.win)
    const row = sidebar.row(POSTGRES)
    await row.expectVisible()
    await expect(row.art).toHaveAttribute('data-topic-art', 'placeholder')

    // Text selected in a message: the toolbar has Quote and no Ask Juno.
    await row.open()
    const text = topic.message(POSTGRES).locator('[data-msg-text] p').first()
    const box = (await text.boundingBox())!
    await text.evaluate((node) => {
      const range = document.createRange()
      range.setStart(node.firstChild!, 0)
      range.setEnd(node.firstChild!, 'Draft plan'.length)
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
    })
    await text.dispatchEvent('pointerup', { bubbles: true, clientX: box.x + 20, clientY: box.y + 5 })
    const toolbar = again.win.getByRole('toolbar', { name: 'Selection' })
    await expect(toolbar.getByRole('button', { name: 'Quote' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Ask Juno' })).toHaveCount(0)

    const { labels } = await row.chooseInMenu('pin')
    expect(labels).toContain('Pin')
    expect(labels).not.toContain('Redraw art')
  } finally {
    await again.close()
  }
})

test('Redraw art needs an OpenRouter key; at the daily limit it says so, and a raised limit draws without a restart', async ({ fake, slackApp, userData }) => {
  const KEY = 'fake-engine-test-key'
  const model = await startFakeOpenRouter({ key: KEY })
  const running = await launchApp(userData, {
    fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword,
    fakeOpenRouterUrl: model.origin, fakeAiRequiresKey: true, aiJobs: true,
  })
  try {
    const juno = new Juno(running.app, running.win)
    await juno.signIn()
    await juno.waitForSync()
    const row = juno.sidebar.row(POSTGRES)
    const labels = async () => (await row.chooseInMenu('copy-link')).labels

    // No key.
    expect(await labels()).not.toContain('Redraw art')

    await juno.openSettings('Juno')
    const page = running.win.getByRole('main')
    await page.getByLabel('API key', { exact: true }).fill(KEY)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Topic art and AI titles need an OpenRouter key.')).toHaveCount(0)
    await expect.poll(labels).toContain('Redraw art')

    // A low limit, reached: Redraw art says so and leads to the limit.
    await juno.openSettings('AI activity')
    const limit = page.getByLabel('Daily limit in dollars')
    await expect(limit).toHaveValue('5')
    await limit.fill('0')
    await limit.press('Enter')
    await expect(page.locator('[data-ai-activity-today-cost]')).toContainText('of $0.00 today')
    await expect(page.locator('[data-ai-limit-reached]')).toBeVisible()
    await row.chooseInMenu('redraw')
    await juno.expectToast('Today’s AI limit of $0.00 is reached')
    await running.win.getByRole('status').getByRole('button', { name: 'Change limit' }).click()
    await juno.tabs.expectActive('Settings')
    await expect(limit).toBeVisible()

    // Raised: the same app draws again.
    await limit.fill('2')
    await limit.press('Enter')
    await expect(page.locator('[data-ai-activity-today-cost]')).toContainText('of $2.00 today')
    await row.chooseInMenu('redraw')
    await juno.expectToast(`Redrawn · ${POSTGRES}`)
  } finally {
    await running.close()
    await model.close()
  }
})
