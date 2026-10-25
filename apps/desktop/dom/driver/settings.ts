import type { AccountMenuVerbs, SettingsSectionName, SettingsVerbs, TextMatch } from '../../e2e/driver/verbs'
import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import type { Sidebar } from './sidebar'

/** The popover behind the avatar button. */
export class AccountMenu implements AccountMenuVerbs {
  readonly root: Query

  constructor(readonly dom: Dom, readonly sidebar: Sidebar) {
    this.root = dom.getByRole('dialog', { name: 'Account' })
  }

  async open(): Promise<void> {
    if (this.root.isVisible()) return
    await this.sidebar.accountButton.click()
    await expect(this.root).toBeVisible()
  }

  async close(): Promise<void> {
    if (!this.root.isVisible()) return
    await this.dom.press('Escape')
    await expect(this.root).toHaveCount(0)
  }

  item(name: TextMatch): Query {
    return this.root.getByRole('menuitem', { name })
  }

  async choose(name: TextMatch): Promise<void> {
    await this.open()
    await this.item(name).click()
    await expect(this.root).toHaveCount(0)
  }
}

/** Settings: its list of sections, and the open section's page. */
export class SettingsPage implements SettingsVerbs {
  readonly root: Query
  readonly nav: Query

  constructor(readonly dom: Dom) {
    this.root = dom.getByRole('main')
    this.nav = this.root.getByRole('navigation', { name: 'Settings' })
  }

  section(name: SettingsSectionName): Query {
    return this.nav.getByRole('button', { name, exact: true })
  }

  async show(name: SettingsSectionName): Promise<void> {
    await this.section(name).click()
    await expect(this.section(name)).toHaveAttribute('aria-current', 'page')
  }

  themeRadio(name: 'System' | 'Light' | 'Dark'): Query {
    return this.root.getByRole('radio', { name })
  }
}

export type HoursSection = 'Notifications' | 'Active in Slack'
export type HoursRowName = 'Weekdays' | 'Saturday' | 'Sunday'
export const hoursRows: ReadonlyArray<HoursRowName> = ['Weekdays', 'Saturday', 'Sunday']

/** Settings › Notifications. */
export class NotificationsPage {
  readonly root: Query

  constructor(readonly dom: Dom) {
    this.root = dom.getByRole('main')
  }

  /** The Notification hours or Active in Slack rows. */
  hours(which: HoursSection): Query {
    return this.root.getByRole('group', { name: which === 'Notifications' ? 'Notification hours' : which, exact: true })
  }

  /** One row's from or to. Off is the first choice in from; an off row has no to. */
  edge(which: HoursSection, row: HoursRowName, edge: 'from' | 'to'): Query {
    return this.hours(which).getByRole('combobox', { name: `${row} ${edge}`, exact: true })
  }

  /** Sets a row's from and to, in minutes since midnight, or turns it off. */
  async setRow(which: HoursSection, row: HoursRowName, hours: { readonly from: number; readonly to: number } | 'off'): Promise<void> {
    if (hours === 'off') return void (await this.edge(which, row, 'from').selectOption('off'))
    await this.edge(which, row, 'from').selectOption(String(hours.from))
    await this.edge(which, row, 'to').selectOption(String(hours.to))
  }

  /** Checks a row as the engine saved it: from and to, or off with no to. */
  async expectRow(which: HoursSection, row: HoursRowName, hours: { readonly from: number; readonly to: number } | 'off'): Promise<void> {
    if (hours === 'off') {
      await expect(this.edge(which, row, 'from')).toHaveValue('off')
      await expect(this.edge(which, row, 'to')).toHaveCount(0)
      return
    }
    await expect(this.edge(which, row, 'from')).toHaveValue(String(hours.from))
    await expect(this.edge(which, row, 'to')).toHaveValue(String(hours.to))
  }

  get newInstruction(): Query {
    return this.root.getByRole('textbox', { name: 'New instruction', exact: true })
  }

  get addInstructionButton(): Query {
    return this.root.locator('[data-instruction-add]').getByRole('button', { name: 'Add', exact: true })
  }

  async addInstruction(direction: 'Notify me' | "Don't notify", text: string): Promise<void> {
    await this.newInstructionDirection(direction).click()
    await this.newInstruction.fill(text)
    await this.addInstructionButton.click()
  }

  instructionExample(text: string): Query {
    return this.root.locator('[data-instruction-examples]').getByRole('button', { name: text, exact: true })
  }

  newInstructionDirection(direction: 'Notify me' | "Don't notify"): Query {
    return this.root.getByRole('radiogroup', { name: "New instruction: Notify me or Don't notify" }).getByRole('radio', { name: direction })
  }

  /** The row of the instruction with these words. */
  instruction(text: string): Query {
    return this.root.locator('[data-instruction]').filter({ has: this.dom.locator(`input[value="${text.replaceAll('"', '\\"')}"]`) })
  }

  async removeInstruction(text: string): Promise<void> {
    await this.instruction(text).getByRole('button', { name: 'Remove instruction' }).click()
  }
}

