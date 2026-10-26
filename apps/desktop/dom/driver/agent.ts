/**
 * The Juno agent's chat, Settings and cards as a user drives them, as
 * `e2e/juno-agent/agent.ts` and `chat.ts` do for Playwright. Give
 * `domTest` a `model` and the agent runs against it.
 */
import { hooks } from '../../e2e/hooks'
import type { JunoPage, JunoSettingsSection } from '../../e2e/juno-agent/agent'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import type { Juno } from './juno'
import { MessageMenuDriver } from './topic'

/** One Juno chat on screen: the Juno tab's or the panel's. */
export class JunoChatPane {
  constructor(
    readonly dom: Dom,
    readonly root: Query,
  ) {}

  /** The Juno tab on screen: another Juno tab can be mounted, hidden. */
  static tab(dom: Dom): JunoChatPane {
    return new JunoChatPane(dom, dom.locator('main [data-juno-chat]').filter({ visible: true }))
  }

  static panel(dom: Dom): JunoChatPane {
    return new JunoChatPane(dom, dom.locator('aside[data-juno-panel] [data-juno-chat]'))
  }

  get composer(): Query {
    return this.root.getByRole('textbox', { name: /^Ask Juno/ })
  }

  ownerBubble(text: string): Query {
    return this.root.locator('[data-chat-owner]').filter({ hasText: text })
  }

  junoBubble(text: string): Query {
    return this.root.locator('[data-chat-juno]').filter({ hasText: text })
  }

  async send(text: string): Promise<void> {
    await this.composer.fill(text)
    await this.composer.press('Enter')
  }

  async expectOwner(text: string): Promise<void> {
    await expect(this.ownerBubble(text)).toBeVisible()
  }

  async expectJuno(text: string): Promise<void> {
    await expect(this.junoBubble(text)).toBeVisible({ timeout: 15_000 })
  }

  /** Right-clicks a Juno bubble, or with `owner` your own, and returns its menu. */
  menu(bubble: string, options: { readonly owner?: boolean } = {}): Promise<MessageMenuDriver> {
    const row = options.owner === true ? this.ownerBubble(bubble) : this.junoBubble(bubble)
    return new MessageMenuDriver(this.dom).openOn(row.locator('[data-chat-run], p').first())
  }

  async reply(bubble: string): Promise<void> {
    await (await this.menu(bubble)).choose('reply')
  }
}

export async function agentReady(juno: Juno): Promise<void> {
  await expect.poll(() => hooks(juno.surface, 'agentState'), { timeout: 30_000 }).toBe('ready')
}

/** An established workspace starts from the synced snapshot; only the agent needs waiting. */
export async function readySynced(juno: Juno): Promise<void> {
  await juno.waitForSync()
  await agentReady(juno)
}

/** Opens the Juno tab and returns its chat. */
export async function openChat(juno: Juno): Promise<JunoChatPane> {
  await juno.dom.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  await juno.tabs.expectActive('Juno')
  return JunoChatPane.tab(juno.dom)
}

/** Opens one of the Juno menu's pages from the Juno tab and returns the page. Connections opens in Settings. */
export async function openPage(juno: Juno, label: JunoPage): Promise<Query> {
  await openChat(juno)
  await juno.dom.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.dom.getByRole('menuitem', { name: label }).click()
  await juno.tabs.expectActive(label === 'Connections' ? 'Settings' : label)
  return juno.dom.locator('main')
}

/**
 * Opens every run on the Activity page, so each shows its steps and actions. The page draws nothing until its
 * live query answers, so this waits for the first run before it counts the closed ones.
 */
export async function openRuns(page: Query): Promise<void> {
  await expect(page.locator('[data-activity-run]').first()).toBeVisible()
  const closed = page.locator('[data-activity-run] button[aria-expanded="false"]')
  for (let n = closed.count(); n > 0; n = closed.count()) {
    await closed.first().click()
    await page.dom.until('the run to open', () => closed.count() < n)
  }
}

/**
 * Adds an MCP server on Connections by its address, signs in (the fakes approve at once under
 * JUNO_E2E) and returns the server's id and its row. Leaves Connections open.
 */
export async function addServer(juno: Juno, name: string, url: string): Promise<{ readonly id: string; readonly row: Query }> {
  const page = await openPage(juno, 'Connections')
  const add = page.locator('[data-add-server]')
  await add.getByLabel('Name').fill(name)
  await add.getByLabel('Address').fill(url)
  await add.getByRole('button', { name: 'Add' }).click()
  const row = page.locator('[data-connection-id^="server-"]').filter({ hasText: url })
  await expect(row.locator('[data-connection-name]')).toHaveText(name)
  const id = await row.getAttribute('data-connection-id')
  if (id === null) throw new Error(`No connection id for ${name}`)
  await row.getByRole('button', { name: 'Connect' }).click()
  await expect(row).toHaveAttribute('data-connection', 'ready', { timeout: 20_000 })
  return { id, row }
}

/** Opens Configure on a connection's row and returns its sheet: the tools, their Enabled switches and rules. */
export async function configure(juno: Juno, row: Query): Promise<Query> {
  await row.getByRole('button', { name: 'Configure' }).click()
  const sheet = juno.dom.locator('[data-sheet="tools"]')
  await expect(sheet).toBeVisible()
  return sheet
}

/** Opens Settings from the Juno menu, which lands on its Juno section, then goes to `section`. Returns the page. */
export async function openSettings(juno: Juno, section: JunoSettingsSection): Promise<Query> {
  await openChat(juno)
  await juno.dom.locator('main [data-juno-header]').getByRole('button', { name: 'Juno' }).click()
  await juno.dom.getByRole('menuitem', { name: 'Settings' }).click()
  await juno.tabs.expectActive('Settings')
  const nav = juno.dom.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('button', { name: 'Juno' })).toHaveAttribute('aria-current', 'page')
  if (section !== 'Juno') await nav.getByRole('button', { name: section }).click()
  await expect(nav.getByRole('button', { name: section })).toHaveAttribute('aria-current', 'page')
  return juno.dom.locator('main')
}

/** A card in the chat, by kind (`sendMessage`, `budget`, `task`, ...). */
export function card(chat: JunoChatPane, kind: string): Query {
  return chat.root.locator(`[data-chat-card="${kind}"]`)
}
