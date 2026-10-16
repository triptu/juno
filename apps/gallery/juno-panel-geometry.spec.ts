import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

/** The topic chip, the field and its text, measured. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const context = document.querySelector('[data-panel-context]')!
    const field = context.closest('[data-composer-field]')!
    const textarea = field.querySelector('textarea')!
    const chip = context.querySelector<HTMLElement>('[data-panel-sees]')!
    const label = chip.lastElementChild as HTMLElement
    const f = field.getBoundingClientRect()
    const c = chip.getBoundingClientRect()
    const t = textarea.getBoundingClientRect()
    const textTop = t.top + parseFloat(getComputedStyle(textarea).paddingTop)
    return {
      fieldText: t.left + parseFloat(getComputedStyle(textarea).paddingLeft),
      chip: c.left,
      above: c.top - (f.top + 1),
      below: textTop - c.bottom,
      chipRight: c.right,
      fieldRight: f.right,
      cut: label.scrollWidth > label.clientWidth,
    }
  })

test.describe('Juno panel context', () => {
  test('the topic chip sits in the field, on its text inset, with an even gap above and below', async ({ page }) => {
    await open(page, 'Workspace', 'page/juno-panel')
    const at = await measure(page)
    expect(at.chip).toBe(at.fieldText)
    expect(at.above).toBe(8)
    expect(at.below).toBe(8)
  })

  test('a long channel name cuts inside the chip, which stays inside the field', async ({ page }) => {
    await open(page, 'Workspace', 'page/juno-panel-long-name')
    const at = await measure(page)
    expect(at.cut).toBe(true)
    expect(at.chipRight).toBeLessThan(at.fieldRight)
    expect(at.chip).toBe(at.fieldText)
  })
})
