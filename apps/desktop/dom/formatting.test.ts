// Formatting in the composer (spec section 8): Slack's markup typed in the
// field goes to Slack as rich_text styles and a code block, the message
// shows them, the edit field shows them back as markup, and ⌘B wraps a
// selection in one edit that ⌘Z takes back. ⌘B and picked mentions edit
// through `execCommand`, so they, the cold formatting chunk and the caret in
// mixed-direction lines stay in the browser lane (`e2e/formatting.spec.ts`).
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'

interface Context {
  readonly juno: Juno
  readonly fake: FakeSlack
}

const select = (field: HTMLElement, start: number, end: number) => (field as HTMLTextAreaElement).setSelectionRange(start, end)

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

domTest('markup typed in the composer goes as Slack styles and a code block, shows styled, and edits as markup', ({ juno, fake }) => sendMarkup({ juno, fake }), { timeout: 120_000 })

async function sendMarkup({ juno, fake }: Context): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)

  await topic.composer.pressSequentially('*bold* _it_ `code`')
  await topic.composer.press('Shift+Enter')
  await juno.win.keyboard.insertText('```\nmake test\n```')
  await expect(topic.composer).toHaveValue('*bold* _it_ `code`\n```\nmake test\n```')
  await expect(juno.win.locator('[data-testid="textarea-bold"]')).toContainText('bold')
  await expect(juno.win.locator('[data-testid="textarea-code-block"]')).toHaveCount(3)
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

  // Edit the message for real; the untouched styles must survive the update.
  await topic.composer.press('ArrowUp')
  await expect(row).toBeFocused()
  await row.press('e')
  const field = topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(field).toHaveValue('*bold* _it_ `code`\n```\nmake test\n```')
  select(await field.element(), 0, 0)
  await field.pressSequentially('Updated: ')
  await field.press('Enter')
  await expect(field).toHaveCount(0)
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.update').length).toBe(1)
  const update = fake.calls.filter((call) => call.method === 'chat.update').at(-1)!
  const sent = lastPost([{ method: 'chat.postMessage', args: update.args }])
  expect(sent.elements).toEqual([
    { type: 'rich_text_section', elements: [{ type: 'text', text: 'Updated: ' },
      { type: 'text', text: 'bold', style: { bold: true } }, { type: 'text', text: ' ' },
      { type: 'text', text: 'it', style: { italic: true } }, { type: 'text', text: ' ' },
      { type: 'text', text: 'code', style: { code: true } }] },
    { type: 'rich_text_preformatted', border: 0, elements: [{ type: 'text', text: 'make test' }] },
  ])
}
