// What Juno does when a model refuses a request under its own policy (SPEC 15,
// "When a model call fails"; 13.10): the fallback model from another maker
// answers it, and AI activity shows both calls; with the fallback set to None
// the refusal is the answer, shows once, and is not sent again on later passes
// or after a wake. The fake AI refuses any input that holds `::refuse::`.
import { SELF_ID } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.use({ agentOptions: { agent: true }, fakeAiRequiresKey: true, aiJobs: true })

test('a refused title is answered by the fallback model, and with no fallback it shows once in AI activity and is not retried', async ({ juno, fake }) => {
  test.setTimeout(180_000)

  /** A followed thread in #eng: Leo asks, you reply. */
  const post = (text: string) => {
    const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text })
    fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
    return juno.win.locator(`[data-topic-row][data-topic-id="t:C0ENG:${root.ts}"]`)
  }
  const titleCalls = async () => (await juno.surface.aiCalls()).titleTopic ?? 0
  {
    await juno.signIn()
    await juno.waitForSync()
    const page = juno.win.getByRole('main')
    const calls = page.getByRole('list', { name: 'AI calls' })
    const titles = calls.locator('[data-ai-call-feature="titleTopic"]')
    const titlesThat = (outcome: string) => calls.locator(`[data-ai-call-feature="titleTopic"][data-ai-call="${outcome}"]`)

    // The main model refuses; the fallback, Gemini Flash by default, writes the title.
    const answered = post('::refuse:: Kya kar rahe hain idhar bhai')
    await expect(answered).toHaveAttribute('data-title-source', 'ai', { timeout: 30_000 })
    await juno.openSettings('AI activity')
    await expect(titles.filter({ hasText: 'Refused by the model’s policy. Sent to the fallback model.' })).toHaveCount(1)
    const fallback = titlesThat('ok').filter({ hasText: 'Answered by the fallback model' })
    await expect(fallback).toHaveCount(1)
    await expect(fallback).toContainText('google/')

    // With the fallback set to None, a refusal is the answer.
    await juno.openSettings('Juno')
    const choice = page.getByLabel('Fallback model')
    await expect(choice).toHaveValue('Gemini Flash')
    await choice.selectOption('')
    await expect(choice).toHaveValue('')
    // The persisted setting is observed through a fresh Settings view.
    await juno.openSettings('AI activity')
    await juno.openSettings('Juno')
    await expect(choice).toHaveValue('')

    const refused = post('::refuse:: Billing export for October')
    await juno.openSettings('AI activity')
    const notRetried = titlesThat('error').filter({ hasText: 'Refused by the model’s policy. Not retried.' })
    await expect(notRetried).toHaveCount(1, { timeout: 30_000 })
    const sent = await titleCalls()

    // A wake (a higher daily limit) and the passes after it do not send it again.
    const cap = page.getByLabel('Daily limit in dollars')
    await cap.fill('6').then(() => cap.press('Enter'))
    await expect(cap).toHaveValue('6')
    await juno.surface.workPass('title')
    expect(await titleCalls()).toBe(sent)
    await expect(notRetried).toHaveCount(1)
    await expect(refused).toHaveAttribute('data-title-source', 'fallback')
  }
})
