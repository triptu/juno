// The tab strip and Back and Forward, as the Playwright driver's (`e2e/driver/juno.ts`).
import type { AppMenuItem } from '../../e2e/driver/surface'
import type { TabStripVerbs } from '../../e2e/driver/verbs'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import { escapeRegExp, type Menus } from './menus'

/** The tab strip over the workspace. */
export class TabStrip implements TabStripVerbs {
  readonly root: Query

  constructor(readonly dom: Dom, readonly menus: Menus) {
    this.root = dom.getByRole('tablist')
  }

  tab(title: string): Query {
    return this.root.getByRole('tab', { name: new RegExp(`^${escapeRegExp(title)}`) })
  }

  nth(title: string, index: number): Query {
    return this.tab(title).nth(index)
  }

  async titles(): Promise<string[]> {
    return this.root.getByRole('tab').all().map((tab) => tab.getAttribute('data-tooltip') ?? '')
  }

  async expectCount(count: number): Promise<void> {
    await expect(this.root.getByRole('tab')).toHaveCount(count, { timeout: 15_000 })
  }

  async expectActive(title: string): Promise<void> {
    await expect(this.tab(title)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
  }

  async expectActiveAt(title: string, index: number): Promise<void> {
    await expect(this.nth(title, index)).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
  }

  /**
   * Mouse down on a tab, then wait until it is the active one: the switch goes
   * through the navigation queue, and a next step must not land in the old tab.
   */
  async select(title: string): Promise<void> {
    await this.tab(title).click()
    await this.expectActive(title)
  }

  /** The close button on a tab. */
  async close(title: string): Promise<void> {
    await this.tab(title).hover()
    await this.closeButton(title).click()
  }

  /** The close button: the tab's sibling. */
  closeButton(title: string): Query {
    return this.tab(title).parent().getByRole('button', { name: 'Close tab' })
  }

  /** The close button on the `index`th tab titled `title`. */
  async closeAt(title: string, index: number): Promise<void> {
    const tab = this.nth(title, index)
    await tab.hover()
    await tab.parent().getByRole('button', { name: 'Close tab' }).click()
  }

  /** Delete on the focused tab. */
  async closeWithKeyboard(title: string): Promise<void> {
    await this.tab(title).focus()
    await this.dom.press('Delete')
  }

  async selectAt(title: string, index: number): Promise<void> {
    await this.nth(title, index).click()
    await this.expectActiveAt(title, index)
  }

  async expectFocused(title: string): Promise<void> {
    await expect(this.tab(title)).toBeFocused()
  }

  async expectPinned(title: string, pinned = true): Promise<void> {
    if (pinned) await expect(this.tab(title)).toHaveAttribute('data-pinned', '')
    else await expect(this.tab(title)).not.toHaveAttribute('data-pinned')
  }

  /** The dot of an inactive tab whose topic has unread messages. */
  async expectUnread(title: string, unread = true): Promise<void> {
    if (unread) await expect(this.tab(title)).toHaveAttribute('data-unread', '', { timeout: 15_000 })
    else await expect(this.tab(title)).not.toHaveAttribute('data-unread', undefined, { timeout: 15_000 })
  }

  /** The "+" after the last tab: a new tab with Home. */
  get newTabButton(): Query {
    return this.dom.getByRole('region', { name: 'Workspace' }).getByRole('button', { name: 'New tab ⌘T' })
  }

  async menu(id: AppMenuItem): Promise<void> {
    this.menus.appMenu(id)
  }

  /** ⌘N or ⌘T as a user presses it: the keydown reaches the page, then main runs the menu item. */
  async shortcut(id: 'new-message' | 'new-tab'): Promise<void> {
    const key = id === 'new-message' ? 'n' : 't'
    this.dom.key(this.dom.active ?? (this.dom.document.body as HTMLElement), key, ['Meta'])
    this.menus.appMenu(id)
  }

  /** Right-clicks a tab and picks `item` in the tab menu. Returns the menu's labels. */
  async contextMenu(title: string, item: string): Promise<string[]> {
    this.menus.choose(item)
    await this.tab(title).click({ button: 'right' })
    return (await this.menus.last()).labels
  }
}

/** Back and Forward: the title bar buttons and the app menu (⌘[ and ⌘]). */
export class Navigation {
  constructor(readonly dom: Dom, readonly menus: Menus) {}

  get backButton(): Query {
    return this.dom.getByRole('button', { name: 'Back ⌘[' }).filter({ visible: true })
  }

  get forwardButton(): Query {
    return this.dom.getByRole('button', { name: 'Forward ⌘]' }).filter({ visible: true })
  }

  async back(): Promise<void> {
    await this.backButton.click()
  }

  async forward(): Promise<void> {
    await this.forwardButton.click()
  }

  async menu(id: 'back' | 'forward'): Promise<void> {
    this.menus.appMenu(id)
  }

  async expectCanGo(back: boolean, forward: boolean): Promise<void> {
    if (back) await expect(this.backButton).toBeEnabled()
    else await expect(this.backButton).toBeDisabled()
    if (forward) await expect(this.forwardButton).toBeEnabled()
    else await expect(this.forwardButton).toBeDisabled()
  }
}
