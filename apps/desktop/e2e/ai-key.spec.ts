import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { SELF_ID } from '@juno/fake-slack'
import { expect, hooks, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test('saving a key starts sidebar art and titles; removing it stops new calls', async ({ fake, slackApp, userData }) => {
  test.setTimeout(120_000)
  const model = await startFakeOpenRouter({ key: 'fake-engine-test-key' })
  const running = await launchApp(userData, {
    fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword,
    fakeOpenRouterUrl: model.origin, fakeAiRequiresKey: true,
  })
  const juno = new Juno(running.app, running.win)
  const post = (text: string) => {
    const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text })
    fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
    return `t:C0ENG:${root.ts}`
  }
  try {
    const id = post('Postgres migration. We should plan the next steps together.')
    await juno.signIn()
    await juno.waitForSync()
    const row = running.win.locator(`[data-topic-row][data-topic-id="${id}"]`)
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('data-title-source', 'fallback')
    await expect(row.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'placeholder')
    await running.win.waitForTimeout(3_500)
    expect(await hooks(running.app, 'aiCalls')).toEqual({})
    const pid = await hooks(running.app, 'enginePid')

    await juno.openSettings('Juno')
    const page = running.win.getByRole('main')
    const missing = page.getByText('Topic art and AI titles need an OpenRouter key.')
    await expect(missing).toBeVisible()
    await page.getByLabel('API key', { exact: true }).fill('fake-engine-test-key')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(missing).toHaveCount(0)
    // Settings stays open: no sidebar thread was opened to fetch its title.
    await expect(row).toHaveAttribute('data-title-source', 'ai', { timeout: 15_000 })
    await expect(row).toContainText('Postgres migration')
    await expect(row.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'art', { timeout: 15_000 })
    await expect.poll(async () => (await hooks(running.app, 'aiCalls')).followUps ?? 0, { timeout: 15_000 }).toBeGreaterThan(0)
    const calls = await hooks(running.app, 'aiCalls')
    expect(calls.titleTopic).toBeGreaterThan(0)
    expect(calls.titleTopic).toBeLessThanOrEqual(200)
    expect(calls.topicArt).toBeGreaterThan(0)
    expect(await hooks(running.app, 'enginePid')).toBe(pid)

    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(missing).toBeVisible()
    const stopped = await hooks(running.app, 'aiCalls')
    const next = post('Redis replica. Investigate this new issue after removing the key.')
    const newRow = running.win.locator(`[data-topic-row][data-topic-id="${next}"]`)
    await expect(newRow).toBeVisible()
    await running.win.waitForTimeout(5_000)
    expect(await hooks(running.app, 'aiCalls')).toEqual(stopped)
    await expect(newRow).toHaveAttribute('data-title-source', 'fallback')
    await expect(newRow.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'placeholder')
    expect(await hooks(running.app, 'enginePid')).toBe(pid)
  } finally {
    await running.close()
    await model.close()
  }
})
