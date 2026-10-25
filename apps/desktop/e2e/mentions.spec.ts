// @ in the composer (spec section 8, inventory 7.1), what needs a browser:
// the list sits above the field, and ⌘Z brings back a picked person that
// Backspace removed whole, through the field's own undo. Groups, channels,
// the arrows and Esc, drafts and Home's composer are in the DOM lane
// (`dom/mentions.test.ts`).
import { expect, test, type Fixtures } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'

const postedText = (fake: { readonly calls: ReadonlyArray<{ readonly method: string; readonly args: Record<string, unknown> }> }) =>
  fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => String(call.args['text']))

test('mention a person in a reply: Backspace removes it whole, ⌘Z brings it back, and it posts as <@U…> and shows as a mention', ({ juno, fake }) => mentionPerson({ juno, fake }))

async function mentionPerson({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)

  await topic.composer.pressSequentially('Thanks @ma')
  await expect(topic.suggestion('Maya')).toBeVisible()
  // The list sits above the composer, clear of the text being typed.
  const list = (await topic.suggestions.boundingBox())!
  const field = (await topic.composerField.boundingBox())!
  expect(list.y + list.height).toBeLessThanOrEqual(field.y)
  await expect(topic.composer).toHaveAttribute('aria-activedescendant', /.+/)

  await topic.composer.press('Enter')
  await expect(topic.suggestions).toHaveCount(0)
  await expect(topic.composer).toHaveValue('Thanks @Maya ')
  await expect(topic.composerChips).toHaveText(['@Maya'])
  await expect(topic.composerChips.first()).toHaveAttribute('data-mark', 'person')

  // Backspace into the picked name removes it whole, and ⌘Z brings it back, chip and all.
  await topic.composer.press('Backspace')
  await expect(topic.composer).toHaveValue('Thanks @Maya')
  await topic.composer.press('Backspace')
  await expect(topic.composer).toHaveValue('Thanks ')
  await expect(topic.composerChips).toHaveCount(0)
  await topic.composer.press('ControlOrMeta+z')
  await expect(topic.composer).toHaveValue('Thanks @Maya')
  await expect(topic.composerChips).toHaveText(['@Maya'])

  // Undo leaves the name it brought back selected, as native undo does; move past it.
  await topic.caretToEnd()
  await topic.composer.pressSequentially(' the plan works.')
  await topic.composer.press('Enter')
  await topic.expectSent('Thanks')
  expect(postedText(fake).at(-1)).toBe('Thanks <@U0MAYA> the plan works.')
  await expect(topic.message('Thanks').locator('[data-person="U0MAYA"]')).toHaveText('@Maya')
}
