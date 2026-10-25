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

/** Settings › Notifications. */
export class NotificationsPage {
  readonly root: Query

  constructor(readonly dom: Dom) {
    this.root = dom.getByRole('main')
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

