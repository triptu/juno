// ⌘N and typing at once (spec section 12, "Writing"): keys typed right
// after ⌘N, before the destination list's search has focus, reach the
// search in order, Enter picks only once they are in it, and keys after
// Enter reach the field. Each step types with no wait after the menu
// command.
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const DRAFT = 'Half a thought'

/** ⌘N, then "maya", Enter and a first word, with no wait between them. */
async function newMessageAndType(juno: Juno): Promise<void> {
  await juno.tabs.shortcut('new-message')
  await juno.win.keyboard.type('maya')
  await juno.win.keyboard.press('Enter')
  await juno.win.keyboard.type('Hi')
}

test('keys typed right after ⌘N reach the destination list on Home, a new Home tab when Home has a draft, and a new Home tab from a topic', async ({ juno }) => {
  const { write, tabs, sidebar, topic } = juno

  await test.step('on Home, the keys reach its destination list', async () => {
    await write.composer.focus()
    await newMessageAndType(juno)
    await tabs.expectCount(1)
    await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya')
    await expect(write.composer).toHaveValue('Hi')
    await expect(write.composer).toBeFocused()
  })

  await test.step('on Home with a draft, the keys reach a new Home tab, and the draft is untouched', async () => {
    await write.composer.press('End')
    await write.composer.pressSequentially(`. ${DRAFT}`)
    await newMessageAndType(juno)
    await tabs.expectCount(2)
    await tabs.expectActiveAt('Home', 1)
    await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya')
    await expect(write.composer).toHaveValue('Hi')
    await expect(write.composer).toBeFocused()
    await tabs.selectAt('Home', 0)
    await tabs.expectActiveAt('Home', 0)
    await expect(write.composer).toHaveValue(`Hi. ${DRAFT}`)
    await write.expectDestination('Maya')
    await tabs.selectAt('Home', 1)
    await tabs.menu('close-tab')
    await tabs.expectCount(1)
  })

  await test.step('from a topic, the keys reach a new Home tab', async () => {
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await topic.composer.focus()
    await newMessageAndType(juno)
    await tabs.expectCount(2)
    await tabs.expectActiveAt('Home', 0)
    await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya')
    await expect(write.composer).toHaveValue('Hi')
    await expect(write.composer).toBeFocused()
    await tabs.select(POSTGRES)
    await expect(topic.composer).toHaveValue('')
  })
})
