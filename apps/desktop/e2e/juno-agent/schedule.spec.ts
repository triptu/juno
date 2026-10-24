// Schedules end to end (plan v3 §16 flow 6, §11, §19.2; SPEC 13.6): a schedule from a clean run
// shows a Schedule card and a row on Scheduled; after a quit past its due time the relaunch wakes it
// once. Pause, Resume and Delete on the page and the card; a tainted run only proposes a schedule
// until the owner starts it. Reply watches made in the chat and from the message menu end quietly
// when the person replies.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { Locator } from '@playwright/test'
import { agentReady, card, openChat, openPage, readySynced as ready } from './agent'
import { answer as echo, expect, test as chat } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

const CHECKLIST = 'Post the launch checklist to me.'
const WATCH = 'Check whether Leo answered about the cutover.'
const ENG = 'C0ENG'
const LEO = 'U0LEO'
// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const HOUR = 3_600_000

/** Where the scripted model put the one-time schedule it created. */
interface Due {
  at?: number
}

/**
 * "remind me shortly" creates a one-time schedule `lead` ms ahead; "schedule <what>" one an hour
 * ahead; "read #eng then schedule <what>" reads Slack first, so the run is tainted; "tell me if Leo
 * doesn't reply" watches the Postgres thread. A wake running CHECKLIST answers with the checklist.
 */
function scripted(due: Due, lead: number, postgres: () => { readonly channel: string; readonly root: string; readonly last: string }) {
  return (request: OpenRouterRequest): string | ToolCallAnswer => {
    const { input, toolResult } = request
    if (input.includes(CHECKLIST)) return '<say>Here is the launch checklist.</say>'
    if (toolResult?.includes('Proposed schedule')) return '<say>It waits for you to start it.</say>'
    if (toolResult?.includes('Created schedule')) return '<say>Scheduled.</say>'
    const what = /schedule (.+)$/.exec(input.replace(/<[^>]*>/g, ''))?.[1]
    if (/read #eng/.test(input) && what !== undefined) {
      if (toolResult === undefined) return { toolCall: { name: 'slack_history', arguments: { channel: ENG } } }
      return { toolCall: { name: 'schedule_create', arguments: { what, prompt: `Catch me up: ${what}.`, schedule: { _tag: 'interval', everyMs: HOUR }, deliver: 'digest' } } }
    }
    if (/remind me shortly/.test(input)) {
      due.at = Date.now() + lead
      return { toolCall: { name: 'schedule_create', arguments: { what: 'Launch checklist', prompt: CHECKLIST, schedule: { _tag: 'once', at: due.at }, deliver: 'now' } } }
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

// Long enough to see the card and the row and quit before it is due, even on a loaded machine.
const LEAD = HOUR

const test = chat.extend<{ readonly due: Due; readonly model: ScriptedModel }>({
  // oxlint-disable-next-line no-empty-pattern
  due: async ({}, use) => use({}),
  model: async ({ due, slack, fake }, use) => {
    // Leo already replied in the thread, so the watch starts after its newest message.
    const thread = () => {
      const { channel, ts } = slack.root(POSTGRES)
      const last = fake.messages(channel).filter((message) => message.thread_ts === ts).map((message) => message.ts).toSorted((a, b) => Number(a) - Number(b)).at(-1) ?? ts
      return { channel, root: ts, last }
    }
    const model = await startScriptedModel({ answer: scripted(due, LEAD, thread) })
    await use(model)
    await model.close()
  },

})

test.use({ synced: true })

test.describe.configure({ timeout: 180_000 })

const scheduleRow = (page: Locator, what: string) => page.locator('[data-schedule]').filter({ hasText: what })
const wakes = (model: ScriptedModel) => model.inputs().filter((input) => input.includes(CHECKLIST)).length

test('a schedule from a clean run wakes once after a quit past its due time, under its own label', async ({ juno, model, due, relaunch, userData }) => {
  const wakesOnce = 'a schedule from a clean run wakes once after a quit past its due time'
  await test.step(wakesOnce, async () => {
    await ready(juno)
    const chatPane = await openChat(juno)
    await chatPane.send('remind me shortly')
    await chatPane.expectJuno('Scheduled.')
    const scheduleCard = card(chatPane, 'schedule')
    await expect(scheduleCard).toHaveAttribute('data-card-status', 'open')
    await expect(scheduleCard).toContainText('Launch checklist')
    await expect(scheduleCard).toContainText('Delivers: Now')

    const scheduled = await openPage(juno, 'Scheduled')
    await expect(scheduleRow(scheduled, 'Launch checklist')).toHaveAttribute('data-schedule', 'active')
    await expect(scheduleRow(scheduled, 'Launch checklist')).toContainText('Next ')

    expect(due.at).toBeDefined()
    expect(wakes(model)).toBe(0)
  })

  const first = await relaunch({ whileClosed: async () => {
    const db = new DatabaseSync(join(userData, 'agent', 'agent.sqlite'))
    try {
      expect(db.prepare("UPDATE schedules SET due_at = 1, definition = json_set(definition, '$.schedule.at', 1) WHERE state = 'active'").run().changes).toBe(1)
    } finally { db.close() }
  } })
  await first.waitForSync()
  await agentReady(first.surface)
  {
    const again = await openChat(first)
    await test.step(wakesOnce, async () => {
      await again.expectJuno('Here is the launch checklist.')
      expect(wakes(model)).toBe(1)
      await expect(again.junoBubble('Here is the launch checklist.')).toHaveCount(1)
    })
    await test.step('a wake shows under a "Scheduled · …" group label', async () => {
      await expect(again.root.locator('[data-chat-group-label]').filter({ hasText: 'Scheduled · Launch checklist' })).toBeVisible()
    })

    await test.step(wakesOnce, async () => {
      // A once schedule is gone after its wake.
      const page = await openPage(first, 'Scheduled')
      await expect(page.getByText('Nothing scheduled')).toBeVisible()

      const activity = await openPage(first, 'Activity')
      await expect(activity.locator('[data-activity-run="replied"]').filter({ has: first.win.locator('[data-activity-trigger="schedule"]') })).toHaveCount(1)
    })
  }

  const second = await relaunch()
  await second.waitForSync()
  await agentReady(second.surface)
  {
    await test.step(wakesOnce, async () => {
      // The scheduler's first pass runs as the agent opens, so a wake would be ahead of this message.
      const last = await openChat(second)
      await last.send('anything else?')
      await last.expectJuno('You said: anything else?')
      expect(wakes(model)).toBe(1)
      await expect(last.junoBubble('Here is the launch checklist.')).toHaveCount(1)
      const activity = await openPage(second, 'Activity')
      await expect(activity.locator('[data-activity-run]').filter({ has: second.win.locator('[data-activity-trigger="schedule"]') })).toHaveCount(1)
    })
  }
})

test('Pause, Resume and Delete work on the Scheduled page and on the Schedule card, and a schedule from a run that read Slack waits for Start', async ({ juno, model }) => {
  await ready(juno)
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

test('reply watches from the chat and the message menu: Undo deletes one, and a reply ends the others quietly', async ({ juno, slack, model }) => {
  await ready(juno)
  // Undo first: it leaves nothing scheduled, so the second watch is the only one.
  await test.step('Undo on a menu reply watch deletes it without a model run', async () => {
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

  await test.step('a watch made in the chat and "Tell me if nobody replies" on a message both end when Leo replies, with no wake', async () => {
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
})
