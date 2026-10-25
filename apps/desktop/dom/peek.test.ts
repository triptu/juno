// Peek (spec section 5) with Space chosen in Settings › General: Space over a
// row peeks, ⌥ no longer does, and Space in a text field types a space. A
// peek marks nothing read and opens nothing. The ⌥ peeks, which check that
// nothing moves, are the browser lane's (peek.spec.ts).
import { expect } from './expect'
import { domTest } from './test'

const RINA = 'Rina finished the onsite'

domTest('with Space as the peek key, Space peeks, ⌥ does not, and Space in a text field types a space', async ({ juno, slack }) => {
  await juno.setPeekKey('space')
  // Closing Settings left Home, whose composer has focus; Space peeks only outside a text field.
  juno.win.active?.blur()
  const rina = juno.sidebar.row(RINA)
  slack.resetCalls()

  await rina.peek('space')
  await juno.peek.expectShowing(RINA)
  await juno.peek.expectMessage('Strong systems design')
  await juno.peek.release('space')
  await juno.peek.expectClosed()
  // Space over a row peeked; it did not open the row.
  await juno.expectNothingOpen()

  await rina.peek('option')
  // A peek shows on the key's next frame; give it a moment before checking that none came.
  await new Promise((done) => setTimeout(done, 300))
  await juno.peek.expectClosed()
  await juno.peek.release('option')

  // A text field with focus.
  const input = juno.win.document.createElement('input')
  input.setAttribute('aria-label', 'Stand-in composer')
  juno.win.document.body.append(input)
  const field = juno.win.getByRole('textbox', { name: 'Stand-in composer' })
  await field.focus()
  await rina.hover()
  await juno.win.keyboard.press('Space')
  await expect(field).toHaveValue(' ')
  await juno.peek.expectClosed()

  await rina.expectUnread(2)
  await slack.expectNoMarks()
})
