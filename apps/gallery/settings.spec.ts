import { expect, type Page } from '@playwright/test'
import { openState, test } from './support'

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })

test('a saved API key looks the same in Set up Juno and Settings › Juno: the Key set chip beside the field, which keeps its placeholder', async ({ page }) => {
  const read = () =>
    page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>('[data-fixture-frame] input[type="password"]')!
      const chip = [...document.querySelectorAll('[data-fixture-frame] span')].find((span) => span.children.length === 0 && span.textContent === 'Key set')
      return { placeholder: field.placeholder, chipBeforeField: chip !== undefined && chip.getBoundingClientRect().right <= field.getBoundingClientRect().left }
    })
  await open(page, 'SetUpJunoView', 'openrouter/model-chosen')
  const setUp = await read()
  await open(page, 'SettingsPage', 'sections/juno')
  expect(setUp).toEqual(await read())
  expect(setUp).toEqual({ placeholder: 'sk-or-…', chipBeforeField: true })
})
