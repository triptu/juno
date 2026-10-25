// Native menus on links in messages (SPEC 8, "Links"): their actions are
// about the link itself, not the message around it. Message text keeps the
// message's own menu. A link inside selected text is message-menu.spec.ts's:
// whether the press is inside the selection is a question of boxes.
import { expect } from './expect'
import type { Query } from './query'
import { domTest } from './test'
import type { Juno } from './driver/juno'

const WEB_URL = 'https://example.com/releases/42'
const EMAIL = 'ana@example.com'

async function choose(juno: Juno, link: Query, item: string | null): Promise<string[]> {
  const before = await juno.menusAsked()
  await juno.chooseNextMenuItem(item)
  await link.click({ button: 'right' })
  const menu = await juno.lastMenu()
  expect(await juno.menusAsked()).toBe(before + 1)
  return menu.labels
}

domTest('web and email links have link menus; message text keeps the message menu', async ({ juno, fake }) => {
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

  expect(await choose(juno, web, 'copy-link')).toEqual(['Open link', 'Open in browser · ⌘ click', '-', 'Copy link'])
  await expect.poll(() => juno.clipboard()).toBe(WEB_URL)

  expect(await choose(juno, email, 'copy-email')).toEqual(['Copy email address', 'New email'])
  await expect.poll(() => juno.clipboard()).toBe(EMAIL)

  expect(await choose(juno, slack, 'copy-link')).toEqual(['Open link', 'Open in background · ⌘ click', '-', 'Copy link'])
  await expect.poll(() => juno.clipboard()).toBe(slackUrl)

  const asked = await juno.menusAsked()
  const plain = await juno.topic.messageMenu('Plain message menu sample')
  const messageMenu = await plain.labels()
  expect(messageMenu).toContain('Start thread')
  expect(messageMenu).toContain('Open in Slack')
  expect(messageMenu).not.toContain('Copy link')
  await plain.close()
  expect(await juno.menusAsked()).toBe(asked)
})
