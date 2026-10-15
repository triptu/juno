import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

test.describe('Juno panel context', () => {
  test('Catch me up sits on the field edge at the destination chip height; the context line starts at the field text', async ({ page }) => {
    await open(page, 'Workspace', 'page/juno-panel')
    const at = await page.evaluate(() => {
      const context = document.querySelector('[data-panel-context]')!
      let scope: Element = context
      while (!scope.querySelector('[data-composer-field]')) scope = scope.parentElement!
      const field = scope.querySelector('[data-composer-field]')!
      const textarea = field.querySelector('textarea')!
      const chip = context.querySelector('[data-catch-me-up]')!
      const line = context.querySelector('[data-panel-sees]')!
      const c = chip.getBoundingClientRect()
      const style = getComputedStyle(chip)
      return {
        field: field.getBoundingClientRect().left,
        fieldText: textarea.getBoundingClientRect().left + parseFloat(getComputedStyle(textarea).paddingLeft),
        chip: c.left, chipHeight: c.height,
        chipStart: parseFloat(style.paddingLeft), chipEnd: parseFloat(style.paddingRight),
        lineText: line.firstElementChild!.getBoundingClientRect().left,
      }
    })
    expect(at.chip).toBe(at.field)
    expect(at.chipHeight).toBe(28)
    // The destination chip's 10px icon side; the text side is 12px with no chevron after it.
    expect(at.chipStart).toBe(10)
    expect(at.chipEnd).toBe(12)
    expect(at.lineText).toBe(at.fieldText)
  })
})
