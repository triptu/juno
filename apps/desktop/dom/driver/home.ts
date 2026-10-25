import type { HomeWriteVerbs } from '../../e2e/driver/verbs'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import { escapeRegExp, type Menus } from './menus'


/** Home's composer: the destination chip, the topic chip and the field. */
export class HomeWritePane implements HomeWriteVerbs {
  readonly root: Query

  constructor(readonly dom: Dom) {
    this.root = dom.locator('[data-home]').filter({ visible: true })
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

  get field(): Query {
    return this.dom.locator('[data-composer-field]').filter({ visible: true })
  }

  /** The destination chip above the field: "Send to: Juno", "Send to: #eng". */
  get chip(): Query {
    return this.root.getByRole('button', { name: /^Send to: / })
  }

  get list(): Query {
    return this.root.getByRole('dialog', { name: 'Send to' }).getByRole('listbox')
  }

  get search(): Query {
    return this.root.getByRole('dialog', { name: 'Send to' }).getByRole('textbox')
  }

  option(name: string): Query {
    return this.list.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) })
  }

  async write(text: string): Promise<void> {
    await this.composer.fill(text)
  }

  async send(): Promise<void> {
    await this.composer.press('Enter')
  }

  async pickConversation(query: string, name: string): Promise<void> {
    if (!this.search.isVisible()) await this.chip.click()
    await this.search.fill(query)
    await this.option(name).click()
    await expect(this.list).toBeHidden()
  }

  async expectDestination(label: string): Promise<void> {
    await expect(this.chip).toHaveAccessibleName(new RegExp(`^Send to: ${escapeRegExp(label)}`))
  }

  get topicChip(): Query {
    return this.root.getByRole('button', { name: /^Topic: / })
  }

  get topicList(): Query {
    return this.root.getByRole('dialog', { name: 'Pick a topic' }).getByRole('listbox')
  }

  get topicSearch(): Query {
    return this.root.getByRole('dialog', { name: 'Pick a topic' }).getByRole('textbox')
  }

  topicOption(title: string): Query {
    return this.topicList.getByRole('option', { name: new RegExp(`^${escapeRegExp(title)}`) })
  }

  async pickTopic(query: string, title: string): Promise<void> {
    if (!this.topicSearch.isVisible()) await this.topicChip.click()
    await this.topicSearch.fill(query)
    await this.topicOption(title).click()
    await expect(this.topicList).toBeHidden()
  }

  async expectTopic(label: string): Promise<void> {
    await expect(this.topicChip).toHaveAccessibleName(new RegExp(`^Topic: ${escapeRegExp(label)}`))
  }
}

export type HomeItemKind = string

/** Home's list of what waits (SPEC 12). */
export class HomePane {
  constructor(readonly dom: Dom, readonly menus: Menus) {}

  get root(): Query {
    return this.dom.locator('[data-home]:not([data-home-waiting]):not([data-home-loading])').filter({ visible: true })
  }

  get greeting(): Query {
    return this.root.getByRole('heading').first()
  }

  async expectShown(): Promise<void> {
    await expect(this.root).toBeVisible()
    await expect(this.greeting).toBeAttached()
  }

  get navItem(): Query {
    return this.dom.locator('header[aria-label="Sidebar title bar"]').getByRole('button', { name: 'Home' })
  }

  async open(): Promise<void> {
    await this.navItem.click()
    await this.expectShown()
  }

  item(kind: HomeItemKind): Query {
    return this.root.locator(`[data-home-item="${kind}"]`)
  }

  title(kind: HomeItemKind): Query {
    return this.item(kind).locator('[data-home-title]')
  }

  async kinds(): Promise<string[]> {
    return this.root.locator('[data-home-item]').all().map((row) => row.getAttribute('data-home-item') ?? '')
  }

  async openItem(kind: HomeItemKind): Promise<void> {
    await this.item(kind).getByRole('link').click()
  }

  button(kind: HomeItemKind, name: string): Query {
    return this.item(kind).getByRole('button', { name, exact: true })
  }

  async chooseInItemMenu(kind: HomeItemKind, item: string): Promise<string[]> {
    this.menus.choose(item)
    await this.item(kind).click({ button: 'right' })
    return (await this.menus.last()).labels
  }
}
