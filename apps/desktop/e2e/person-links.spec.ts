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

// Starts signed in and synced (README, "Synced start"); the replies and Deploy Bot's DM arrive live.
test.use({ synced: true })

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
const reply = (fake: FakeSlack, user: string, text: string) => fake.workspace.post({ channel: 'C0ENG', user, threadTs: rootOf(fake).ts, text })

/** A DM with `user` that arrives live, with one message so it has a Main. */
function addDm(fake: FakeSlack, user: string, text: string): void {
  const { conversation } = fake.workspace.open([SELF, user])
  fake.workspace.post({ channel: conversation.id, user, text })
}

/** Replies in the Postgres thread, live: Maya, Leo naming Sam, Maya again (a new header), the Grafana app and Deploy Bot, whose DM Juno has. */
function seedReplies(fake: FakeSlack): void {
  addDm(fake, 'U0DEPLOYBOT', 'Deploys for this week are in the calendar.')
  reply(fake, 'U0MAYA', FIRST)
  reply(fake, 'U0LEO', `${MENTION} <@U0SAM> can you look?`)
  reply(fake, 'U0MAYA', SECOND)
  reply(fake, 'U0GRAFANA', ALERT)
  reply(fake, 'U0DEPLOYBOT', DEPLOY)
}

async function openPostgres(juno: Juno): Promise<void> {
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

test('a sender or @person opens your DM with them, in a new tab or the one that shows it, or Home addressed to them with no DM', async ({ juno, fake }) => {
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

  await test.step('Enter on a focused name opens the DM', async () => {
    await tabs.select(POSTGRES)
    await topic.message(FIRST).locator('[data-msg-text]').click()
    await win.keyboard.press('Tab')
    await expect(link(juno, FIRST)).toBeFocused()
    await win.keyboard.press('Enter')
    await tabs.expectCount(2)
    await tabs.expectActive('Maya')
  })

  await test.step('⌘Enter on a focused @person chip opens the DM behind the current tab', async () => {
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

  await test.step('with no DM yet, ⌘-click opens Home addressed to them behind, and focus stays in the topic', async () => {
    await tabs.select(POSTGRES)
    await name(juno, DEV).click({ modifiers: ['Meta'] })
    await tabs.expectCount(6)
    await tabs.expectActive(POSTGRES)
    expect(await win.evaluate(() => document.activeElement?.closest('[data-topic-view]') != null)).toBe(true)
    await tabs.select('Home')
    await expect(juno.write.chip).toContainText('Dev')
  })

  await test.step('a click on your own name addresses you in a new Home tab, as ⌘N does, since Home with Dev is in use', async () => {
    await tabs.select(POSTGRES)
    await name(juno, OWN).click()
    await tabs.expectCount(7)
    await expect(juno.write.chip).toContainText('Tushar')
  })
})

