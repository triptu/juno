import type { MenuSeen, TextMatch, TopicVerbs } from '../../e2e/driver/verbs'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import { escapeRegExp, type Menus } from './menus'


/** The message menu (SPEC 7): a right-click on a message opens it. One for the window, in a portal on `body`. */
export class MessageMenuDriver {
  readonly root: Query

  constructor(readonly dom: Dom) {
    this.root = dom.locator('[data-context-menu]')
  }

  /** Right-clicks `target` and waits for the menu. */
  async openOn(target: Query): Promise<MessageMenuDriver> {
    await target.click({ button: 'right' })
    await expect(this.root).toBeVisible()
    return this
  }

  openOnRow(row: Query): Promise<MessageMenuDriver> {
    return this.openOn(row.locator('[data-msg-text]').first())
  }

  /** A row by its id (`data-menu-item`), or a row's trailing action. */
  item(id: string): Query {
    return this.root.locator(`[data-menu-item="${id}"], [data-menu-trailing="${id}"]`)
  }

  cell(name: string): Query {
    return this.root.locator(`[data-grid-reaction="${name}"]`)
  }

  get more(): Query {
    return this.root.locator('[data-grid-more]')
  }

  /** The emoji grid's names, in order. */
  async grid(): Promise<string[]> {
    return this.root.locator('[data-grid-reaction]').all().map((cell) => cell.getAttribute('data-grid-reaction') ?? '')
  }

  get search(): Query {
    return this.root.getByRole('textbox', { name: 'Search emoji' })
  }

  /** The rows' labels in order, without their keys or trailing actions: "-" for a separator, "(label)" for a disabled row. */
  async labels(): Promise<string[]> {
    const root = this.root.el()
    if (root === undefined) return []
    return [...root.querySelectorAll('[role="menuitem"]:not([data-menu-trailing]), [role="separator"]')].filter((node) => node.closest('[inert]') === null).map((node) => {
      const label = [...node.childNodes].filter((child) => !(child.nodeType === 1 && (child as Element).getAttribute('aria-hidden') === 'true')).map((child) => child.textContent ?? '').join('')
      return node.getAttribute('role') === 'separator' ? '-' : node.getAttribute('aria-disabled') === 'true' ? `(${label})` : label
    })
  }

  async choose(id: string): Promise<void> {
    await this.item(id).click()
    await expect(this.root).toHaveCount(0)
  }

  async react(name: string): Promise<void> {
    await this.cell(name).click()
    await expect(this.root).toHaveCount(0)
  }

  async close(): Promise<void> {
    await this.dom.press('Escape')
    await expect(this.root).toHaveCount(0)
  }
}

/** The topic shown in the active tab. Hidden tabs stay in the page with `display: none`. */
export class TopicPane implements TopicVerbs {
  readonly root: Query

  constructor(readonly dom: Dom, readonly menus: Menus) {
    this.root = dom.locator('[data-topic-view]').filter({ visible: true })
  }

  get header(): Query {
    return this.root.locator('[data-topic-header]')
  }

  get list(): Query {
    return this.root.getByRole('list', { name: 'Messages' })
  }

  /** A message by its body text, excluding thread-link previews. */
  message(text: string): Query {
    return this.list.locator('[data-message-row]').filter({ has: this.dom.locator('[data-msg-text]').filter({ hasText: text }) })
  }

  messageMenu(text: string): Promise<MessageMenuDriver> {
    return new MessageMenuDriver(this.dom).openOn(this.message(text).locator('[data-msg-text]').first())
  }

  async chooseInMessageMenu(text: string, item: string | null, options: { readonly onSender?: boolean } = {}): Promise<{ readonly labels: string[] }> {
    const message = this.message(text)
    if (options.onSender === true) {
      this.menus.choose(item)
      await message.locator('[data-sender]').last().click({ button: 'right' })
      return this.menus.last()
    }
    const menu = await this.messageMenu(text)
    const labels = await menu.labels()
    if (item === null) await menu.close()
    else await menu.choose(item)
    return { labels }
  }

  get composer(): Query {
    return this.root.locator('[data-composer] textarea')
  }

  get suggestions(): Query {
    return this.root.locator('[data-mention-suggestions]')
  }

  suggestion(name: string): Query {
    return this.suggestions.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) })
  }

  get composerChips(): Query {
    return this.root.locator('[data-composer] [data-mark]')
  }

  async send(text: string): Promise<void> {
    await this.composer.fill(text)
    await this.composer.press('Enter')
  }

  get checkBar() {
    const bar = this.root.locator('[data-send-check]')
    return { bar, choose: (name: string) => bar.getByRole('button', { name: new RegExp(`^${name}`) }).click() }
  }

  get audienceWarning(): Query {
    return this.root.locator('[data-audience-warning]')
  }

  /** The message is shown as Slack holds it: once, and not pending. */
  async expectSent(text: string): Promise<void> {
    await expect(this.message(text)).toHaveCount(1, { timeout: 15_000 })
    await expect(this.message(text)).not.toHaveAttribute('data-pending', /.*/, { timeout: 15_000 })
  }

  /** A failed send's row, with its Retry and Delete draft. */
  failed(text: string) {
    const row = this.message(text).and(this.list.locator('[data-pending="failed"]'))
    return {
      row,
      retry: () => row.getByRole('button', { name: 'Retry' }).click(),
      discard: () => row.getByRole('button', { name: 'Delete draft' }).click(),
    }
  }

  async expectTitle(title: TextMatch): Promise<void> {
    await expect(this.header).toContainText(title, { timeout: 15_000 })
  }

  async expectMessage(text: string): Promise<void> {
    await expect(this.message(text)).toBeVisible({ timeout: 15_000 })
  }

  /** The header's context pill: the channel, or a DM's person and whether they are active. */
  get contextPill(): Query {
    return this.header.locator('[data-island="left"]').getByRole('button').first()
  }

  async expectPresence(presence: 'active' | 'away'): Promise<void> {
    await expect(this.contextPill.locator('[data-pill-presence]')).toHaveAttribute('data-pill-presence', presence)
    await expect(this.contextPill).toHaveAccessibleName(new RegExp(`, ${presence}\\. Show in sidebar\\.$`))
  }

  get titleButton(): Query {
    return this.header.getByRole('heading').getByRole('button')
  }

  get moreButton(): Query {
    return this.header.getByRole('button', { name: 'More', exact: true })
  }

  /** Opens the topic menu from ⋯ and picks `item`. */
  async chooseInMenu(item: string): Promise<MenuSeen> {
    this.menus.choose(item)
    await this.moreButton.click()
    return this.menus.last()
  }

  /** Opens the topic menu by right-clicking the title and picks `item`. */
  async chooseInTitleMenu(item: string): Promise<MenuSeen> {
    this.menus.choose(item)
    await this.titleButton.click({ button: 'right' })
    return this.menus.last()
  }
}
