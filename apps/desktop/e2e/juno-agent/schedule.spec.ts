// Schedules end to end (plan v3 §16 flow 6, §11, §19.2; SPEC 13.6): a schedule from a clean run
// shows a Schedule card and a row on Scheduled; after a quit past its due time the relaunch wakes it
// once. Pause, Resume and Delete on the page and the card. A tainted run only proposes a schedule.
// A reply watch made in the chat ends quietly when the person replies.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { Locator } from '@playwright/test'
import { Juno } from '../driver/juno'
import { launchApp, type LaunchOptions } from '../fixtures'
import { agentReady, card, openChat, openPage, ready } from './agent'
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

const test = chat.extend<{ readonly due: Due; readonly model: ScriptedModel; readonly launch: LaunchOptions }>({
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
  launch: async ({ fake, slackApp, model }, use) =>
    use({ fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin }),
})

test.describe.configure({ timeout: 180_000 })

const scheduleRow = (page: Locator, what: string) => page.locator('[data-schedule]').filter({ hasText: what })
const wakes = (model: ScriptedModel) => model.inputs().filter((input) => input.includes(CHECKLIST)).length

/** Relaunches on the same user data and waits for sync and the agent. */
async function relaunch(userData: string, options: LaunchOptions) {
  const running = await launchApp(userData, options)
  const juno = new Juno(running.app, running.win)
  await juno.waitForSync()
  await agentReady(running.app)
  return { running, juno }
}

test('a schedule from a clean run wakes once after a quit past its due time', async ({ juno, model, due, running, userData, launch }) => {
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

  await running.close()
  expect(due.at).toBeDefined()
  expect(wakes(model)).toBe(0)
  // Model elapsed time while the app is closed. No running process writes this database.
  // Both the definition and occurrence key move together; the restart runs the real scheduler.
  const db = new DatabaseSync(join(userData, 'agent', 'agent.sqlite'))
  try {
    const result = db.prepare("UPDATE schedules SET due_at = 1, definition = json_set(definition, '$.schedule.at', 1) WHERE state = 'active'").run()
    expect(result.changes).toBe(1)
  } finally {
    db.close()
  }

  const first = await relaunch(userData, launch)
  try {
    const again = await openChat(first.juno)
    await again.expectJuno('Here is the launch checklist.')
    expect(wakes(model)).toBe(1)
    await expect(again.junoBubble('Here is the launch checklist.')).toHaveCount(1)

    // A once schedule is gone after its wake.
    const page = await openPage(first.juno, 'Scheduled')
    await expect(page.getByText('Nothing scheduled')).toBeVisible()

    const activity = await openPage(first.juno, 'Activity')
    await expect(activity.locator('section[data-activity-run="replied"][aria-label^="A schedule,"]')).toHaveCount(1)
  } finally {
    await first.running.close()
  }

  const second = await relaunch(userData, launch)
  try {
    // The scheduler's first pass runs as the agent opens, so a wake would be ahead of this message.
    const last = await openChat(second.juno)
    await last.send('anything else?')
    await last.expectJuno('You said: anything else?')
    expect(wakes(model)).toBe(1)
    await expect(last.junoBubble('Here is the launch checklist.')).toHaveCount(1)
    const activity = await openPage(second.juno, 'Activity')
    await expect(activity.locator('section[data-activity-run][aria-label^="A schedule,"]')).toHaveCount(1)
  } finally {
    await second.running.close()
  }
})

test('a wake shows under a "Scheduled · …" group label', async ({ juno, running, userData, launch }) => {
  await ready(juno)
  const chatPane = await openChat(juno)
  await chatPane.send('remind me shortly')
  await chatPane.expectJuno('Scheduled.')
  await running.close()
  const db = new DatabaseSync(join(userData, 'agent', 'agent.sqlite'))
  try { db.prepare("UPDATE schedules SET due_at = 1, definition = json_set(definition, '$.schedule.at', 1)").run() } finally { db.close() }
  const next = await relaunch(userData, launch)
  try {
    const pane = await openChat(next.juno)
    await pane.expectJuno('Here is the launch checklist.')
    await expect(pane.root.locator('[data-chat-group-label]').filter({ hasText: 'Scheduled · Launch checklist' })).toBeVisible()
  } finally { await next.running.close() }
})

test('Pause, Resume and Delete work on the Scheduled page and on the Schedule card', async ({ juno }) => {
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

  // Delete on the card removes it from the page.
  await openChat(juno)
  await chatPane.send('schedule the retro')
  await chatPane.expectJuno('Scheduled.')
  const retro = card(chatPane, 'schedule').filter({ hasText: 'the retro' })
  await expect(retro).toHaveAttribute('data-card-status', 'open')
  const listed = await openPage(juno, 'Scheduled')
  await expect(scheduleRow(listed, 'the retro')).toHaveAttribute('data-schedule', 'active')
  await openChat(juno)
  await retro.getByRole('button', { name: 'Delete' }).click()
  await expect(retro).toHaveAttribute('data-card-status', 'done')
  await expect(retro).toContainText('Deleted')
  const after = await openPage(juno, 'Scheduled')
  await expect(after.getByText('Nothing scheduled')).toBeVisible()
})

test('a schedule from a run that read Slack is only proposed until the owner starts it', async ({ juno, model }) => {
  await ready(juno)
  const chatPane = await openChat(juno)
  await chatPane.send('read #eng then schedule the eng digest')
  await chatPane.expectJuno('It waits for you to start it.')
  expect(model.requests.some((request) => request.toolResult !== undefined && request.input.includes('read #eng'))).toBe(true)

  const proposed = card(chatPane, 'proposedSchedule')
  await expect(proposed).toHaveAttribute('data-card-status', 'open')
  await expect(proposed).toContainText('the eng digest')
  await expect(proposed.locator('[data-schedule-prompt]')).toHaveText('Catch me up: the eng digest.')
  await expect(card(chatPane, 'schedule')).toHaveCount(0)

  const before = await openPage(juno, 'Scheduled')
  await expect(before.getByText('Nothing scheduled')).toBeVisible()

  await openChat(juno)
  await proposed.getByRole('button', { name: 'Start' }).click()
  await expect(proposed).toHaveAttribute('data-card-status', 'done')
  await expect(proposed).toContainText('Started')
  await expect(card(chatPane, 'schedule').filter({ hasText: 'the eng digest' })).toBeVisible()
  const after = await openPage(juno, 'Scheduled')
  await expect(scheduleRow(after, 'the eng digest')).toHaveAttribute('data-schedule', 'active')
})

test('a reply watch made in the chat ends quietly when Leo replies', async ({ juno, slack, model }) => {
  await ready(juno)
  const chatPane = await openChat(juno)
  await chatPane.send("tell me if Leo doesn't reply by tomorrow")
  await chatPane.expectJuno('Scheduled.')
  await expect(card(chatPane, 'schedule').filter({ hasText: 'Leo on the cutover' })).toBeVisible()
  const page = await openPage(juno, 'Scheduled')
  await expect(scheduleRow(page, 'Leo on the cutover')).toHaveAttribute('data-schedule', 'active')

  slack.as('Leo').replyIn(POSTGRES, 'Cutover is a go')
  await expect(scheduleRow(page, 'Leo on the cutover')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText('Nothing scheduled')).toBeVisible()
  expect(model.inputs().some((input) => input.includes(WATCH))).toBe(false)
})

test.fixme('quiet hours hold the schedule notification only, and the wake still runs', async ({ juno, running, userData, launch }) => {
  // The agent host currently refuses host.notification.deliver.
  await ready(juno)
  await juno.openNotifications()
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    const button = juno.notifications.day('Notifications', day)
    if (await button.getAttribute('aria-pressed') === 'true') await button.click()
  }
  const chatPane = await openChat(juno)
  await chatPane.send('remind me shortly')
  await chatPane.expectJuno('Scheduled.')
  await running.close()
  const db = new DatabaseSync(join(userData, 'agent', 'agent.sqlite'))
  try { db.prepare("UPDATE schedules SET due_at = 1, definition = json_set(definition, '$.schedule.at', 1)").run() } finally { db.close() }
  const next = await relaunch(userData, launch)
  try {
    const pane = await openChat(next.juno)
    await pane.expectJuno('Here is the launch checklist.')
    expect(await next.juno.osNotifications()).toEqual([])
    await next.juno.openNotifications()
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      await next.juno.notifications.day('Notifications', day).click()
    }
    const hour = new Date().getHours()
    const label = (value: number) => `${value % 12 || 12}${value < 12 ? 'am' : 'pm'}`
    await next.juno.notifications.setFrom('Notifications', label((hour + 23) % 24))
    await next.juno.notifications.setTo('Notifications', label((hour + 2) % 24))
    await expect.poll(() => next.juno.osNotifications()).toContainEqual(expect.objectContaining({ body: expect.stringContaining('launch checklist') }))
  } finally { await next.running.close() }
})

test('"Tell me if nobody replies" on a message watches it and a reply ends the watch', async ({ juno, slack, model }) => {
  await ready(juno)
  const requests = model.requests.length
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.composer.fill('Can someone confirm the cutover?')
  await juno.topic.composer.press('Enter')
  const menu = await juno.topic.chooseInMessageMenu('Can someone confirm the cutover?', 'watch-reply')
  expect(menu.labels).toContain('Tell me if nobody replies')
  await expect(juno.win.getByRole('status')).toContainText('Watching for a reply until')
  expect(model.requests).toHaveLength(requests)
  const page = await openPage(juno, 'Scheduled')
  await expect(page.locator('[data-schedule]')).toHaveCount(1)
  slack.as('Leo').replyIn(POSTGRES, 'Cutover is a go')
  await expect(page.getByText('Nothing scheduled')).toBeVisible()
})

test('Undo on a menu reply watch deletes it without a model run', async ({ juno, model }) => {
  await ready(juno)
  const requests = model.requests.length
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.composer.fill('Please confirm the test window.')
  await juno.topic.composer.press('Enter')
  await juno.topic.chooseInMessageMenu('Please confirm the test window.', 'watch-reply')
  await expect(juno.win.getByRole('status')).toContainText('Watching for a reply until')
  await juno.undoFromToast()
  const page = await openPage(juno, 'Scheduled')
  await expect(page.getByText('Nothing scheduled')).toBeVisible()
  expect(model.requests).toHaveLength(requests)
})
