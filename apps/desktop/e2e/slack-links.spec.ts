// Slack links in messages (spec section 8, "Links"): a link to a message in
// the signed-in workspace opens inside Juno, in a new tab, at the message,
// which flashes; a reply's link opens its thread; a message Juno has not
// stored is fetched first; ⌘-click opens the tab behind the current one; a
// conversation Juno cannot reach, and another workspace's link, open in the
// browser.
import type { FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const DAY = 86_400_000
const POSTGRES = 'Draft plan is in the doc'
// A Main's tab is titled by the channel's name.
const ENG = 'eng'
const OTHER = 'https://other.slack.com/archives/C0ENG/p1712345678000200'
const NOWHERE_TS = '1712345678.000200'

const find = (fake: FakeSlack, start: string) => fake.messages('C0ENG').find((message) => message.text?.includes(start))!
const permalink = (fake: FakeSlack, ts: string, threadTs?: string) =>
  `${fake.url}/archives/C0ENG/p${ts.replace('.', '')}${threadTs === undefined ? '' : `?thread_ts=${threadTs}&cid=C0ENG`}`

/** Records which message rows flash from now on: the flash is a short animation on the row. */
async function watchFlashes(juno: Juno): Promise<void> {
  await juno.win.evaluate(() => {
    const w = window as unknown as { __flashed: string[] }
    w.__flashed = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if ((this as HTMLElement).dataset['messageRow'] !== undefined) w.__flashed.push(this.textContent ?? '')
      return animate.apply(this, args)
    }
  })
}

const flashed = (juno: Juno, text: string) =>
  expect.poll(() => juno.win.evaluate((wanted) => (window as unknown as { __flashed: string[] }).__flashed.some((row) => row.includes(wanted)), text), { timeout: 10_000 }).toBe(true)

/** Seeds a reply in the Postgres thread holding one link of each kind. */
function seedLinks(fake: FakeSlack): void {
  const root = find(fake, POSTGRES)
  const main = find(fake, 'preview environments never shut down')
  const reply = find(fake, 'Please do.')
  // Three weeks old: outside the first sync's window, so Juno has not stored it.
  const old = fake.workspace.post({ channel: 'C0ENG', user: 'U0SAM', text: 'Old capacity note from last month', at: fake.now() - 21 * DAY, silent: true })
  fake.workspace.post({
    channel: 'C0ENG',
    user: 'U0MAYA',
    threadTs: root.ts,
    text: [
      `See <${permalink(fake, main.ts)}|the preview note>,`,
      `<${permalink(fake, reply.ts, reply.thread_ts)}|the reaper reply>,`,
      `<${permalink(fake, old.ts)}|the old note>,`,
      `<${fake.url}/archives/C0NOWHERE/p${NOWHERE_TS.replace('.', '')}|a closed room>`,
      `and <${OTHER}|elsewhere>.`,
    ].join(' '),
    silent: true,
  })
}

/** Signs in, opens the Postgres thread and returns its links by their words. */
async function openLinks(juno: Juno) {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.expectCount(1)
  const links = juno.topic.message('See the preview note').locator('[data-msg-text] a')
  return (text: string) => links.filter({ hasText: text })
}

test('a message link opens Main in a new tab at the message, which flashes; hover says where it goes', async ({ juno, fake }) => {
  seedLinks(fake)
  const link = await openLinks(juno)
  const { topic, tabs } = juno

  // In-app links keep the arrow cursor and say where they go on hover; others keep the URL.
  await expect(link('the preview note')).toHaveAttribute('data-in-app', '')
  await expect(link('elsewhere')).not.toHaveAttribute('data-in-app', '')
  await expect(link('elsewhere')).toHaveAttribute('title', OTHER)
  await link('the preview note').hover()
  await expect(link('the preview note')).toHaveAttribute('title', '#eng · Main')
  await link('the reaper reply').hover()
  await expect(link('the reaper reply')).toHaveAttribute('title', '#eng · Thread')

  await watchFlashes(juno)
  await link('the preview note').click()
  await tabs.expectCount(2)
  await tabs.expectActive(ENG)
  await expect(topic.message('preview environments never shut down')).toBeInViewport({ timeout: 15_000 })
  await flashed(juno, 'preview environments never shut down')
})

test('a reply link opens its thread; a message Juno never stored is fetched; a tab showing the topic is reused', async ({ juno, fake }) => {
  seedLinks(fake)
  const link = await openLinks(juno)
  const { topic, tabs } = juno
  await watchFlashes(juno)

  await link('the reaper reply').click()
  await tabs.expectCount(2)
  await expect(topic.message('Please do.')).toBeInViewport({ timeout: 15_000 })
  await expect(topic.message('Preview environments have no TTL')).toBeVisible()
  await flashed(juno, 'Please do.')

  await tabs.select(POSTGRES)
  await link('the old note').click()
  await tabs.expectCount(3)
  await tabs.expectActive(ENG)
  await expect(topic.message('Old capacity note from last month')).toBeInViewport({ timeout: 15_000 })
  await flashed(juno, 'Old capacity note from last month')

  // The tab that shows #eng now is used again.
  await tabs.select(POSTGRES)
  await link('the preview note').click()
  await tabs.expectCount(3)
  await tabs.expectActive(ENG)
  await expect(topic.message('preview environments never shut down')).toBeInViewport({ timeout: 15_000 })
})

test('⌘-click on a message link opens the tab behind the current one, at the message', async ({ juno, fake }) => {
  seedLinks(fake)
  const link = await openLinks(juno)
  const { topic, tabs } = juno

  await link('the preview note').click({ modifiers: ['Meta'] })
  await tabs.expectCount(2)
  await tabs.expectActive(POSTGRES)
  await tabs.select(ENG)
  await expect(topic.message('preview environments never shut down')).toBeInViewport({ timeout: 15_000 })
})

test('a conversation Juno cannot reach, and another workspace, open in the browser', async ({ juno, fake }) => {
  seedLinks(fake)
  const link = await openLinks(juno)

  await link('a closed room').click()
  await juno.expectToast('Juno cannot reach that conversation · Opened in the browser')
  await expect.poll(() => juno.browserLinks()).toContain(`${fake.url}/archives/C0NOWHERE/p${NOWHERE_TS.replace('.', '')}`)

  // Another workspace's link opens in the browser, as any link does, with no toast.
  await link('elsewhere').click()
  await expect.poll(() => juno.browserLinks()).toContain(OTHER)
  await juno.tabs.expectCount(1)
})
