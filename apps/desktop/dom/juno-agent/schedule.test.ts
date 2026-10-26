// Schedules end to end (plan v3 §16 flow 6, §11, §19.2; SPEC 13.6): Pause, Resume and Delete on the
// Scheduled page and the card; a tainted run only proposes a schedule until the owner starts it.
// Reply watches made in the chat and from the message menu end quietly when the person replies.
import type { FakeSlack } from '@juno/fake-slack'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { Slack } from '../../e2e/driver/slack'
import { answer as echo, startScriptedModel } from '../../e2e/juno-agent/model'
import { card, openChat, openPage, readySynced as ready } from '../driver/agent'
import { expect } from '../expect'
import type { Query } from '../query'
import { domTest } from '../test'

const WATCH = 'Check whether Leo answered about the cutover.'
const ENG = 'C0ENG'
const LEO = 'U0LEO'
// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const HOUR = 3_600_000

/**
 * "schedule <what>" creates a one-time schedule an hour ahead; "read #eng then schedule <what>" reads
 * Slack first, so the run is tainted; "tell me if Leo doesn't reply" watches the Postgres thread.
 */
function scripted(postgres: () => { readonly channel: string; readonly root: string; readonly last: string }) {
  return (request: OpenRouterRequest): string | ToolCallAnswer => {
    const { input, toolResult } = request
    if (toolResult?.includes('Proposed schedule')) return '<say>It waits for you to start it.</say>'
    if (toolResult?.includes('Created schedule')) return '<say>Scheduled.</say>'
    const what = /schedule (.+)$/.exec(input.replace(/<[^>]*>/g, ''))?.[1]
    if (/read #eng/.test(input) && what !== undefined) {
      if (toolResult === undefined) return { toolCall: { name: 'slack_history', arguments: { channel: ENG } } }
      return { toolCall: { name: 'schedule_create', arguments: { what, prompt: `Catch me up: ${what}.`, schedule: { _tag: 'interval', everyMs: HOUR }, deliver: 'digest' } } }
    }
    if (/tell me if Leo doesn't reply/.test(input)) {
      const root = postgres()
      return {
        toolCall: {
          name: 'schedule_create',
          arguments: { what: 'Leo on the cutover', prompt: WATCH, schedule: { _tag: 'once', at: Date.now() + HOUR }, deliver: 'now', unlessReply: { channelId: root.channel, ts: root.last, threadTs: root.root, from: [LEO] } },
        },
      }
    }
    if (what !== undefined) return { toolCall: { name: 'schedule_create', arguments: { what, prompt: `Remind me: ${what}.`, schedule: { _tag: 'once', at: Date.now() + HOUR }, deliver: 'now' } } }
    return echo(request)
  }
}

interface Thread { readonly channel: string; readonly root: string; readonly last: string }

/** The model, and where the test tells it which thread to watch once the fake Slack is up. */
async function model() {
  const thread: { find?: () => Thread } = {}
  const scriptedModel = await startScriptedModel({ answer: scripted(() => thread.find!()) })
  return Object.assign(scriptedModel, { thread })
}

/** Leo already replied in the thread, so the watch starts after its newest message. */
const postgresThread = (slack: Slack, fake: FakeSlack) => (): Thread => {
  const { channel, ts } = slack.root(POSTGRES)
  const last = fake.messages(channel).filter((message) => message.thread_ts === ts).map((message) => message.ts).toSorted((a, b) => Number(a) - Number(b)).at(-1) ?? ts
  return { channel, root: ts, last }
}

const scheduleRow = (page: Query, what: string) => page.locator('[data-schedule]').filter({ hasText: what })

// A schedule from a clean run waking once after a quit past its due time, under its own label: the agent's
// schedule-flow test.

// One launch: the reply watches first, which end with nothing scheduled, then the Scheduled page's buttons.
domTest('Pause, Resume and Delete work on the Scheduled page and the card, a schedule from a run that read Slack waits for Start, and reply watches end quietly when the person replies', async ({ juno, slack, fake, model, step }) => {
  model.thread.find = postgresThread(slack, fake)
  await ready(juno)
  await step('Undo on a menu reply watch deletes it without a model run', async () => {
    const requests = model.inputs().length
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.composer.fill('Please confirm the test window.')
    await juno.topic.composer.press('Enter')
    // Only a message Slack has can be watched.
    await juno.topic.expectSent('Please confirm the test window.')
    await juno.topic.chooseInMessageMenu('Please confirm the test window.', 'watch-reply')
    await expect(juno.win.getByRole('status')).toContainText('Watching for a reply until')
    await juno.undoFromToast()
    const page = await openPage(juno, 'Scheduled')
    await expect(page.getByText('Nothing scheduled')).toBeVisible()
    expect(model.inputs()).toHaveLength(requests)
  })

  await step('a watch made in the chat and "Tell me if nobody replies" on a message both end when Leo replies, with no wake', async () => {
    const chatPane = await openChat(juno)
    await chatPane.send("tell me if Leo doesn't reply by tomorrow")
    await chatPane.expectJuno('Scheduled.')
    await expect(card(chatPane, 'schedule').filter({ hasText: 'Leo on the cutover' })).toBeVisible()

    const requests = model.inputs().length
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.composer.fill('Can someone confirm the cutover?')
    await juno.topic.composer.press('Enter')
    // Only a message Slack has can be watched.
    await juno.topic.expectSent('Can someone confirm the cutover?')
    const menu = await juno.topic.chooseInMessageMenu('Can someone confirm the cutover?', 'watch-reply')
    expect(menu.labels).toContain('Tell me if nobody replies')
    await expect(juno.win.getByRole('status')).toContainText('Watching for a reply until')
    expect(model.inputs()).toHaveLength(requests)
    const page = await openPage(juno, 'Scheduled')
    await expect(page.locator('[data-schedule]')).toHaveCount(2)
    await expect(scheduleRow(page, 'Leo on the cutover')).toHaveAttribute('data-schedule', 'active')
    slack.as('Leo').replyIn(POSTGRES, 'Cutover is a go')
    await expect(page.getByText('Nothing scheduled')).toBeVisible({ timeout: 30_000 })
    expect(model.inputs().some((input) => input.includes(WATCH))).toBe(false)
  })
  await step('Pause, Resume and Delete on the page and the card, and a proposed schedule waits for Start', async () => {
    const chatPane = await openChat(juno)
    await chatPane.send('schedule standup notes')
    await chatPane.expectJuno('Scheduled.')
    const standup = card(chatPane, 'schedule').filter({ hasText: 'standup notes' })
    await expect(standup).toHaveAttribute('data-card-status', 'open')

    // Pause on the card, then Resume, Pause, Resume and Delete on the page.
    await standup.getByRole('button', { name: 'Pause' }).click()
    await expect(standup).toHaveAttribute('data-card-status', 'done')
    await expect(standup).toContainText('Paused')
    const page = await openPage(juno, 'Scheduled')
    const row = scheduleRow(page, 'standup notes')
    await expect(row).toHaveAttribute('data-schedule', 'paused')
    await expect(row).not.toContainText('Next ')
    await row.getByRole('button', { name: 'Resume' }).click()
    await expect(row).toHaveAttribute('data-schedule', 'active')
    await expect(row).toContainText('Next ')
    await row.getByRole('button', { name: 'Pause' }).click()
    await expect(row).toHaveAttribute('data-schedule', 'paused')
    await row.getByRole('button', { name: 'Resume' }).click()
    await expect(row).toHaveAttribute('data-schedule', 'active')
    await row.getByRole('button', { name: 'Delete' }).click()
    await expect(row).toHaveCount(0)
    await expect(page.getByText('Nothing scheduled')).toBeVisible()

    // A run that read Slack only proposes its schedule: nothing is scheduled until Start.
    await openChat(juno)
    await chatPane.send('read #eng then schedule the eng digest')
    await chatPane.expectJuno('It waits for you to start it.')
    expect(model.requests.some((request) => request.toolResult !== undefined && request.input.includes('read #eng'))).toBe(true)
    const proposed = card(chatPane, 'proposedSchedule')
    await expect(proposed).toHaveAttribute('data-card-status', 'open')
    await expect(proposed).toContainText('the eng digest')
    await expect(proposed.locator('[data-schedule-prompt]')).toHaveText('Catch me up: the eng digest.')
    await expect(card(chatPane, 'schedule').filter({ hasText: 'the eng digest' })).toHaveCount(0)
    await expect((await openPage(juno, 'Scheduled')).getByText('Nothing scheduled')).toBeVisible()
    await openChat(juno)
    await proposed.getByRole('button', { name: 'Start' }).click()
    await expect(proposed).toHaveAttribute('data-card-status', 'done')
    await expect(proposed).toContainText('Started')
    const digest = card(chatPane, 'schedule').filter({ hasText: 'the eng digest' })
    await expect(digest).toBeVisible()
    const listed = await openPage(juno, 'Scheduled')
    await expect(scheduleRow(listed, 'the eng digest')).toHaveAttribute('data-schedule', 'active')

    // Delete on the card removes it from the page.
    await openChat(juno)
    await digest.getByRole('button', { name: 'Delete' }).click()
    await expect(digest).toHaveAttribute('data-card-status', 'done')
    await expect(digest).toContainText('Deleted')
    const after = await openPage(juno, 'Scheduled')
    await expect(after.getByText('Nothing scheduled')).toBeVisible()
  })
  // Undo first: it leaves nothing scheduled, so the second watch is the only one.
}, { model, timeout: 180_000 })
