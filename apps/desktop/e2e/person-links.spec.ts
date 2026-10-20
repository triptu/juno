// A person in a message (spec section 7, "Messages"): a click on a sender's
// name or avatar, or on an @person chip, opens your DM with them as a Slack
// link to them does (section 8). A new tab on the DM's Main, or the tab that
// already shows it; ⌘-click opens the tab behind the current one. A drag
// that starts on the name selects text and opens nothing, and an app with no
// DM opens nothing and does not look like it would.
import type { FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const FIRST = 'Maya first: the dry run slot is booked.'
const MENTION = 'Leo asks Sam to check the replica sizing.'
const SECOND = 'Maya again: the doc has the new numbers.'
const ALERT = 'Replication lag above 30 seconds on the new cluster.'

/** Seeds replies in the Postgres thread: Maya, Leo naming Sam, Maya again (a new header), and the Grafana app. */
function seedReplies(fake: FakeSlack): void {
  const root = fake.messages('C0ENG').find((message) => message.text?.includes(POSTGRES))!
  const reply = (user: string, text: string) => fake.workspace.post({ channel: 'C0ENG', user, threadTs: root.ts, text, silent: true })
  reply('U0MAYA', FIRST)
  reply('U0LEO', `${MENTION} <@U0SAM> can you look?`)
  reply('U0MAYA', SECOND)
  reply('U0GRAFANA', ALERT)
}

test('a sender or @person opens your DM with them, in a new tab or the one that shows it', async ({ juno, fake }) => {
  seedReplies(fake)
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  const { topic, tabs, win } = juno
  await tabs.expectCount(1)
  const name = (text: string) => topic.message(text).locator('[data-message-header] [data-sender]')

  await test.step('a drag that starts on the name selects text and opens nothing', async () => {
    await topic.message(FIRST).scrollIntoViewIfNeeded()
    const from = (await name(FIRST).boundingBox())!
    const to = (await topic.message(FIRST).locator('[data-msg-text]').boundingBox())!
    await win.mouse.move(from.x + 4, from.y + from.height / 2)
    await win.mouse.down()
    await win.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 10 })
    await win.mouse.up()
    expect(await win.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('dry run')
    await tabs.expectCount(1)
  })

  await test.step('a click on the name opens a new tab on the DM, with a tooltip saying so', async () => {
    await name(FIRST).hover()
    await expect(win.getByRole('tooltip')).toHaveText('Message Maya')
    await name(FIRST).click()
    await tabs.expectCount(2)
    await tabs.expectActive('Maya')
    await expect(topic.message('Running 5 late to the planning sync')).toBeVisible()
  })

  await test.step('a click from another message focuses that tab instead of opening a second', async () => {
    await tabs.select(POSTGRES)
    await tabs.expectActive(POSTGRES)
    await name(SECOND).click()
    await tabs.expectCount(2)
    await tabs.expectActive('Maya')
  })

  await test.step('⌘-click on an @person chip opens the DM behind the current tab', async () => {
    await tabs.select(POSTGRES)
    const chip = topic.message(MENTION).locator('[data-opens-person]', { hasText: '@Sam' })
    await chip.click({ modifiers: ['Meta'] })
    await tabs.expectCount(3)
    await expect(tabs.tab('Sam')).toBeVisible()
    await tabs.expectActive(POSTGRES)
  })

  await test.step('an app with no DM opens nothing and offers no link', async () => {
    await expect(topic.message(ALERT).locator('[data-opens-person]')).toHaveCount(0)
    await name(ALERT).click()
    await tabs.expectCount(3)
    await tabs.expectActive(POSTGRES)
  })
})
