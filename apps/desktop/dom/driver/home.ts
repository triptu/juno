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

  get composerChips(): Query {
    return this.root.locator('[data-composer] [data-mark]')
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

  /** Tidy up's row, which opens its review sheet. */
  review(): Promise<ReviewSheet> {
    return this.reviewOf('tidyUp', 'settled')
  }

  /** A review card's row, which opens its review sheet (`data-sheet="<sheet>"`). */
  async reviewOf(kind: HomeItemKind, sheet: string): Promise<ReviewSheet> {
    await this.item(kind).locator('[data-home-review]').click()
    const pane = new ReviewSheet(this.dom, sheet)
    await expect(pane.root).toBeVisible()
    return pane
  }
}

/**
 * A Home card's review sheet (SPEC 12), the same for every card: each
 * proposal with its reason, the card's action and its "no", and Undo.
 */
export class ReviewSheet {
  constructor(readonly dom: Dom, readonly name: string) {}

  get root(): Query {
    return this.dom.locator(`[data-sheet="${this.name}"]`)
  }

  get title(): Query {
    return this.root.locator('h2')
  }

  /** A proposal's row, by text in its title. */
  row(title: string): Query {
    return this.root.locator('[data-review-row]').filter({ has: this.dom.locator('[data-review-title]').filter({ hasText: title }) })
  }

  reason(title: string): Query {
    return this.row(title).locator('[data-review-reason]')
  }

  /** The card's action: Resolve, Move back, Mark done, Delete. */
  act(title: string): Query {
    return this.row(title).locator('[data-review-act]')
  }

  /** The card's "no": Keep open, Keep, Not done. */
  decline(title: string): Query {
    return this.row(title).locator('[data-review-decline]')
  }

  undo(title: string): Query {
    return this.row(title).locator('[data-review-undo]')
  }

  /** The line under the title: what the rows are, and what the action does in Slack. */
  get lead(): Query {
    return this.root.locator('[data-review-lead]')
  }

  /** The message or draft quoted in the row. */
  quote(title: string): Query {
    return this.row(title).locator('[data-review-quote]')
  }

  /** `open`, `done` or `declined`. */
  status(title: string): Promise<string | null> {
    return this.row(title).getAttribute('data-review-status')
  }

  /** What the row says once acted on: "Resolved", "Moved back", "Kept in Follow-up". */
  outcome(title: string): Query {
    return this.row(title).locator('[data-review-outcome]')
  }

  /** Done, which closes the sheet. */
  get close(): Query {
    return this.root.locator('[data-review-close]')
  }

  /** The bottom button that acts on every row still open. */
  get all(): Query {
    return this.root.locator('[data-review-all]')
  }

  get about(): Query {
    return this.root.locator('[data-review-about]')
  }

  get explainer(): Query {
    return this.root.locator('[data-review-explainer]')
  }
}

/** The welcome card on Home (SPEC 4, "The welcome"). */
export class WelcomeCard {
  readonly root: Query

  constructor(readonly dom: Dom, readonly menus: Menus) {
    // The card's room can stay on Home, empty and hidden; this is the card on screen.
    this.root = dom.locator('[data-home]').filter({ visible: true }).locator('section[data-welcome]').filter({ visible: true })
  }

  /** Hide, or Done once all three are ticked. */
  get close(): Query {
    return this.root.locator('[data-welcome-close]')
  }

  hint(name: 'peek' | 'tab' | 'juno'): Query {
    return this.root.locator(`[data-welcome-hint="${name}"]`)
  }

  async expectShown(): Promise<void> {
    await expect(this.root).toBeVisible({ timeout: 15_000 })
  }

  async expectGone(): Promise<void> {
    await expect(this.root).toHaveCount(0)
  }

  /** Exactly these hints are ticked. */
  async expectTicked(...names: ReadonlyArray<'peek' | 'tab' | 'juno'>): Promise<void> {
    for (const name of ['peek', 'tab', 'juno'] as const) {
      if (names.includes(name)) await expect(this.hint(name)).toHaveAttribute('data-done', '')
      else await expect(this.hint(name)).not.toHaveAttribute('data-done')
    }
  }

  /** Help › Show the Tour, through its app menu item. */
  async openFromHelp(): Promise<void> {
    this.menus.appMenu('tour')
    await this.expectShown()
  }
}
