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
  await expect(juno.win.getByTestId('textarea-bold')).toContainText(['bold'])
  await expect(juno.win.getByTestId('textarea-code-block')).toHaveCount(3)
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
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0))
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

for (const action of ['selection', 'focus', 'composition', 'send', 'failed-send', 'twice', 'twice-other', 'mac-control', 'fallback'] as const) {
  test(`a cold formatting chunk respects ${action}`, async ({ juno, fake }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const sending = action === 'send' || action === 'failed-send'
    await juno.win.route(action === 'fallback' ? /\/(?:markupRules|TextareaLines)-[^/]+\.js/ : /\/markupRules-[^/]+\.js/, async (route) => { if (action === 'failed-send') return route.abort(); await held; await route.continue() })
    try {
      await juno.win.reload({ waitUntil: 'domcontentloaded' })
      await juno.waitForSync()
      await juno.sidebar.row(POSTGRES).open()
      const field = juno.topic.composer
      await field.fill(sending ? '*bold*' : '*loaded* first second')
      await field.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(9, 14) })
      if (sending) {
        await field.press('Enter')
        await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').length).toBe(1)
        await field.fill('next draft')
      } else if (action === 'mac-control') {
        const taken = await field.evaluate((el) => {
          if (!navigator.platform.startsWith('Mac')) return false
          return !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true, cancelable: true }))
        })
        expect(taken).toBe(false)
      } else if (action === 'fallback') {
        await field.fill('hello\nשלום')
        const layer = juno.win.locator('[data-textarea-layer]')
        await expect(layer).toHaveCSS('unicode-bidi', 'plaintext')
        expect(await layer.evaluate((el) => {
          const range = document.createRange()
          range.setStart(el.firstChild!, 6)
          range.setEnd(el.firstChild!, 7)
          const box = range.getBoundingClientRect()
          const caret = document.caretPositionFromPoint(box.x + box.width * 0.75, box.y + box.height / 2)?.offset
          return caret === 6 || caret === 7
        })).toBe(true)
      } else {
        await field.press('ControlOrMeta+b')
        if (action === 'twice-other') await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(15, 21))
        if (action === 'twice' || action === 'twice-other') await field.press('ControlOrMeta+i')
        if (action === 'selection') await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(15, 21))
        if (action === 'focus') await field.evaluate((el: HTMLTextAreaElement) => el.blur())
        if (action === 'composition') await field.dispatchEvent('compositionstart', { data: 'あ' })
      }
      release()
      if (sending) {
        await juno.topic.expectSent('bold')
        await expect(field).toHaveValue('next draft')
        expect(lastPost(fake.calls).elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'text', text: 'bold', style: { bold: true } }] }])
      } else if (action === 'twice-other') await expect(field).toHaveValue('*loaded* *first* _second_')
      else if (action === 'twice') await expect(field).toHaveValue('*loaded* *_first_* second')
      else if (action === 'mac-control' || action === 'fallback') return
      else if (action === 'selection') await expect(field).toHaveValue('*loaded* *first* second')
      else {
        // The original bold run proves the grammar and drawing have both loaded.
        await field.focus()
        if (action === 'composition') await field.dispatchEvent('compositionend')
        await expect(juno.win.getByTestId('textarea-bold')).toHaveText('loaded')
        await expect(field).toHaveValue('*loaded* first second')
      }
    } finally {
      release()
      await juno.win.unrouteAll({ behavior: 'wait' })
    }
  })
}

test('Hebrew and mixed lines align the mirror with the native caret in Electron', async ({ juno }) => {
  await juno.sidebar.row(POSTGRES).open()
  for (const text of ['שלום', 'שלום hello עולם', 'hello שלום world', 'hello\nשלום', 'שלום\nhello']) {
    await juno.topic.composer.fill(text)
    const layer = juno.win.locator('[data-textarea-layer]')
    await expect(layer).toHaveText(text.replace(/\n/g, ''))
    const aligned = await layer.evaluate((element) => {
      let start = 0
      return Array.from(element.children).every((line) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        const node = walker.nextNode()!
        const range = document.createRange()
        range.setStart(node, 0)
        range.setEnd(node, 1)
        const box = range.getBoundingClientRect()
        const caret = document.caretPositionFromPoint(box.x + box.width * 0.75, box.y + box.height / 2)?.offset
        const matches = caret === start || caret === start + 1
        start += (line.textContent?.length ?? 0) + 1
        return matches
      })
    })
    expect(aligned).toBe(true)
  }
})

test('formatting keeps picked mentions and linked words', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.composer.pressSequentially('@ma')
  await expect(topic.suggestion('Maya')).toBeVisible()
  await topic.composer.press('Enter')
  await topic.composer.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 4))
  await topic.composer.press('ControlOrMeta+i')
  await expect(topic.composer).toHaveValue('_@Maya_ ')
  await expect(topic.composerChips).toHaveText(['@Maya'])
  await topic.composer.press('Enter')
  await topic.expectSent('Maya')
  expect(lastPost(fake.calls).elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'user', user_id: 'U0MAYA', style: { italic: true } }] }])

  await topic.composer.fill('plan')
  await topic.composer.evaluate((el: HTMLTextAreaElement) => el.select())
  await topic.composer.evaluate((el) => {
    const data = new DataTransfer()
    data.setData('text/plain', 'https://example.com/plan')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await topic.composer.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 4))
  await topic.composer.press('ControlOrMeta+b')
  await expect(topic.composerLinks).toHaveText('plan')
  await topic.composer.press('Enter')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').length).toBe(2)
  expect(lastPost(fake.calls).elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'link', text: 'plan', url: 'https://example.com/plan', style: { bold: true } }] }])
})


test('inline edit formatting expands partial mentions and links', async ({ juno, fake }) => {
  await juno.sidebar.row(POSTGRES).open()
  const composer = juno.topic.composer
  await composer.pressSequentially('@ma')
  await expect(juno.topic.suggestion('Maya')).toBeVisible()
  await composer.press('Enter')
  await composer.pressSequentially('plan')
  await composer.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 10))
  await composer.evaluate((el) => {
    const data = new DataTransfer()
    data.setData('text/plain', 'https://example.com/plan')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await composer.press('Enter')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.postMessage').length).toBe(1)
  await juno.topic.expectSent('Maya')
  await composer.press('ArrowUp')
  await juno.topic.message('Maya').press('e')
  const field = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(field).toHaveValue('@Maya plan')
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 4))
  await field.press('ControlOrMeta+i')
  await expect(field).toHaveValue('_@Maya_ plan')
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(9, 10))
  await field.press('ControlOrMeta+b')
  await expect(field).toHaveValue('_@Maya_ *plan*')
  await field.press('Enter')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.update').length).toBe(1)
  const update = fake.calls.find((call) => call.method === 'chat.update')!
  expect(lastPost([{ method: 'chat.postMessage', args: update.args }]).elements).toEqual([{ type: 'rich_text_section', elements: [
    { type: 'user', user_id: 'U0MAYA', style: { italic: true } }, { type: 'text', text: ' ' },
    { type: 'link', text: 'plan', url: 'https://example.com/plan', style: { bold: true } },
  ] }])
})
