// Native menus on links in messages (SPEC 8, "Links"): their actions are
// about the link itself, not the message around it.
import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const WEB_URL = 'https://example.com/releases/42'
const EMAIL = 'ana@example.com'

async function choose(juno: Juno, link: Locator, item: string | null): Promise<string[]> {
  const before = await juno.menusAsked()
  await juno.chooseNextMenuItem(item)
  await link.click({ button: 'right' })
  const menu = await juno.lastMenu()
  expect(await juno.menusAsked()).toBe(before + 1)
  return menu.labels
}

test('web and email links have link menus; message text keeps the message menu', async ({ juno, fake }) => {
  await juno.sidebar.row('#eng').open()
  const target = fake.messages('C0ENG').find((message) => message.text?.includes('preview environments never shut down'))
  if (target === undefined) throw new Error('the fake seed has no preview-environments message')
  const slackUrl = `${fake.url}/archives/C0ENG/p${target.ts.replace('.', '')}`
  fake.injectMessage({
    channel: 'C0ENG',
    user: 'U0MAYA',
    text: `Read <${WEB_URL}|release notes>, email ${EMAIL}, or open <${slackUrl}|the message>.`,
  })
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Plain message menu sample' })

  const linked = juno.topic.message('Read release notes')
  const web = linked.getByRole('link', { name: 'release notes' })
  const email = linked.getByRole('link', { name: EMAIL })
  const slack = linked.getByRole('link', { name: 'the message' })
  await expect(web).toBeVisible()
  await expect(email).toBeVisible()
  await expect(slack).toBeVisible()

  await juno.app.evaluate(({ clipboard }) => clipboard.clear())
  expect(await choose(juno, web, 'copy-link')).toEqual(['Open link', 'Open in browser · ⌘ click', '-', 'Copy link'])
  await expect.poll(() => juno.clipboard()).toBe(WEB_URL)

  await juno.app.evaluate(({ clipboard }) => clipboard.clear())
  expect(await choose(juno, email, 'copy-email')).toEqual(['Copy email address', 'New email'])
  await expect.poll(() => juno.clipboard()).toBe(EMAIL)

  await juno.app.evaluate(({ clipboard }) => clipboard.clear())
  expect(await choose(juno, slack, 'copy-link')).toEqual(['Open link', 'Open in background · ⌘ click', '-', 'Copy link'])
  await expect.poll(() => juno.clipboard()).toBe(slackUrl)

  // A selection takes precedence when the right-click point is inside it.
  await web.selectText()
  const selectedMenu = await choose(juno, web, null)
  expect(selectedMenu).toContain('Start thread')
  expect(selectedMenu).toContain('Copy Slack link')
  expect(selectedMenu).not.toContain('Copy link')

  await juno.chooseNextMenuItem(null)
  await juno.topic.message('Plain message menu sample').click({ button: 'right' })
  const messageMenu = await juno.lastMenu()
  expect(messageMenu.labels).toContain('Start thread')
  expect(messageMenu.labels).toContain('Copy Slack link')
  expect(messageMenu.labels).not.toContain('Copy link')
})
