import { expect } from '../expect'
import type { Dom } from '../input'
import type { Query } from '../query'
import { escapeRegExp } from './menus'
import { PEEK_KEYS, type PeekKeyName } from './sidebar'

/** The peek popover (SPEC 5, "Peek"). */
export class PeekPopover {
  readonly root: Query

  constructor(readonly dom: Dom) {
    this.root = dom.locator('[role="dialog"][aria-roledescription="peek"]')
  }

  async expectShowing(title: string): Promise<void> {
    await expect(this.root).toBeVisible()
    await expect(this.root).toHaveAccessibleName(new RegExp(`^${escapeRegExp(title)}`))
  }

  async expectMessage(text: string): Promise<void> {
    await expect(this.root.getByRole('list', { name: 'Messages' }).getByText(text).first()).toBeVisible()
  }

  async expectClosed(): Promise<void> {
    await expect(this.root).toHaveCount(0)
  }

  /** Lets go of the peek key. */
  async release(key: PeekKeyName = 'option'): Promise<void> {
    this.dom.up(PEEK_KEYS[key])
  }
}
