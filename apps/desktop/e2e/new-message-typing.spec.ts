// ⌘N and typing at once (spec section 12, "Writing"): keys typed right
// after ⌘N, before the destination list's search has focus, reach the
// search in order, Enter picks only once they are in it, and keys after
// Enter reach the field. Each test types with no wait after the menu
// command.
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const DRAFT = 'Half a thought'

/** ⌘N, then "maya", Enter and a first word, with no wait between them. */
async function newMessageAndType(juno: Juno): Promise<void> {
  await juno.tabs.menu('new-message')
  await juno.win.keyboard.type('maya')
  await juno.win.keyboard.press('Enter')
  await juno.win.keyboard.type('Hi')
}

test('keys typed right after ⌘N from a topic reach the new Home tab', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, tabs, sidebar, topic } = juno

  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.composer.focus()
  await newMessageAndType(juno)

  await tabs.expectCount(2)
  await tabs.expectActiveAt('Home', 0)
  await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya Chen')
  await expect(write.composer).toHaveValue('Hi')
  await expect(write.composer).toBeFocused()
  await tabs.select(POSTGRES)
  await expect(topic.composer).toHaveValue('')
})

test('keys typed right after ⌘N on Home reach its destination list', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, tabs } = juno

  await write.composer.focus()
  await newMessageAndType(juno)

  await tabs.expectCount(1)
  await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya Chen')
  await expect(write.composer).toHaveValue('Hi')
  await expect(write.composer).toBeFocused()
})

test('keys typed right after ⌘N on Home with a draft reach the new Home tab, and the draft is untouched', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write, tabs } = juno

  await write.write(DRAFT)
  await expect(write.composer).toBeFocused()
  await newMessageAndType(juno)

  await tabs.expectCount(2)
  await tabs.expectActiveAt('Home', 1)
  await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya Chen')
  await expect(write.composer).toHaveValue('Hi')
  await expect(write.composer).toBeFocused()
  await tabs.selectAt('Home', 0)
  await tabs.expectActiveAt('Home', 0)
  await expect(write.composer).toHaveValue(DRAFT)
  await write.expectDestination('Juno')
})
