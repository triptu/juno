// Buttons on a message (research integration-shapes.md, "Buttons on a
// Slackbot message"): Slackbot's note about people mentioned outside the
// channel shows Add Them, Let Them Know and Dismiss. A press goes to Slack
// once as `chat.attachmentAction`, built as the official client builds it,
// and the note changes as Slack's socket says: removed after Dismiss,
// replaced after Add Them. A press Slack refuses says so and can be tried
// again. The note is never the channel's latest message in the sidebar, and
// a relaunch drops it, as Slack's client does.
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const OUTSIDERS = ['U0ELENA', 'U0DEV']

/** Slackbot's note in #eng, which only the signed-in user sees. Answers its ts. */
async function mentionOutsiders(juno: Juno, fake: FakeSlack): Promise<string> {
  const note = fake.control('mentionOutsiders', { channel: 'C0ENG', users: OUTSIDERS }) as { ts: string }
  await expect(noteRow(juno)).toHaveCount(1)
  return note.ts
}

const noteRow = (juno: Juno) => juno.topic.list.locator('[data-message-row]').filter({ hasText: 'not in this channel' })

/** The `chat.attachmentAction` calls since the last reset, with their payload read. */
const presses = (fake: FakeSlack) =>
  fake.calls.filter((call) => call.method === 'chat.attachmentAction').map((call) => ({ args: call.args, payload: JSON.parse(call.args['payload'] ?? '{}') as Record<string, unknown> }))

const LATEST = 'Standup moves to ten tomorrow'

domTest('Slackbot\'s buttons on a mention of people outside the channel go to Slack, and the note follows Slack', async ({ juno, fake, slack, relaunch, step }) => {
  for (const user of OUTSIDERS) fake.leaveChannel({ channel: 'C0ENG', user })
  slack.as('Leo').postIn('eng', LATEST)
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await expect(juno.topic.message(LATEST)).toBeVisible()

  await step('the note is not the channel\'s preview; Dismiss sends the press and the note goes when Slack deletes it', async () => {
    const ts = await mentionOutsiders(juno, fake)
    await expect(juno.sidebar.row('#eng').preview).toContainText(LATEST)
    const row = noteRow(juno)
    await expect(row.getByRole('button', { name: 'Add Them' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Let Them Know' })).toBeVisible()
    fake.resetCalls()
    await row.getByRole('button', { name: 'Dismiss' }).click()
    await expect(row).toHaveCount(0)
    const sent = presses(fake)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.payload).toMatchObject({ channel_id: 'C0ENG', message_ts: ts, is_ephemeral: true, attachment_id: '1', actions: [{ name: 'ignore', value: 'ignore' }] })
    expect(sent[0]!.args['bot_user_id']).toBe('USLACKBOT')
  })

  await step('a press Slack refuses says so, and the buttons work again', async () => {
    await mentionOutsiders(juno, fake)
    const row = noteRow(juno)
    fake.forceError({ method: 'chat.attachmentAction', error: 'internal_error', times: 1 })
    await row.getByRole('button', { name: 'Add Them' }).click()
    await expect(row.getByRole('alert')).toContainText('Slack didn’t take that')
    await expect(row.locator('[data-attachment-buttons] > [role="group"]')).toHaveAttribute('aria-busy', 'false')
  })

  await step('Add Them adds them, and the note becomes Slack\'s answer without buttons', async () => {
    const row = noteRow(juno)
    const ts = await row.getAttribute('data-message-row')
    fake.resetCalls()
    await row.getByRole('button', { name: 'Add Them' }).click()
    const answered = juno.topic.list.locator('[data-message-row]').filter({ hasText: 'joined the channel' })
    await expect(answered).toHaveCount(1)
    await expect(answered.locator('[data-attachment-buttons]')).toHaveCount(0)
    await expect(noteRow(juno)).toHaveCount(0)
    const sent = presses(fake)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.payload).toMatchObject({ message_ts: ts, actions: [{ name: 'invite' }] })
    expect(String(sent[0]!.payload['callback_id'])).toStartWith(`consistentephemeralmentions_${OUTSIDERS.join(',')}_`)
    for (const user of OUTSIDERS) expect(fake.workspace.conversations.get('C0ENG')?.members.has(user)).toBe(true)
  })

  await step('a relaunch drops the note Slack replaced', async () => {
    await expect(juno.topic.list.locator('[data-message-row]').filter({ hasText: 'joined the channel' })).toHaveCount(1)
    const again = await relaunch()
    await again.sidebar.row('#eng').open()
    await expect(again.topic.message(LATEST)).toBeVisible()
    await expect(again.topic.list.locator('[data-message-row]').filter({ hasText: 'joined the channel' })).toHaveCount(0)
  })
})
