/**
 * The Juno agent's chat, Settings and cards as a user drives them, as
 * `e2e/juno-agent/agent.ts` and `chat.ts` do for Playwright. Give
 * `domTest` a `model` and the agent runs against it.
 */
import { hooks } from '../../e2e/hooks'
import type { JunoSettingsSection } from '../../e2e/juno-agent/agent'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import type { Juno } from './juno'

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
