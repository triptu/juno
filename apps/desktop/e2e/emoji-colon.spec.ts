// Colon emoji in the inline edit field, what needs a browser: the list shows
// whole in the window. The picks, Esc, a closing colon, the edit field's keys,
// workspace emoji and the Juno panel's composer are in the DOM lane
// (`dom/emoji-colon.test.ts`).
import { expect, syncedTest } from './fixtures'

syncedTest('the inline edit field\'s emoji list shows whole in the window', async ({ juno }) => {
  await juno.sidebar.row('#eng').open()
  await juno.topic.send('Edit with emoji')
  await juno.topic.expectSent('Edit with emoji')
  await juno.topic.chooseInMessageMenu('Edit with emoji', 'edit')
  const edit = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(edit).toBeFocused()
  await edit.pressSequentially(' :tad')
  const list = juno.win.getByRole('listbox', { name: 'Emoji' })
  await expect(list).toBeVisible()
  await expect(list).toBeInViewport({ ratio: 1 })
})
