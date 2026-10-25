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

  /** A DM's person, active or away, in the context pill. */
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

  /** The context pill, a button named by the channel and its kind. */
  get contextPill(): Query {
    return this.header.locator('[data-island="left"]').getByRole('button').first()
  }

  /** The right island's Follow, on a thread you do not follow: a click follows it. */
  get followButton(): Query {
    return this.header.getByRole('button', { name: 'Follow', exact: true })
  }

  /** Clicks Follow and waits for it to give way. Answers whether a native menu opened on the way (none should). */
  async follow(): Promise<{ readonly menuOpened: boolean }> {
    const asked = this.menus.asked
    await this.followButton.click()
    await expect(this.followButton).toHaveCount(0, { timeout: 10_000 })
    return { menuOpened: this.menus.asked !== asked }
  }

  get divider(): Query {
    return this.root.locator('[data-new-divider]')
  }

  /** The "N new" divider sits right before the message that starts with `text`. Where it sits on screen is the browser lane's. */
  async expectDividerBefore(text: string): Promise<void> {
    await expect(this.root.locator('[data-new-divider] + [data-message-row]')).toContainText(text, { timeout: 15_000 })
  }

  async expectNew(count: number): Promise<void> {
    await expect(this.divider).toHaveText(`${count} new`)
  }

  async expectNoDivider(): Promise<void> {
    await expect(this.divider).toHaveCount(0)
  }

  /** A thread link under the Main message whose body contains `text`. */
  threadLinkUnder(text: string): ThreadLink {
    return new ThreadLink(this.message(text).locator('[data-thread-link]'))
  }

  /** A #channel chip in a message: clicking it scopes the sidebar. */
  async clickChannel(name: string): Promise<void> {
    await this.list.getByRole('button', { name: `#${name}` }).first().click()
  }

  /** Opens the topic switcher from the title. */
  async openSwitcher(): Promise<TopicSwitcher> {
    await this.titleButton.click()
    const switcher = new TopicSwitcher(this.dom)
    await expect(switcher.root).toBeVisible()
    return switcher
  }

  /** Focuses the title and opens the switcher with Enter. */
  async openSwitcherWithKeyboard(): Promise<TopicSwitcher> {
    await this.titleButton.focus()
    await this.dom.press('Enter')
    const switcher = new TopicSwitcher(this.dom)
    await expect(switcher.root).toBeVisible()
    return switcher
  }

  /** Opens the topic menu from ⋯ and picks `item`. */
  async chooseInMenu(item: string): Promise<MenuSeen> {
    this.menus.choose(item)
    await this.moreButton.click()
    return this.menus.last()
  }

  /** Opens the topic menu by right-clicking the title and picks `item`. */
  async chooseInTitleMenu(item: string | null): Promise<MenuSeen> {
    this.menus.choose(item)
    await this.titleButton.click({ button: 'right' })
    return this.menus.last()
  }
}

/** A thread link under a Main message: a press opens the thread, with ⌘ in a new tab. */
export class ThreadLink {
  constructor(readonly root: Query) {}

  async open(options: { readonly newTab?: boolean } = {}): Promise<void> {
    await this.root.click(options.newTab === true ? { modifiers: ['Meta'] } : {})
  }
}

/** The title's topic switcher: a search field over the channel's Main and threads. */
export class TopicSwitcher {
  readonly root: Query

  constructor(readonly dom: Dom) {
    this.root = dom.getByRole('dialog', { name: 'Topics in this channel' })
  }

  get search(): Query {
    return this.root.getByRole('textbox', { name: 'Search this channel' })
  }

  /** A row, by the start of its title ("Main" for Main). */
  row(title: string): Query {
    return this.root.getByRole('option', { name: new RegExp(`^${escapeRegExp(title)}`) })
  }

  /** Row titles, top to bottom. */
  titles(): string[] {
    return this.root.getByRole('option').all().map((row) => (row.querySelector('span span')?.textContent ?? row.textContent ?? '').trim())
  }

  /** A press on a row; with `newTab`, ⌘ held. */
  async open(title: string, options: { readonly newTab?: boolean } = {}): Promise<void> {
    await this.row(title).click(options.newTab === true ? { modifiers: ['Meta'] } : {})
  }

  async type(text: string): Promise<void> {
    await this.search.fill(text)
  }
}
