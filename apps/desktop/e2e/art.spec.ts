// Topic art's Redraw against the fake Slack and the fake AI (SPEC 5 "Row
// anatomy", inventory 15.1 and 16): Redraw in the row's menu and in the
// header's title menu draws the topic again, the toast's Undo and ⌘Z put the
// previous drawing back, and with AI assist off the menu has no Redraw.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'

test('Redraw draws a topic again, and Undo puts the previous drawing back', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const row = juno.sidebar.row(POSTGRES)
  const first = await row.artMarkup()

  // From the row's menu, undone with the toast's Undo.
  const { labels } = await row.chooseInMenu('redraw')
  expect(labels).toContain('Redraw')
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
})

test('with AI assist off, the topic menu has no Redraw', async ({ juno, fake, slackApp, userData, running }) => {
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  db.prepare(`INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run()
  db.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const { sidebar } = new Juno(again.app, again.win)
    const row = sidebar.row(POSTGRES)
    await row.expectVisible()
    await expect(row.art).toHaveAttribute('data-topic-art', 'placeholder')
    const { labels } = await row.chooseInMenu('pin')
    expect(labels).toContain('Pin')
    expect(labels).not.toContain('Redraw')
  } finally {
    await again.close()
  }
})
