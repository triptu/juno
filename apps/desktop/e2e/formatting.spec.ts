// Formatting in the composer (spec section 8): Slack's markup typed in the
// field goes to Slack as rich_text styles and a code block, the message
// shows them, the edit field shows them back as markup, and ⌘B wraps a
// selection in one edit that ⌘Z takes back.
import { expect, test, type Fixtures } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'

type Json = Record<string, unknown>

/**
 * The `rich_text` elements and the `text` of the last `chat.postMessage`.
 * The call goes as multipart form data, which writes a line break in a
 * field as CRLF, as Slack's own client's calls do.
 */
function lastPost(calls: ReadonlyArray<{ method: string; args: Json }>): { readonly elements: unknown; readonly text: unknown } {
  const posted = calls.filter((call) => call.method === 'chat.postMessage').at(-1)
  const blocks: unknown = typeof posted?.args['blocks'] === 'string' ? JSON.parse(posted.args['blocks']) : posted?.args['blocks']
  return { elements: (blocks as ReadonlyArray<{ elements: unknown }> | undefined)?.[0]?.elements, text: String(posted?.args['text']).replace(/\r\n/g, '\n') }
}

test('sends Slack markup as rich text styles and formats a selection with ⌘B', async ({ juno, fake }) => {
  const context = { juno, fake }
  await test.step('markup typed in the composer goes as Slack styles and a code block, shows styled, and edits as markup', () => sendMarkup(context))
  await test.step('⌘B wraps the selection in one edit, and ⌘Z takes it back', () => boldSelection(context))
})

async function sendMarkup({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)

  await topic.composer.pressSequentially('*bold* _it_ `code`')
  await topic.composer.press('Shift+Enter')
  await juno.win.keyboard.insertText('```\nmake test\n```')
  await expect(topic.composer).toHaveValue('*bold* _it_ `code`\n```\nmake test\n```')
  await topic.composer.press('Enter')
  await topic.expectSent('bold')

  expect(lastPost(fake.calls)).toEqual({
    elements: [
      {
        type: 'rich_text_section',
        elements: [
          { type: 'text', text: 'bold', style: { bold: true } },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'it', style: { italic: true } },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'code', style: { code: true } },
        ],
      },
      { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'make test' }], border: 0 },
    ],
    text: '*bold* _it_ `code`\n```make test```',
  })

  // The message draws the styles, without the markers.
  const row = topic.message('bold')
  const body = row.locator('[data-msg-text]')
  await expect(body.locator('strong')).toHaveText('bold')
  await expect(body.locator('em')).toHaveText('it')
  await expect(body.locator('code').filter({ hasText: /^code$/ })).toHaveCount(1)
  await expect(row.getByText('make test')).toBeVisible()
  await expect(body).not.toContainText('*')

  // Editing it starts with the markup the styles came from; saving it unchanged sends nothing.
  await topic.composer.press('ArrowUp')
  await expect(row).toBeFocused()
  await row.press('e')
  const field = topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(field).toHaveValue('*bold* _it_ `code`\n```\nmake test\n```')
  await field.press('Enter')
  await expect(field).toHaveCount(0)
  expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(0)
}

async function boldSelection({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const { topic } = juno
  await topic.composer.fill('ship it today')
  await topic.composer.evaluate((element: HTMLTextAreaElement) => {
    const at = element.value.indexOf('it')
    element.focus()
    element.setSelectionRange(at, at + 2)
  })
  await topic.composer.press('ControlOrMeta+b')
  await expect(topic.composer).toHaveValue('ship *it* today')
  // The words stay selected inside the markers, so ⌘B again takes them off.
  expect(await topic.composer.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('it')

  await juno.undo()
  await expect(topic.composer).toHaveValue('ship it today')
}
