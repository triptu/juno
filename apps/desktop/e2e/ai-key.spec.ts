// The engine's AI (topic art, AI titles) runs on the OpenRouter key saved in
// Settings › Juno, the path the packaged app uses: main reads the keychain and
// hands the key to the engine in memory. The fake AI here answers only with
// that key and inside the agent's daily cap, as the live provider does.
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { SELF_ID } from '@juno/fake-slack'
import { expect, hooks, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

const KEY = 'fake-engine-test-key'

test('a saved key starts art and titles for recent topics, survives an engine restart, stays inside the cap, and removing it stops them', async ({ fake, slackApp, userData }) => {
  test.setTimeout(180_000)
  const model = await startFakeOpenRouter({ key: KEY })
  const running = await launchApp(userData, {
    fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword,
    fakeOpenRouterUrl: model.origin, fakeAiRequiresKey: true, aiJobs: true,
  })
  const juno = new Juno(running.app, running.win)
  /** A followed thread in #eng: Leo asks, you reply. */
  const post = (text: string) => {
    const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text })
    fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
    return running.win.locator(`[data-topic-row][data-topic-id="t:C0ENG:${root.ts}"]`)
  }
  const calls = () => hooks(running.app, 'aiCalls')
  try {
    const first = post('Postgres migration. We should plan the next steps together.')
    await juno.signIn()
    await juno.waitForSync()

    // No key: the fallback title and the placeholder art, and no model call.
    await expect(first).toBeVisible()
    await expect(first).toHaveAttribute('data-title-source', 'fallback')
    await expect(first.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'placeholder')
    await running.win.waitForTimeout(3_500)
    expect(await calls()).toEqual({})

    // Saving a key starts both jobs without a restart and without opening the topic.
    await juno.openSettings('Juno')
    const page = running.win.getByRole('main')
    const missing = page.getByText('Topic art and AI titles need an OpenRouter key.')
    await expect(missing).toBeVisible()
    const pid = await hooks(running.app, 'enginePid')
    await page.getByLabel('API key', { exact: true }).fill(KEY)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(missing).toHaveCount(0)
    await expect(first).toHaveAttribute('data-title-source', 'ai', { timeout: 15_000 })
    await expect(first).toContainText('Postgres migration')
    await expect(first.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'art', { timeout: 15_000 })
    expect((await calls()).titleTopic).toBeGreaterThan(0)
    expect((await calls()).topicArt).toBeGreaterThan(0)
    expect(await hooks(running.app, 'enginePid')).toBe(pid)

    // After an engine crash, main sends the key again: a new topic still gets its title.
    process.kill(pid!, 'SIGKILL')
    await expect.poll(() => hooks(running.app, 'enginePid'), { timeout: 15_000 }).not.toBe(pid)
    await expect.poll(() => hooks(running.app, 'engineState'), { timeout: 15_000 }).toBe('ready')
    const afterRestart = post('Kafka retention. The consumer lag alert keeps firing overnight.')
    await expect(afterRestart).toHaveAttribute('data-title-source', 'ai', { timeout: 30_000 })

    // A $0 daily cap blocks the engine's calls too; raising it wakes the title job, which does not wait for its 30 s timer.
    await juno.openSettings('AI activity')
    const cap = page.getByLabel('Daily limit in dollars')
    await cap.fill('0')
    await cap.press('Enter')
    await expect(cap).toHaveValue('0')
    const capped = await calls()
    const atCap = post('Billing export. The CSV for October is missing two columns.')
    await expect(atCap).toBeVisible()
    await running.win.waitForTimeout(5_000)
    await expect(atCap).toHaveAttribute('data-title-source', 'fallback')
    expect(await calls()).toEqual(capped)
    await cap.fill('2')
    await cap.press('Enter')
    await expect(atCap).toHaveAttribute('data-title-source', 'ai', { timeout: 8_000 })
    await juno.openSettings('Juno')

    // Removing the key stops new calls at once.
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(missing).toBeVisible()
    const stopped = await calls()
    const afterRemoval = post('Redis replica. Investigate this new issue after removing the key.')
    await expect(afterRemoval).toBeVisible()
    await running.win.waitForTimeout(5_000)
    expect(await calls()).toEqual(stopped)
    await expect(afterRemoval).toHaveAttribute('data-title-source', 'fallback')
    await expect(afterRemoval.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'placeholder')
  } finally {
    await running.close()
    await model.close()
  }
})
