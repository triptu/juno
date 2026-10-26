// The Juno chat as a user drives it, for the Juno tab and the Juno panel,
// and a test fixture that runs the agent against a fake OpenRouter.
import { startFakeOpenRouter, type FakeOpenRouter } from '@juno/agent-testing/openrouter'
import type { Locator, Page } from '@playwright/test'
import { expect, test as base } from '../fixtures'
import { MessageMenuDriver } from '../driver/juno'
import { answer } from './model'

export { answer } from './model'

export const test = base.extend<{ readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  agentOptions: async ({ model }, use) => {
    await use({ agent: true, fakeOpenRouterUrl: model.origin })
  },
})

export { expect }

/** One Juno chat on screen: the Juno tab's or the panel's. */
export class JunoChatPane {
  constructor(
    readonly win: Page,
    readonly root: Locator,
  ) {}

  static tab(win: Page): JunoChatPane {
    // The Juno tab on screen: another Juno tab can be mounted, hidden.
    return new JunoChatPane(win, win.locator('main [data-juno-chat]').filter({ visible: true }))
  }

  static panel(win: Page): JunoChatPane {
    return new JunoChatPane(win, win.locator('aside[data-juno-panel] [data-juno-chat]'))
  }

  get composer(): Locator {
    return this.root.locator('textarea[aria-label^="Ask Juno"]')
  }

  /** The @, # or emoji suggestions above the composer. */
  get suggestions(): Locator {
    return this.root.locator('[data-mention-suggestions]')
  }

  /** The suggestion row whose name starts with `name`. */
  suggestion(name: string): Locator {
    // Matched on the row's label: the row's whole text starts with the avatar's initials.
    return this.suggestions.locator('[role="option"]').filter({ has: this.win.locator('[data-option-label]', { hasText: new RegExp(`^${name}(\\s|$)`) }) })
  }

  /** The picked people and channels drawn as chips in the composer's field. */
  get composerChips(): Locator {
    return this.root.locator('[data-juno-composer] [data-mark]')
  }

  ownerBubble(text: string): Locator {
    return this.root.locator('[data-chat-owner]').filter({ hasText: text })
  }

  junoBubble(text: string): Locator {
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

  /** The open message menu: one for the window, outside the chat. */
  get reactions(): Locator {
    return this.win.locator('[data-context-menu]')
  }

  /** Right-clicks a Juno bubble, or with `owner` your own, and returns its menu. */
  menu(bubble: string, options: { readonly owner?: boolean } = {}): Promise<MessageMenuDriver> {
    const row = options.owner === true ? this.ownerBubble(bubble) : this.junoBubble(bubble)
    return new MessageMenuDriver(this.win).openOn(row.locator('[data-chat-run], p').first())
  }

  /** Opens a bubble's menu, whose grid starts with the quick reactions. */
  async openReactions(bubble: string): Promise<MessageMenuDriver> {
    const menu = await this.menu(bubble)
    await expect(menu.root.locator('[data-reaction-grid]')).toBeVisible()
    return menu
  }

  /** A quick reaction (👍 ✅ 👀 by default), from the menu's grid. */
  async react(bubble: string, emoji: string): Promise<void> {
    const menu = await this.openReactions(bubble)
    await menu.root.locator(`button[aria-label=${JSON.stringify(`React ${emoji}`)}]`).click()
    await expect(menu.root).toHaveCount(0)
  }

  /**
   * Any emoji, through More reactions, which turns the menu into the emoji picker, and its search. Picks from the
   * results: until the search renders, the browse grid's button matches too.
   */
  async reactWithPicker(bubble: string, search: string, name: string): Promise<void> {
    const menu = await this.openReactions(bubble)
    await menu.reactWithPicker(search, name)
  }

  async reply(bubble: string): Promise<void> {
    await (await this.menu(bubble)).choose('reply')
  }

}
