// The topic composer in the browser, as one journey from a synced start: what needs the field's own editing, its
// layout or Chromium's focus. A reply shows at once and settles in place, posted once, and the composer grows to
// about eight lines, then scrolls inside (spec section 8). A picked person goes whole with Backspace and comes back
// with ⌘Z, the field's own undo, and the @ list sits above the field. ⌘B wraps a selection in one edit that ⌘Z takes
// back, and the caret lines up in mixed-direction lines. A URL pasted over selected words links them, ⌘Z gives the
// plain paste and ⌘-click on the words opens them. ↑ on the draft's first visual line selects the newest message
// (SPEC section 7, Keyboard), Esc the hovered one. The inline edit field's emoji list shows whole in the window.
// The DOM lane has the rest: Main's echo before the answer, a refused send and drafts (`dom/send.test.ts`), groups,
// channels and the list keys (`dom/mentions.test.ts`), markup sent as rich text (`dom/formatting.test.ts`), links
// sent, pasted from another app and edited with ⌘K (`dom/strict-links.test.ts`), and colon emoji picks
// (`dom/emoji-colon.test.ts`). A cold formatting chunk is formatting.spec.ts's.
import type { Locator } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import { measureLayoutShift } from '@juno/testing/layout-shift'
import type { Juno } from './driver/juno'
import { expect, test, type Fixtures } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const POSTGRES = 'Draft plan is in the doc'

type Json = Record<string, unknown>

const postedText = (fake: { readonly calls: ReadonlyArray<{ readonly method: string; readonly args: Record<string, unknown> }> }) =>
  fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => String(call.args['text']))

test('the topic composer: a reply settles in place and the field grows; a mention goes whole and ⌘Z brings it back; ⌘B and ⌘Z; mixed-direction lines; linked words; ↑ and Esc; the edit field\'s emoji list', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.expectAtBottom()
  await test.step('a reply in a thread shows at once and settles in place, posted once', () => sendReply(juno, fake))
  await test.step('the composer grows to about half the topic’s height, then scrolls inside, and Shift Enter adds a line', () => composerGrowth(juno, fake))
  await topic.composer.fill('')
  await test.step('mention a person in a reply: Backspace removes it whole, ⌘Z brings it back, and it posts as <@U…> and shows as a mention', () => mentionPerson({ juno, fake }))
  await test.step('⌘B wraps the selection in one edit, and ⌘Z takes it back', () => boldSelection({ juno }))
  await test.step('Hebrew and mixed lines align the mirror with the native caret', () => alignMixedLines({ juno }))
  await topic.composer.fill('')
  await test.step('a URL pasted over selected words links them, is sent as Slack sends it, and Undo gives the plain paste', () => pasteLinkedWords({ juno, fake }))
  await test.step('↑ from the composer: on the draft\'s first visual line it selects the newest message, and ↓ comes back', () => upAndEsc({ juno, fake }))
  await test.step('Esc from the composer selects the hovered message, else the newest, and keys act on a hovered message', () => escAndKeys({ juno }))
  await test.step('the inline edit field\'s emoji list shows whole in the window', async () => {
    // The step before left an edit field open.
    await juno.win.keyboard.press('Escape')
    await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveCount(0)
    await topic.send('Edit with emoji')
    await topic.expectSent('Edit with emoji')
    await topic.chooseInMessageMenu('Edit with emoji', 'edit')
    const edit = topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(edit).toBeFocused()
    await edit.pressSequentially(' :tad')
    const list = juno.win.getByRole('listbox', { name: 'Emoji' })
    await expect(list).toBeVisible()
    await expect(list).toBeInViewport({ ratio: 1 })
  })
})

async function sendReply(juno: Fixtures['juno'], fake: Fixtures['fake']): Promise<void> {
  const { topic } = juno

  // The answer waits, so the pending row is on screen until it is released.
  fake.holdNext({ method: 'chat.postMessage', before: true })
  // The field can mount again between a visibility check and a box read, so wait for a box.
  let field: Awaited<ReturnType<typeof topic.composerField.boundingBox>> = null
  await expect.poll(async () => (field = await topic.composerField.boundingBox())).not.toBeNull()
  await topic.send('Thursday works for the freeze')
  await expect(topic.message('Thursday works for the freeze')).toHaveAttribute('data-pending', 'sending')
  await expect(topic.composer).toHaveValue('')
  expect(await topic.composerField.boundingBox()).toEqual(field)
  await topic.expectAtBottom()

  const row = topic.message('Thursday works for the freeze')
  const before = await row.boundingBox()
  // The sidebar moves the thread to the top for its new activity, as it should; the topic moves nothing.
  const report = await measureLayoutShift(
    juno.win,
    async () => {
      fake.release()
      await topic.expectSent('Thursday works for the freeze')
    },
    { root: '[data-topic-view]', settleMs: 200 },
  )
  // No message row moved. The list's own height may change as rows far above the view reach their real
  // size (they are laid out at an estimate until then), and the browser's shift entries cover the whole window.
  expect(report.moved.filter((moved) => moved.element.includes('listitem'))).toEqual([])
  expect(await topic.message('Thursday works for the freeze').boundingBox()).toEqual(before)

  const posted = fake.calls.filter((call) => call.method === 'chat.postMessage')
  expect(posted).toHaveLength(1)
  expect(posted[0]!.args['thread_ts']).toBeDefined()
  const copies = fake.messages(String(posted[0]!.args['channel'])).filter((m) => m.client_msg_id === posted[0]!.args['client_msg_id'])
  expect(copies).toHaveLength(1)
}

async function composerGrowth(juno: Fixtures['juno'], fake: Fixtures['fake']): Promise<void> {
  const { topic } = juno
  const posts = () => fake.calls.filter((call) => call.method === 'chat.postMessage').length
  const postedBefore = posts()
  const one = (await topic.composer.boundingBox())!.height
  await topic.composer.fill('one\ntwo\nthree')
  const three = (await topic.composer.boundingBox())!.height
  expect(three).toBeGreaterThan(one)
  // A long message grows the field to about half the topic's height, never under 8 lines, then it scrolls inside.
  await topic.composer.fill(Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n'))
  const capped = (await topic.composer.boundingBox())!.height
  const pane = await topic.composer.evaluate((field) => field.closest('[data-topic-view]')!.getBoundingClientRect().height)
  expect(capped).toBeGreaterThan(194)
  expect(capped).toBeGreaterThan(pane * 0.4)
  expect(capped).toBeLessThanOrEqual(pane * 0.5)
  expect(await topic.composer.evaluate((field) => field.scrollHeight > field.clientHeight)).toBe(true)
  // Shift Enter adds a line, it does not send.
  await topic.composer.fill('first line')
  await topic.composer.press('Shift+Enter')
  await topic.composer.pressSequentially('second line')
  await expect(topic.composer).toHaveValue('first line\nsecond line')
  expect(posts()).toBe(postedBefore)
}

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

/** A paste of `text`, as ⌘V gives the field. */
async function pasteText(field: Locator, text: string): Promise<void> {
  await field.evaluate((element, pasted) => {
    const data = new DataTransfer()
    data.setData('text/plain', pasted)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
}

/** Selects `words` in the composer, as a drag over them would. */
async function select(field: Locator, words: string): Promise<void> {
  await field.evaluate((element, wanted) => {
    const textarea = element as HTMLTextAreaElement
    const at = textarea.value.indexOf(wanted)
    textarea.focus()
    textarea.setSelectionRange(at, at + wanted.length)
  }, words)
}

/** The `link` elements of the last `chat.postMessage`. */
function postedLinks(calls: ReadonlyArray<{ method: string; args: Json }>): Array<Json> {
  const posted = calls.filter((call) => call.method === 'chat.postMessage').at(-1)
  const blocks: unknown = typeof posted?.args['blocks'] === 'string' ? JSON.parse(posted.args['blocks']) : posted?.args['blocks']
  const found: Array<Json> = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk)
    else if (node !== null && typeof node === 'object') {
      if ((node as Json)['type'] === 'link') found.push(node as Json)
      Object.values(node).forEach(walk)
    }
  }
  walk(blocks)
  return found
}

async function pasteLinkedWords({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  const priorLinks = (await juno.browserLinks()).length
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)

  await topic.composer.fill('read the docs first')
  await select(topic.composer, 'the docs')
  await pasteText(topic.composer, 'https://example.com/docs')
  await expect(topic.composer).toHaveValue('read the docs first')
  await expect(topic.composerLinks).toHaveText('the docs')

  // Undo first takes the words back to the plain paste, which is a link as it stands.
  await juno.undo()
  await expect(topic.composer).toHaveValue('read https://example.com/docs first')
  await expect(topic.composerLinks).toHaveText('https://example.com/docs')
  await juno.undo()
  await expect(topic.composer).toHaveValue('read the docs first')

  await select(topic.composer, 'the docs')
  await pasteText(topic.composer, 'https://example.com/docs')
  await expect(topic.composerLinks).toHaveText('the docs')
  // A paste with no selection is the browser's own: the URL goes in as text, shown as a link.
  await topic.caretToEnd()
  await juno.win.keyboard.insertText(' or example.org')
  await expect(topic.composer).toHaveValue('read the docs first or example.org')
  await expect(topic.composerLinks).toHaveText(['the docs', 'example.org'])

  // ⌘-click on linked words opens them.
  await topic.composer.click({ modifiers: ['Meta'], position: await textPoint(topic.composer, 'docs') })
  await expect.poll(async () => (await juno.browserLinks()).slice(priorLinks)).toEqual(['https://example.com/docs'])

  await topic.composer.press('Enter')
  await topic.expectSent('read the docs first')
  expect(postedLinks(fake.calls)).toEqual([
    { type: 'link', url: 'https://example.com/docs', text: 'the docs' },
    { type: 'link', url: 'http://example.org', text: 'example.org' },
  ])
  const posted = fake.calls.filter((call) => call.method === 'chat.postMessage').at(-1)
  expect(posted?.args['text']).toBe('read <https://example.com/docs|the docs> first or <http://example.org|example.org>')
  const link = topic.message('read the docs first').locator('[data-msg-text] a').first()
  await expect(link).toHaveText('the docs')
  await expect(link).toHaveAttribute('title', 'https://example.com/docs')
}

/** The point in the field over the middle of `words`, measured on the layer that draws its text. */
async function textPoint(field: Locator, words: string): Promise<{ x: number; y: number }> {
  return field.evaluate((element, wanted) => {
    const layer = element.parentElement?.querySelector('[data-textarea-layer]')
    const mark = [...(layer?.querySelectorAll('[data-mark="link"]') ?? [])].find((span) => span.textContent?.includes(wanted))
    const box = element.getBoundingClientRect()
    const at = mark?.getBoundingClientRect() ?? box
    return { x: at.left + at.width / 2 - box.left, y: at.top + at.height / 2 - box.top }
  }, words)
}

const NEWEST = 'Looking at the replica lag now'
const HOVERED = 'Hover target for Esc'

/** Opens #eng's Main and sends two messages, so the newest is known and another can be hovered. */
async function openMain(juno: Juno, fake: FakeSlack): Promise<void> {
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  for (const text of [HOVERED, NEWEST]) {
    await juno.topic.send(text)
    await juno.topic.expectSent(text)
  }
  await expect.poll(() => fake.messages('C0ENG').some((m) => m.text === NEWEST)).toBe(true)
}

const caretOf = (field: Locator) => field.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])
const putCaret = (field: Locator, at: number) => field.evaluate((el: HTMLTextAreaElement, to) => el.setSelectionRange(to, to), at)

async function upAndEsc({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  await openMain(juno, fake)
  const { topic, win } = juno
  const newest = topic.message(NEWEST)

  await test.step('two lines, caret on the second: ↑ moves the caret, ↑ again selects, ↓ comes back', async () => {
    const draft = 'first line\nsecond line'
    await topic.composer.fill(draft)
    await putCaret(topic.composer, draft.length)
    await topic.composer.press('ArrowUp')
    await expect(topic.composer).toBeFocused()
    const [at] = await caretOf(topic.composer)
    expect(at).toBeLessThanOrEqual(draft.indexOf('\n'))
    await topic.composer.press('ArrowUp')
    await expect(newest).toBeFocused()
    await win.keyboard.press('ArrowDown')
    await expect(topic.composer).toBeFocused()
    await expect(topic.composer).toHaveValue(draft)
    await expect.poll(() => caretOf(topic.composer)).toEqual([at, at])
  })

  await test.step('a first paragraph that wraps: ↑ from its last visual line moves the caret, from its first it selects', async () => {
    const draft = 'a long first paragraph that wraps '.repeat(8).trim()
    await topic.composer.fill(draft)
    await putCaret(topic.composer, draft.length)
    await topic.composer.press('ArrowUp')
    await expect(topic.composer).toBeFocused()
    expect((await caretOf(topic.composer))[0]).toBeLessThan(draft.length)
    await putCaret(topic.composer, 3)
    await topic.composer.press('ArrowUp')
    await expect(newest).toBeFocused()
    await win.keyboard.press('ArrowDown')
    await expect(topic.composer).toHaveValue(draft)
  })

  await test.step('Shift ↑ on the first line selects text and stays in the composer', async () => {
    await topic.composer.fill('one line')
    await putCaret(topic.composer, 4)
    await topic.composer.press('Shift+ArrowUp')
    await expect(topic.composer).toBeFocused()
    expect(await caretOf(topic.composer)).toEqual([0, 4])
  })

  await test.step('with the @ suggestions open, ↑ moves in the list', async () => {
    await topic.composer.fill('')
    await topic.composer.pressSequentially('@')
    await expect(topic.suggestions.getByRole('option').nth(1)).toBeVisible()
    await expect(topic.composer).toHaveAttribute('aria-activedescendant', /.+/)
    const before = (await topic.composer.getAttribute('aria-activedescendant'))!
    await topic.composer.press('ArrowUp')
    await expect(topic.composer).toBeFocused()
    await expect(topic.suggestions).toBeVisible()
    await expect(topic.composer).not.toHaveAttribute('aria-activedescendant', before)
  })

}

/** #eng's Main is open from the step before, with its two messages sent. */
async function escAndKeys({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const { topic, win } = juno
  const editField = topic.list.getByRole('textbox', { name: 'Edit message' })

  await test.step('hovered: Esc selects it, and E edits it', async () => {
    // Empty, so Esc is not taken by the @ suggestions the step above opened.
    await topic.composer.fill('')
    await expect(topic.suggestions).toBeHidden()
    await topic.composer.focus()
    await topic.message(HOVERED).hover()
    await topic.composer.press('Escape')
    await expect(topic.message(HOVERED)).toBeFocused()
    await win.keyboard.press('e')
    await expect(editField).toHaveValue(HOVERED)
    await editField.press('Escape')
    await expect(topic.composer).toBeFocused()
  })

  await test.step('nothing hovered: Esc selects the newest message', async () => {
    await topic.composer.hover()
    await topic.composer.press('Escape')
    await expect(topic.message(NEWEST)).toBeFocused()
  })

  await test.step('focus on no row or field: E edits the message under the pointer', async () => {
    await topic.message(NEWEST).evaluate((row: HTMLElement) => row.blur())
    await topic.message(HOVERED).hover()
    await win.keyboard.press('e')
    await expect(editField).toHaveValue(HOVERED)
  })
}
