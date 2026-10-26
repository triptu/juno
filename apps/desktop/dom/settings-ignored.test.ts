// Settings › Ignored (SPEC 14): the list of ignored channels, Stop ignoring with Undo, and ignoring a channel picked
// in the add row by keyboard, as its menu does. Ignoring from a row's menu is in `actions.test.ts`.
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const ROADMAP = 'Proposal: cut offline mode and public'

const ignored = (juno: Juno, name: string) => juno.settings.root.locator('[data-ignored-channel]').filter({ hasText: name })
const addRow = (juno: Juno) => juno.settings.root.locator('[data-ignore-add]')
const channelSelect = (juno: Juno) => addRow(juno).locator('button[aria-label^="Channel to ignore"]')
const ignoreButton = (juno: Juno) => addRow(juno).getByRole('button', { name: 'Ignore', exact: true })
const channelOptions = (juno: Juno) => juno.win.getByRole('listbox', { name: 'Channels' }).getByRole('option')

domTest('Settings › Ignored lists an ignored channel with Stop ignoring and Undo, and ignores a channel picked by keyboard', async ({ juno, step }) => {
  await step('an ignored channel is listed, and Stop ignoring has Undo', async () => {
    await juno.openSettings('Ignored')
    await expect(ignored(juno, 'alerts-prod')).toHaveCount(0)
    await juno.sidebar.selectView('Automated')
    await juno.sidebar.row('#alerts-prod').chooseInMenu('ignore-channel')
    await juno.expectToast('Ignoring #alerts-prod')
    await juno.tabs.select('Settings')
    await expect(ignored(juno, 'alerts-prod')).toBeVisible()

    await ignored(juno, 'alerts-prod').getByRole('button', { name: 'Stop ignoring alerts-prod' }).click()
    await juno.expectToast('Stopped ignoring #alerts-prod')
    await expect(ignored(juno, 'alerts-prod')).toHaveCount(0)
    await juno.undoFromToast()
    await expect(ignored(juno, 'alerts-prod')).toBeVisible()
  })

  await step('a channel picked by keyboard in the add row is ignored, and Undo brings its topics back', async () => {
    await juno.sidebar.filter('All')
    const roadmap = juno.sidebar.row(ROADMAP)
    await roadmap.expectVisible()
    await juno.tabs.select('Settings')
    await expect(ignoreButton(juno)).toBeDisabled()

    // A key typed on the closed select opens its list with that text; the ignored #alerts-prod is not offered.
    await channelSelect(juno).focus()
    await juno.win.keyboard.type('p')
    await expect(channelOptions(juno)).toHaveText(['platform', 'product'])
    await juno.win.keyboard.press('ArrowDown')
    await juno.win.keyboard.press('Enter')
    await expect(channelOptions(juno)).toHaveCount(0)
    await expect(channelSelect(juno)).toBeFocused()
    await expect(channelSelect(juno)).toHaveText('product')

    await ignoreButton(juno).click()
    await juno.expectToast('Ignoring #product')
    await expect(ignored(juno, 'product')).toBeVisible()
    await roadmap.expectAbsent()
    await expect(ignoreButton(juno)).toBeDisabled()

    await juno.undoFromToast()
    await expect(ignored(juno, 'product')).toHaveCount(0)
    await roadmap.expectVisible()
  })
})
