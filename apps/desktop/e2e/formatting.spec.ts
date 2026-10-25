// Formatting in the composer (spec section 8), what needs a browser: ⌘B wraps
// a selection in one edit that ⌘Z takes back (the field's own undo), the
// caret in mixed-direction lines, and the cold formatting chunk. Markup sent
// as rich_text, and ⌘B and ⌘I around picked mentions and linked words, are in
// the DOM lane (`dom/formatting.test.ts`).
import { expect, test, type Fixtures } from './fixtures'
import { readUserDb } from './driver/userDb'

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

test('formats a selection with ⌘B that ⌘Z takes back, and aligns mixed-direction lines', async ({ juno }) => {
  const context = { juno }
  await test.step('⌘B wraps the selection in one edit, and ⌘Z takes it back', () => boldSelection(context))
  await test.step('Hebrew and mixed lines align the mirror with the native caret', () => alignMixedLines(context))
})

async function boldSelection({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
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

const posts = (fake: Fixtures['fake']) => fake.calls.filter((call) => call.method === 'chat.postMessage').length

async function alignMixedLines({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
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
}

const COLD_ACTIONS = ['selection', 'focus', 'composition', 'send', 'failed-send', 'twice', 'twice-other', 'mac-control', 'fallback'] as const

// Each step reloads the page with the formatting chunk held, so the step's keys land before the grammar loads.
test('a cold formatting chunk respects what the user did while it loaded', async ({ juno, fake, userData }) => {
  const drafts = () => readUserDb(userData, fake.teamId, (db) => db.prepare('SELECT COUNT(*) AS n FROM drafts').get()?.['n'])
  const draftsAtStart = drafts()
  for (const action of COLD_ACTIONS) {
    await test.step(`a cold formatting chunk respects ${action}`, async () => {
      let release!: () => void
      const held = new Promise<void>((resolve) => { release = resolve })
      const sending = action === 'send' || action === 'failed-send'
      // Each sending step posts its own word, so its message is the only one with it.
      const word = action === 'send' ? 'bold' : 'emphatic'
      await juno.win.route(action === 'fallback' ? /\/(?:markupRules|TextareaLines)-[^/]+\.js/ : /\/markupRules-[^/]+\.js/, async (route) => { if (action === 'failed-send') return route.abort(); await held; await route.continue() })
      try {
        await juno.win.reload({ waitUntil: 'domcontentloaded' })
        await juno.waitForSync()
        await juno.sidebar.row(POSTGRES).open()
        const field = juno.topic.composer
        const before = posts(fake)
        await field.fill(sending ? `*${word}*` : '*loaded* first second')
        await field.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(9, 14) })
        if (sending) {
          await field.press('Enter')
          await expect.poll(() => posts(fake)).toBe(before + 1)
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
          await juno.topic.expectSent(word)
          await expect(field).toHaveValue('next draft')
          expect(lastPost(fake.calls).elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'text', text: word, style: { bold: true } }] }])
        } else if (action === 'twice-other') await expect(field).toHaveValue('*loaded* *first* _second_')
        else if (action === 'twice') await expect(field).toHaveValue('*loaded* *_first_* second')
        else if (action === 'selection') await expect(field).toHaveValue('*loaded* *first* second')
        else if (action !== 'mac-control' && action !== 'fallback') {
          // The original bold run proves the grammar and drawing have both loaded.
          await field.focus()
          if (action === 'composition') await field.dispatchEvent('compositionend')
          await expect(juno.win.getByTestId('textarea-bold')).toHaveText('loaded')
          await expect(field).toHaveValue('*loaded* first second')
        }
        // The next step reloads into this topic: clear the draft and wait until it is stored, so it cannot come back.
        await field.fill('')
        await expect.poll(drafts).toBe(draftsAtStart)
      } finally {
        release()
        await juno.win.unrouteAll({ behavior: 'wait' })
      }
    })
  }
})
