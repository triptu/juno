// The Juno chat as a user drives it, for the Juno tab and the Juno panel,
// and a test fixture that runs the agent against a fake OpenRouter.
import { startFakeOpenRouter, type FakeOpenRouter, type OpenRouterRequest } from '@juno/agent-testing/openrouter'
import type { Locator, Page } from '@playwright/test'
import { expect, launchApp, test as base } from '../fixtures'

/**
 * The model the e2e agent talks to. It answers each message by echoing its
 * words, reacts with 🎉 when asked to "react", and says nothing to a
 * reaction. `requests` is what the agent sent.
 */
export function answer(request: OpenRouterRequest): string {
  const input = request.input
  if (input.startsWith('<reaction')) return ''
  const id = /<message id="(n\d+)">/.exec(input)?.[1]
  const words = input.replace(/<about[^>]*\/>|<about[\s\S]*?<\/about>|<quote[\s\S]*?<\/quote>|<[^>]*>/g, '').trim()
  if (/\breact\b/.test(words) && id !== undefined) return `<react to="${id}">🎉</react><say>Reacted to ${words}</say>`
  return `<say>You said: ${words}</say>`
}

export const test = base.extend<{ readonly model: FakeOpenRouter }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({ answer })
    await use(model)
    await model.close()
  },
  running: async ({ fake, slackApp, userData, model }, use) => {
    const running = await launchApp(userData, {
      fakeSlackUrl: fake.url,
      slackAppDir: slackApp.dir,
      keychainPassword: slackApp.keychainPassword,
      agent: true,
      fakeOpenRouterUrl: model.origin,
    })
    await use(running)
    await running.close()
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
    return new JunoChatPane(win, win.locator('main [data-juno-chat]'))
  }

  static panel(win: Page): JunoChatPane {
    return new JunoChatPane(win, win.locator('aside[data-juno-panel] [data-juno-chat]'))
  }

  get composer(): Locator {
    return this.root.getByRole('textbox', { name: /^Ask Juno/ })
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

  async react(bubble: string, emoji: string): Promise<void> {
    const row = this.junoBubble(bubble)
    await row.hover()
    await row.getByRole('button', { name: 'React' }).click()
    await this.win.locator('[data-reaction-picker]').getByRole('button', { name: `Reacted ${emoji}` }).click()
  }

  async reply(bubble: string): Promise<void> {
    const row = this.junoBubble(bubble)
    await row.hover()
    await row.getByRole('button', { name: 'Reply' }).click()
  }
}
