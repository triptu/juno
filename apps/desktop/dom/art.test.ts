// Topic art and AI titles against the fake Slack and the fake AI (SPEC 5 "Row anatomy", 13.10,
// inventory 15.1 and 16), on an OpenRouter key saved before launch: a new thread gets an AI title
// and art; Redraw art in the row's menu and the header's title menu draws
// the topic again, and the toast's Undo and ⌘Z put the previous drawing back; AI activity in
// Settings shows each call with its cost; at the daily limit Redraw art says so, Change limit
// leads to the field, and a raised limit draws again without a restart. What AI assist off does to
// the jobs is the engine's ai-jobs flow test.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { SELF_ID } from '@juno/fake-slack'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { expect } from './expect'
import { domTest } from './test'

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'

domTest('a new thread gets an AI title and art, Redraw art undoes, AI activity shows the calls, and the daily limit stops and resumes drawing', async ({ juno, fake, userData, step }) => {
  await juno.signIn()
  await juno.waitForSync()
  const page = juno.win.getByRole('main')
  const postgres = juno.sidebar.row(POSTGRES)

  await step('a new thread gets an AI title and art', async () => {
    const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Postgres migration. We should plan the next steps together.' })
    fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
    const row = juno.win.locator(`[data-topic-row][data-topic-id="t:C0ENG:${root.ts}"]`)
    await expect(row).toHaveAttribute('data-title-source', 'ai', { timeout: 30_000 })
    await expect(row).toContainText('Postgres migration')
    await expect(row.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'art', { timeout: 30_000 })
  })

  await step('Redraw art draws a topic again, and Undo puts the previous drawing back', async () => {
    const first = await postgres.artMarkup()
    const topicId = await postgres.root.getAttribute('data-topic-id')
    const artSource = () => {
      const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'), { readOnly: true })
      try {
        return (db.prepare('SELECT source FROM topic_art WHERE topic_id = ?').get(topicId) as { source?: string } | undefined)?.source
      } finally { db.close() }
    }

    // From the row's menu, undone with the toast's Undo.
    await postgres.chooseInMenu('redraw')
    await juno.expectToast(`Redrawn · ${POSTGRES}`)
    await expect.poll(() => postgres.artMarkup()).not.toBe(first)
    await juno.workPass('art')
    expect(artSource()).toBe('redraw')
    await juno.undoFromToast()
    await expect.poll(() => postgres.artMarkup()).toBe(first)

    // From the header's title menu, undone with ⌘Z.
    await postgres.open()
    await juno.topic.expectTitle(POSTGRES)
    await juno.topic.chooseInMenu('redraw')
    await juno.expectToast(`Redrawn · ${POSTGRES}`)
    await expect.poll(() => postgres.artMarkup()).not.toBe(first)
    await juno.undo()
    await expect.poll(() => postgres.artMarkup()).toBe(first)
  })

  await step('AI activity lists each call with its cost', async () => {
    await juno.openSettings('AI activity')
    const calls = page.getByRole('list', { name: 'AI calls' })
    for (const feature of ['titleTopic', 'topicArt', 'topicArt.redraw']) {
      const call = calls.locator(`[data-ai-call-feature="${feature}"][data-ai-call="ok"]`).first()
      await expect(call).toBeVisible()
      await expect(call).toContainText(/\$0\.\d{4}/)
    }
  })

  await step('at the daily limit Redraw art says so and leads to the limit, and a raised limit draws without a restart', async () => {
    const limit = page.getByLabel('Daily limit in dollars')
    await expect(limit).toHaveValue('5')
    await limit.fill('0')
    await limit.press('Enter')
    await expect(page.locator('[data-ai-limit-reached]')).toBeVisible()
    await postgres.chooseInMenu('redraw')
    await juno.expectToast('Today’s AI limit of $0.00 is reached')
    await juno.win.getByRole('status').getByRole('button', { name: 'Change limit' }).click()
    await juno.tabs.expectActive('Settings')
    await expect(limit).toBeVisible()

    await limit.fill('2')
    await limit.press('Enter')
    await expect(page.locator('[data-ai-activity-today-cost]')).toContainText('of $2.00 today')
    await postgres.chooseInMenu('redraw')
    await juno.expectToast(`Redrawn · ${POSTGRES}`)
  })
}, { synced: false, engine: { fakeAiRequiresKey: true, aiJobs: true }, model: () => startFakeOpenRouter() })
