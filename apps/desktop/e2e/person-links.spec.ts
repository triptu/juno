// A person in a message (spec section 7, "People"): a click on a sender's
// name or avatar, or on an @person chip, opens your DM with them as a Slack
// link to them does (section 8). A new tab on the DM's Main, or the tab that
// already shows it; ⌘-click opens the tab behind the current one, and Home
// addressed to them when you have no DM. A drag that starts on the name
// selects nothing and opens nothing. An app opens its DM when Juno has one,
// also once it arrives; otherwise it opens nothing and does not look like it
// would. A deactivated person's DM opens read-only.
import type { FakeSlack } from '@juno/fake-slack'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const SELF = 'U0TUSHAR'
const POSTGRES = 'Draft plan is in the doc'
const FIRST = 'Maya first: the dry run slot is booked.'
const MENTION = 'Leo asks Sam to check the replica sizing.'
const SECOND = 'Maya again: the doc has the new numbers.'
const ALERT = 'Replication lag above 30 seconds on the new cluster.'
const DEPLOY = 'Deployed the read-only flag to staging.'
const DEV = '4 minutes is fine for us'
const OWN = "Good. What's the rollback"

const rootOf = (fake: FakeSlack) => fake.messages('C0ENG').find((message) => message.text?.includes(POSTGRES))!
const reply = (fake: FakeSlack, user: string, text: string) => fake.workspace.post({ channel: 'C0ENG', user, threadTs: rootOf(fake).ts, text, silent: true })

/** A DM with `user`, with one message so it has a Main. Before sign-in. */
function addDm(fake: FakeSlack, id: string, user: string, text: string): void {
  fake.workspace.addConversation({ id, name: '', kind: 'im', members: new Set([SELF, user]), created: fake.now() - 30 * 86_400_000, topic: '', purpose: '', isOpen: true, archived: false })
  fake.workspace.post({ channel: id, user, text, at: fake.now() - 86_400_000, silent: true })
}

/** Replies in the Postgres thread: Maya, Leo naming Sam, Maya again (a new header), the Grafana app and Deploy Bot, whose DM Juno has. */
function seedReplies(fake: FakeSlack): void {
  addDm(fake, 'D0DEPLOY', 'U0DEPLOYBOT', 'Deploys for this week are in the calendar.')
  reply(fake, 'U0MAYA', FIRST)
  reply(fake, 'U0LEO', `${MENTION} <@U0SAM> can you look?`)
  reply(fake, 'U0MAYA', SECOND)
  reply(fake, 'U0GRAFANA', ALERT)
  reply(fake, 'U0DEPLOYBOT', DEPLOY)
}

async function openPostgres(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.expectCount(1)
}

/** The sender's name on the message that starts with `text`, and the link around its name or avatar when it opens their DM. */
const name = (juno: Juno, text: string) => juno.topic.message(text).locator('[data-message-header] [data-sender]')
const link = (juno: Juno, text: string, part: 'name' | 'avatar' = 'name') =>
  juno.topic.message(text).locator(part === 'name' ? '[data-message-header] [data-opens-person]' : '[data-sender] [data-opens-person]')

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!
  return { x: box.x + Math.min(12, box.width / 2), y: box.y + box.height / 2 }
}

/** Presses at `from`, moves to `to`, and lets go at `end`. */
async function drag(win: Page, from: { x: number; y: number }, to: { x: number; y: number }, end = to): Promise<void> {
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 8 })
  await win.mouse.move(end.x, end.y, { steps: 8 })
  await win.mouse.up()
}

test('a sender or @person opens your DM with them, in a new tab or the one that shows it', async ({ juno, fake }) => {
  seedReplies(fake)
  await openPostgres(juno)
  const { topic, tabs, win } = juno
  await topic.message(FIRST).scrollIntoViewIfNeeded()

  await test.step('a drag that starts on the name selects nothing and opens nothing', async () => {
    await drag(win, await centre(name(juno, FIRST)), await centre(topic.message(FIRST).locator('[data-msg-text]')))
    expect(await win.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
    await tabs.expectCount(1)
  })

  await test.step('a press that moves away and comes back opens nothing', async () => {
    const start = await centre(name(juno, FIRST))
    await drag(win, start, { x: start.x + 40, y: start.y + 30 }, start)
    await tabs.expectCount(1)
  })

  await test.step('a double-click on the name opens one tab, with a tooltip saying where it goes', async () => {
    // A pressed control shows no tooltip until the pointer has left it.
    await win.mouse.move(0, 0)
    await name(juno, FIRST).hover()
    await expect(win.getByRole('tooltip')).toHaveText('Message Maya')
    await name(juno, FIRST).dblclick()
    await tabs.expectActive('Maya')
    await tabs.expectCount(2)
    await expect(topic.message('Running 5 late to the planning sync')).toBeVisible()
  })

  await test.step('a click from another message focuses that tab instead of opening a second', async () => {
    await tabs.select(POSTGRES)
    await name(juno, SECOND).click()
    await tabs.expectCount(2)
    await tabs.expectActive('Maya')
  })

  await test.step('⌘-click on an @person chip opens the DM behind the current tab', async () => {
    await tabs.select(POSTGRES)
    await topic.message(MENTION).locator('[data-opens-person]', { hasText: '@Sam' }).click({ modifiers: ['Meta'] })
    await tabs.expectCount(3)
    await expect(tabs.tab('Sam')).toBeVisible()
    await tabs.expectActive(POSTGRES)
  })

  await test.step("an app's avatar opens its DM, though the post carries the app's own name and icon", async () => {
    await link(juno, DEPLOY, 'avatar').click()
    await tabs.expectCount(4)
    await tabs.expectActive('Deploy Bot')
    await tabs.select(POSTGRES)
  })

  await test.step('an app with no DM opens nothing and offers no link, until its DM arrives', async () => {
    await expect(link(juno, ALERT)).toHaveCount(0)
    await name(juno, ALERT).click()
    await tabs.expectCount(4)
    await tabs.expectActive(POSTGRES)

    const { conversation } = fake.workspace.open([SELF, 'U0GRAFANA'])
    fake.workspace.post({ channel: conversation.id, user: 'U0GRAFANA', text: 'Alerts for this workspace will come here.' })
    await expect(link(juno, ALERT)).toHaveCount(1, { timeout: 15_000 })
    await link(juno, ALERT).click()
    await tabs.expectCount(5)
    await tabs.expectActive('Grafana')
  })
})

test('Enter on a focused name opens the DM, and ⌘Enter on a chip opens it behind', async ({ juno, fake }) => {
  seedReplies(fake)
  await openPostgres(juno)
  const { topic, tabs, win } = juno

  await topic.message(FIRST).locator('[data-msg-text]').click()
  await win.keyboard.press('Tab')
  await expect(link(juno, FIRST)).toBeFocused()
  await win.keyboard.press('Enter')
  await tabs.expectCount(2)
  await tabs.expectActive('Maya')

  await tabs.select(POSTGRES)
  await topic.message(MENTION).locator('[data-msg-text]').click()
  await win.keyboard.press('Tab')
  await win.keyboard.press('Tab')
  await expect(topic.message(MENTION).locator('[data-opens-person]', { hasText: '@Sam' })).toBeFocused()
  await win.keyboard.press('Meta+Enter')
  await tabs.expectCount(3)
  await expect(tabs.tab('Sam')).toBeVisible()
  await tabs.expectActive(POSTGRES)
})

test('with no DM yet, a click opens Home addressed to them, ⌘-click opens it behind, and you can address yourself', async ({ juno }) => {
  await openPostgres(juno)
  const { tabs, write, win } = juno

  await name(juno, DEV).click({ modifiers: ['Meta'] })
  await tabs.expectCount(2)
  await tabs.expectActive(POSTGRES)
  // Focus stays in the topic.
  expect(await win.evaluate(() => document.activeElement?.closest('[data-topic-view]') != null)).toBe(true)
  await tabs.select('Home')
  await expect(write.chip).toHaveAccessibleName(/^Send to: Dev/)

  // Home with Dev chosen is in use, so you are addressed in a new Home tab, as ⌘N does.
  await tabs.select(POSTGRES)
  await name(juno, OWN).click()
  await tabs.expectCount(3)
  await expect(write.chip).toHaveAccessibleName(/^Send to: Tushar/)
})

test("a deactivated person's DM opens read-only; with no DM they offer no link", async ({ juno, fake }) => {
  for (const id of ['U0SAM', 'U0PRIYA']) (fake.workspace.users.get(id) as unknown as { deleted: boolean }).deleted = true
  reply(fake, 'U0SAM', 'Sam signing off: handing the dry run to Dev.')
  reply(fake, 'U0PRIYA', 'Priya here: runbook links are pinned.')
  await openPostgres(juno)
  const { tabs, topic } = juno

  await expect(link(juno, 'Priya here')).toHaveCount(0)
  await link(juno, 'Sam signing off').click()
  await tabs.expectActive('Sam')
  await expect(topic.message('Notes from today')).toBeVisible()
  await expect(topic.composer).toHaveCount(0)
  await expect(topic.root.getByText(/^Sam.*'s account is deactivated\. You can read this conversation but not reply\.$/)).toBeVisible()
})

test('a person in a thread peek opens their DM', async ({ juno, fake }) => {
  reply(fake, 'U0MAYA', FIRST)
  await juno.signIn()
  await juno.waitForSync()
  const { peek, tabs, topic } = juno
  await juno.sidebar.row('#eng').open()
  await topic.expectTitle('Main')
  await topic.threadLinkUnder(POSTGRES).peek()
  await peek.expectShowing(POSTGRES)
  const maya = peek.root.locator('[data-message-header] [data-opens-person]', { hasText: 'Maya' })
  await maya.hover()
  await maya.click()
  await peek.release()
  await tabs.expectActive('Maya')
  await tabs.expectCount(2)
})
