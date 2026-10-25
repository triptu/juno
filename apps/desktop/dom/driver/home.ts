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

  /** The list a first @ or # opens while Juno is chosen. */
  get sendTo(): Query {
    return this.root.locator('[data-send-to]')
  }

  sendToOption(name: string): Query {
    return this.sendTo.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}(\\s|$)`) })
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

  /** The greeting; with a picture, Home's heading for screen readers only (SPEC 12, "A picture"). */
  get greeting(): Query {
    return this.root.getByRole('heading', { level: 2 })
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

  meta(kind: HomeItemKind): Query {
    return this.item(kind).locator('[data-home-meta]')
  }

  /** What Home shows above its composer: the scene or picture, the greeting, the rows and the welcome card (SPEC 12). */
  get column(): Query {
    return this.root.locator('[data-home-column]')
  }

  /** The picture in the caught-up scene's place (SPEC 12, "A picture"). */
  get picture(): Query {
    return this.root.locator('[data-home-picture]')
  }

  /** Tidy up's row, which opens its review sheet. */
  review(): Promise<ReviewSheetPane> {
    return this.reviewOf('tidyUp', 'settled')
  }

  /** A review card's row, which opens its review sheet (`data-sheet="<sheet>"`). */
  async reviewOf(kind: HomeItemKind, sheet: string): Promise<ReviewSheetPane> {
    await this.item(kind).locator('[data-home-review]').click()
    const pane = new ReviewSheetPane(this.dom, sheet)
    await expect(pane.root).toBeVisible()
    return pane
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

/** A Home card's review sheet (SPEC 12), the same for every card: each proposal with its reason, the action and its "no", the outcome and Undo. */
export class ReviewSheetPane {
  constructor(readonly dom: Dom, readonly name: string) {}

  get root(): Query {
    return this.dom.locator(`[data-sheet="${this.name}"]`)
  }

  get title(): Query {
    return this.root.getByRole('heading', { level: 2 })
  }

  get lead(): Query {
    return this.root.locator('[data-review-lead]')
  }

  /** A proposal's row, by text in its title. */
  row(title: string): Query {
    return this.root.locator('[data-review-row]').filter({ has: this.root.locator('[data-review-title]').filter({ hasText: title }) })
  }

  reason(title: string): Query {
    return this.row(title).locator('[data-review-reason]')
  }

  quote(title: string): Query {
    return this.row(title).locator('[data-review-quote]')
  }

  /** `open`, `done` or `declined`. */
  status(title: string): Promise<string | null> {
    return this.row(title).getAttribute('data-review-status')
  }

  act(title: string): Query {
    return this.row(title).locator('[data-review-act]')
  }

  decline(title: string): Query {
    return this.row(title).locator('[data-review-decline]')
  }

  outcome(title: string): Query {
    return this.row(title).locator('[data-review-outcome]')
  }

  undo(title: string): Query {
    return this.row(title).locator('[data-review-undo]')
  }

  get all(): Query {
    return this.root.locator('[data-review-all]')
  }

  get close(): Query {
    return this.root.locator('[data-review-close]')
  }

  get about(): Query {
    return this.root.locator('[data-review-about]')
  }

  get explainer(): Query {
    return this.root.locator('[data-review-explainer]')
  }
}
