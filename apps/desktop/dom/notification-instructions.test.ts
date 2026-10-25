// Settings › Notifications, Your instructions: an example fills the add row, an
// instruction is added with its direction, kept across closing Settings, and removed.
import { expect } from './expect'
import { domTest } from './test'

domTest('Your instructions: add one with a direction, see it in the list, remove it', async ({ juno }) => {
  await juno.openNotifications()
  const page = juno.notifications
  const words = 'Social plans, lunch and dinner'

  // There is no default direction: the field and Add wait for one.
  await expect(page.newInstruction).toBeDisabled()
  await expect(page.addInstructionButton).toBeDisabled()

  // An example fills the add row, direction and words, and adds nothing by itself.
  await page.instructionExample('Lunch and social plans').click()
  await expect(page.newInstructionDirection("Don't notify")).toHaveAttribute('aria-checked', 'true')
  await expect(page.newInstruction).toHaveValue('Lunch and social plans')
  await expect(page.newInstruction).toBeFocused()
  await expect(page.root.locator('[data-instruction]')).toHaveCount(0)
  await expect(page.instructionExample('Lunch and social plans')).toBeVisible()

  await page.addInstruction("Don't notify", words)

  const row = page.instruction(words)
  await expect(row).toBeVisible()
  await expect(row.getByRole('radio', { name: "Don't notify" })).toHaveAttribute('aria-checked', 'true')
  // The add row is empty again and waits for the next direction.
  await expect(page.newInstruction).toHaveValue('')
  await expect(page.newInstruction).toBeDisabled()

  // It is saved: close Settings and open it again.
  await juno.tabs.close('Settings')
  await juno.openNotifications()
  await expect(page.instruction(words)).toBeVisible()

  await page.removeInstruction(words)
  await juno.expectToast('Instruction removed')
  await expect(page.instruction(words)).toHaveCount(0)
})
