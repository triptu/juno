// Slack links in messages (spec section 8, "Links"): a link to a message in
// the signed-in workspace opens inside Juno, in a new tab, at the message;
// a reply's link opens its thread; a message Juno has not
// stored is fetched first; ⌘-click opens the tab behind the current one; a
// conversation Juno cannot reach opens in the browser, and another
// workspace's link is handled as any web link. That the message is in view
// and flashes is the browser lane's (the long thread journey in topic.spec.ts); here, the tab
// and the message it opens at. A link whose answer comes after the user moved on opens nothing, and a thread
// opened while Slack is slowing Juno down says so until its replies come.
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const DAY = 86_400_000
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
// A Main's tab is titled by the channel's name.
const ENG = 'eng'
const OTHER = 'https://other.slack.com/archives/C0ENG/p1712345678000200'
const NOWHERE_TS = '1712345678.000200'
const OLD_THREAD = 'Capacity review notes from last quarter'
const OLD_REPLY = 'Replica count was fine then'

const find = (fake: FakeSlack, start: string) => fake.messages('C0ENG').find((message) => message.text?.includes(start))!
const permalink = (fake: FakeSlack, ts: string, threadTs?: string) =>
  `${fake.url}/archives/C0ENG/p${ts.replace('.', '')}${threadTs === undefined ? '' : `?thread_ts=${threadTs}&cid=C0ENG`}`

/** Seeds a reply in the Postgres thread holding one link of each kind. */
function seedLinks(fake: FakeSlack): void {
  const root = find(fake, POSTGRES)
  const main = find(fake, 'preview environments never shut down')
  const reply = find(fake, 'Please do.')
  // Three weeks old: outside the first sync's window, so Juno has not stored them.
  const old = fake.workspace.post({ channel: 'C0ENG', user: 'U0SAM', text: 'Old capacity note from last month', at: fake.now() - 21 * DAY, silent: true })
  const oldRoot = fake.workspace.post({ channel: 'C0ENG', user: 'U0SAM', text: OLD_THREAD, at: fake.now() - 21 * DAY, silent: true })
  const oldReply = fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: OLD_REPLY, at: fake.now() - 21 * DAY + 60_000, threadTs: oldRoot.ts, silent: true })
  fake.workspace.post({
    channel: 'C0ENG',
    user: 'U0MAYA',
    threadTs: root.ts,
    text: [
      `See <${permalink(fake, main.ts)}|the preview note>,`,
      `<${permalink(fake, reply.ts, reply.thread_ts)}|the reaper reply>,`,
      `<${permalink(fake, old.ts)}|the old note>,`,
      `<${permalink(fake, oldReply.ts, oldRoot.ts)}|the old thread>,`,
      `<${fake.url}/archives/C0NOWHERE/p${NOWHERE_TS.replace('.', '')}|a closed room>`,
      `and <${OTHER}|elsewhere>.`,
    ].join(' '),
  })
}

/** Opens the Postgres thread and returns its links by their words. */
async function openLinks(juno: Juno) {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.expectCount(1)
  await expect(juno.topic.message('See the preview note')).toBeVisible({ timeout: 15_000 })
  const links = juno.topic.message('See the preview note').locator('[data-msg-text] a')
  return (text: string) => links.filter({ hasText: text })
}

domTest('message links open inside Juno at the message: Main and a reply in new tabs, a message Juno never stored, a tab showing the topic again and ⌘-click behind; browser links open no tab', async ({ juno, fake, step }) => {
  seedLinks(fake)
  const link = await openLinks(juno)
  const { topic, tabs } = juno

  await step('a conversation Juno cannot reach, and another workspace, open in the browser and open no tab', async () => {
    await link('a closed room').click()
    await juno.expectToast('Juno cannot reach that conversation · Opened in the browser')
    await expect.poll(() => juno.browserLinks()).toContain(`${fake.url}/archives/C0NOWHERE/p${NOWHERE_TS.replace('.', '')}`)

    // Another workspace's link is any web link: ⌘-click opens it in the browser, with no toast.
    await link('elsewhere').click({ modifiers: ['Meta'] })
    await expect.poll(() => juno.browserLinks()).toContain(OTHER)
    await tabs.expectCount(1)
  })

  await step('a message link opens Main in a new tab at the message', async () => {
    await link('the preview note').click()
    await tabs.expectCount(2)
    await tabs.expectActive(ENG)
    await expect(topic.message('preview environments never shut down')).toBeVisible({ timeout: 15_000 })
  })

  await step('a reply link opens its thread in a new tab', async () => {
    await tabs.select(POSTGRES)
    await link('the reaper reply').click()
    await tabs.expectCount(3)
    await expect(topic.message('Please do.')).toBeVisible({ timeout: 15_000 })
    await expect(topic.message('Preview environments have no TTL')).toBeVisible()
  })

  await step('a message Juno never stored is fetched, in the tab that already shows #eng', async () => {
    await tabs.select(POSTGRES)
    await link('the old note').click()
    await tabs.expectCount(3)
    await tabs.expectActive(ENG)
    await expect(topic.message('Old capacity note from last month')).toBeVisible({ timeout: 15_000 })
  })

  await step('the tab that shows #eng is used again', async () => {
    await tabs.select(POSTGRES)
    await link('the preview note').click()
    await tabs.expectCount(3)
    await tabs.expectActive(ENG)
    await expect(topic.message('preview environments never shut down')).toBeVisible({ timeout: 15_000 })
  })

  await step('with #eng closed, ⌘-click on a message link opens the tab behind the current one, at the message', async () => {
    await tabs.menu('close-tab')
    await tabs.expectCount(2)
    await tabs.select(POSTGRES)
    await link('the preview note').click({ modifiers: ['Meta'] })
    await tabs.expectCount(3)
    await tabs.expectActive(POSTGRES)
    await tabs.select(ENG)
    await expect(topic.message('preview environments never shut down')).toBeVisible({ timeout: 15_000 })
  })
})

domTest('a message link whose fetch answers after the user moved on opens nothing: the tab and the composer stay where the user went', async ({ juno, fake, app }) => {
  seedLinks(fake)
  const link = await openLinks(juno)
  const { topic, tabs } = juno
  const trace = { events: [] as Array<{ readonly what: string }> }
  ;(app.window as unknown as { __junoSendTrace: unknown }).__junoSendTrace = trace
  // The engine's answer to the old note's fetch is held, as a slow Slack holds it, while the user goes elsewhere and types.
  const release = app.holdReplies('messages.loadAt')
  await link('the old note').click()
  await juno.sidebar.row(RINA).openInNewTab()
  await topic.expectTitle(RINA)
  await tabs.expectCount(2)
  await topic.composer.fill('Typed after moving on')
  release()
  const tabCount = () => tabs.root.getByRole('tab').count()
  // The late answer is dropped, or (the bug) opens #eng over the tab the user is in.
  await expect.poll(() => trace.events.some((event) => event.what === 'link dropped') || tabCount() !== 2, { timeout: 5_000 }).toBe(true)
  expect(tabCount()).toBe(2)
  await tabs.expectActive(RINA)
  await expect(topic.composer).toHaveValue('Typed after moving on')
  await expect(topic.composer).toBeFocused()
})

domTest('a thread opened while Slack is slowing Juno down says so, and shows its replies once the pause ends, in the same tab', async ({ juno, fake }) => {
  seedLinks(fake)
  const link = await openLinks(juno)
  const { topic, tabs } = juno
  // Slack's next answer to a thread fetch is a 429 whose Retry-After is longer than an interactive call waits out.
  fake.force429({ method: 'conversations.replies', retryAfter: 2, times: 1 })

  // The thread opens in a new tab with what the store has: nothing, since Juno never stored it, so not even its title.
  await link('the old thread').click()
  await tabs.expectCount(2)
  await expect(topic.list.getByText('Slack asked Juno to slow down')).toBeVisible()
  await juno.sidebar.expectSyncStatus('Slack asked us to slow down')

  // The pause ends: the engine finishes the fetch by itself.
  await juno.sidebar.expectNoSyncStatus()
  await expect(topic.message(OLD_REPLY)).toBeVisible({ timeout: 15_000 })
  await topic.expectTitle(OLD_THREAD)
  await tabs.expectCount(2)
  await expect(topic.list.getByText('Slack asked Juno to slow down')).toHaveCount(0)
})

