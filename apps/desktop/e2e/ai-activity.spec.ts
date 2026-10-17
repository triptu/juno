// The engine's AI on a key saved before launch, with the Juno agent running
// to answer its spend asks (SPEC 13.10), and the AI activity log in Settings
// that shows each call. The fake AI answers only with the key and inside the
// agent's daily cap, and reserves what the live provider would.
import { SELF_ID } from '@juno/fake-slack'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test('a saved key gives a new thread an AI title and art, Redraw draws it again, and AI activity shows the calls with their cost', async ({ fake, slackApp, userData }) => {
  test.setTimeout(180_000)
  const running = await launchApp(userData, {
    fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword,
    agent: true, fakeAiRequiresKey: true, aiJobs: true,
  })
  const juno = new Juno(running.app, running.win)
  try {
    await juno.signIn()
    await juno.waitForSync()
    // Every recent thread is drawn and titled, not only the new one.
    const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: 'Postgres migration. We should plan the next steps together.' })
    fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
    const row = running.win.locator(`[data-topic-row][data-topic-id="t:C0ENG:${root.ts}"]`)
    await expect(row).toHaveAttribute('data-title-source', 'ai', { timeout: 30_000 })
    await expect(row).toContainText('Postgres migration')
    await expect(row.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'art', { timeout: 30_000 })
    const before = await row.locator('[data-topic-art]').innerHTML()

    const sidebarRow = juno.sidebar.row('Postgres migration')
    await sidebarRow.chooseInMenu('redraw')
    await juno.expectToast('Redrawn · Postgres migration')
    await expect.poll(() => row.locator('[data-topic-art]').innerHTML()).not.toBe(before)

    await juno.openSettings('AI activity')
    const page = running.win.getByRole('main')
    const calls = page.getByRole('list', { name: 'AI calls' })
    for (const feature of ['titleTopic', 'topicArt', 'topicArt.redraw']) {
      const call = calls.locator(`[data-ai-call-feature="${feature}"][data-ai-call="ok"]`).first()
      await expect(call).toBeVisible()
      await expect(call).toContainText(/\$0\.\d{4}/)
    }
    // Today's spend is the ledger's, against the default limit.
    await expect(page.locator('[data-ai-activity-today-cost]')).toContainText('of $5.00 today')
    await expect(page.getByLabel('Daily limit in dollars')).toHaveValue('5')

    // A row opens to its details, named by the topic's title as it is now.
    const redraw = calls.locator('[data-ai-call-feature="topicArt.redraw"]').first()
    await expect(redraw).toContainText('Topic art, redrawn')
    await expect(redraw).toContainText('Postgres migration')
    await redraw.getByRole('button', { expanded: false }).click()
    const details = redraw.locator('[data-ai-call-details]')
    await expect(details).toContainText('Estimated cost')
    await expect(details).toContainText('fake')
    await expect(details.getByRole('button', { name: 'Copy details' })).toBeVisible()

    // The feature filter keeps only that feature's calls.
    await page.getByLabel('Feature').selectOption('topicArt.redraw')
    await expect(calls.locator('[data-ai-call-feature]')).toHaveCount(await calls.locator('[data-ai-call-feature="topicArt.redraw"]').count())
  } finally {
    await running.close()
  }
})
