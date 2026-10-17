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

test('Slack links in a message open inside Juno at their message, in a new tab', async ({ juno, fake }) => {
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

  await juno.signIn()
  await juno.waitForSync()
  const { topic, tabs } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await tabs.expectCount(1)
  const links = topic.message('See the preview note').locator('[data-msg-text] a')
  const link = (text: string) => links.filter({ hasText: text })

  // In-app links keep the arrow cursor and say where they go on hover; others keep the URL.
  await expect(link('the preview note')).toHaveAttribute('data-in-app', '')
  await expect(link('elsewhere')).not.toHaveAttribute('data-in-app', '')
  await expect(link('elsewhere')).toHaveAttribute('title', OTHER)
  await link('the preview note').hover()
  await expect(link('the preview note')).toHaveAttribute('title', '#eng · Main')
  await link('the reaper reply').hover()
  await expect(link('the reaper reply')).toHaveAttribute('title', '#eng · Thread')

  // A click opens Main in a new tab, at the message, which flashes.
  await watchFlashes(juno)
  await link('the preview note').click()
  await tabs.expectCount(2)
  await tabs.expectActive(ENG)
  await expect(topic.message('preview environments never shut down')).toBeInViewport({ timeout: 15_000 })
  await flashed(juno, 'preview environments never shut down')

  // A reply's link opens its thread in another new tab.
  await tabs.select(POSTGRES)
  await link('the reaper reply').click()
  await tabs.expectCount(3)
  await expect(topic.message('Please do.')).toBeInViewport({ timeout: 15_000 })
  await expect(topic.message('Preview environments have no TTL')).toBeVisible()
  await flashed(juno, 'Please do.')

  // A message Juno never stored is fetched, and opens in the tab that already shows #eng.
  await tabs.select(POSTGRES)
  await link('the old note').click()
  await tabs.expectCount(3)
  await tabs.expectActive(ENG)
  await expect(topic.message('Old capacity note from last month')).toBeInViewport({ timeout: 15_000 })
  await flashed(juno, 'Old capacity note from last month')

  // ⌘-click opens the tab behind the current one; it lands on the message when shown.
  await tabs.close(ENG)
  await tabs.expectCount(2)
  await tabs.select(POSTGRES)
  await link('the preview note').click({ modifiers: ['Meta'] })
  await tabs.expectCount(3)
  await tabs.expectActive(POSTGRES)
  await tabs.select(ENG)
  await expect(topic.message('preview environments never shut down')).toBeInViewport({ timeout: 15_000 })

  // A conversation Juno cannot reach opens in the browser, with a toast saying why.
  await tabs.select(POSTGRES)
  await link('a closed room').click()
  await juno.expectToast('Juno cannot reach that conversation · Opened in the browser')
  await expect.poll(() => juno.browserLinks()).toContain(`${fake.url}/archives/C0NOWHERE/p${NOWHERE_TS.replace('.', '')}`)
  await tabs.expectCount(3)

  // Another workspace's link opens in the browser, as any link does.
  await link('elsewhere').click()
  await expect.poll(() => juno.browserLinks()).toContain(OTHER)
  await tabs.expectCount(3)
})
