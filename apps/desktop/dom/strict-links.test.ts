// Links (spec section 8), what goes to Slack: URLs and domains sent from the composer show as links before and
// after Slack's echo and post as Slack's client posts them, ⌘-click opens one in the browser, a rich link pasted
// from another app keeps its label and style in a send and an edit, and ⌘K on selected words edits their link. A URL
// pasted over selected words, which ⌘Z turns back into the plain paste, stays in the browser lane
// (`e2e/composer.spec.ts`), since the field's own undo is Chromium's.
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import type { Query } from './query'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'

type Json = Record<string, unknown>

interface Context {
  readonly juno: Juno
  readonly fake: FakeSlack
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

type PageGlobals = { DataTransfer: typeof DataTransfer; ClipboardEvent: typeof ClipboardEvent }

/** A rich paste, with the plain fallback another app puts beside its HTML. */
async function pasteHtml(field: Query, plain: string, html: string): Promise<void> {
  const element = (await field.element()) as HTMLTextAreaElement
  const page = field.dom.window as unknown as PageGlobals
  element.focus()
  const data = new page.DataTransfer()
  data.setData('text/plain', plain)
  data.setData('text/html', html)
  const native = element.dispatchEvent(new page.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  // A synthetic paste has no browser default. Reproduce the textarea's ordinary plain-text fallback.
  if (native) element.ownerDocument.execCommand('insertText', false, plain)
}

/** Selects `words` in the field, as a drag over them would. */
async function select(field: Query, words: string): Promise<void> {
  const element = (await field.element()) as HTMLTextAreaElement
  const at = element.value.indexOf(words)
  element.focus()
  element.setSelectionRange(at, at + words.length)
}

async function caretToEnd(field: Query): Promise<void> {
  const element = (await field.element()) as HTMLTextAreaElement
  element.focus()
  element.setSelectionRange(element.value.length, element.value.length)
}

domTest('links: URLs and domains post as Slack posts them, ⌘-click opens one, a rich paste keeps its label in a send and an edit, and ⌘K edits linked words', async ({ juno, fake, step }) => {
  await step('URLs and domains sent from the composer show as links before and after the echo', () => sendPlainLinks({ juno, fake }))
  await step('a rich link pasted from another app is sent and edited with its label and the URL', () => pasteRichLink({ juno, fake }))
  await step('⌘K on selected words edits their link', () => editLinkedWords({ juno, fake }))
})

async function sendPlainLinks({ juno, fake }: Context): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  const text = 'see example.com and https://slack.com/help'
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await topic.send(text)
  const row = topic.message('see example.com')
  await expect(row).toHaveAttribute('data-pending', 'sending')
  const links = row.locator('[data-msg-text] a')
  await expect(links).toHaveText(['example.com', 'https://slack.com/help'])
  await expect(links.first()).toHaveAttribute('href', 'http://example.com')

  fake.release()
  await topic.expectSent('see example.com')
  await expect(links).toHaveText(['example.com', 'https://slack.com/help'])
  expect(postedLinks(fake.calls)).toEqual([
    { type: 'link', url: 'http://example.com', text: 'example.com' },
    { type: 'link', url: 'https://slack.com/help' },
  ])
  const posted = fake.calls.filter((call) => call.method === 'chat.postMessage').at(-1)
  expect(posted?.args['text']).toBe('see <http://example.com|example.com> and <https://slack.com/help>')

  // ⌘-click opens the link in the browser, with the URL on hover.
  await expect(links.last()).toHaveAttribute('title', 'https://slack.com/help')
  await links.last().click({ modifiers: ['Meta'] })
  await expect.poll(() => juno.browserLinks()).toEqual(['https://slack.com/help'])
}

async function pasteRichLink({ juno, fake }: Context): Promise<void> {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)

  await pasteHtml(
    juno.topic.composer,
    'Read the deployment guide before launch',
    '<p>Read the <a href="https://example.com/deploy"><strong>deployment guide</strong></a> before launch</p>',
  )
  await expect(juno.topic.composer).toHaveValue('Read the *deployment guide* before launch')
  await juno.topic.composer.press('Enter')
  await juno.topic.expectSent('Read the deployment guide before launch')

  expect(postedLinks(fake.calls)).toEqual([{ type: 'link', url: 'https://example.com/deploy', text: 'deployment guide', style: { bold: true } }])

  await juno.topic.composer.press('ArrowUp')
  await juno.topic.message('Read the deployment guide before launch').press('e')
  const edit = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(edit).toBeFocused()
  await edit.fill('')
  await pasteHtml(edit, 'See release notes', '<div>See <a href="https://example.com/release"><em>release notes</em></a></div>')
  await expect(edit).toHaveValue('See _release notes_')
  await edit.press('Enter')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.update').length).toBe(1)
  const update = fake.calls.find((call) => call.method === 'chat.update')
  expect(postedLinks(update === undefined ? [] : [{ method: 'chat.postMessage', args: update.args }])).toEqual([
    { type: 'link', url: 'https://example.com/release', text: 'release notes', style: { italic: true } },
  ])
}

async function editLinkedWords({ juno, fake }: Context): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  const editor = topic.root.locator('[data-link-editor]')
  const url = editor.getByRole('textbox', { name: 'Link' })

  await topic.composer.fill('the plan is ready')
  await select(topic.composer, 'the plan')
  await juno.palette.shortcut()
  await expect(url).toBeFocused()
  await expect(juno.palette.root).toHaveCount(0)
  // Not a link: the editor stays open.
  await url.fill('not a link')
  await url.press('Enter')
  await expect(url).toHaveAttribute('aria-invalid', 'true')
  await url.fill('https://example.com/plan')
  await url.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect(topic.composer).toBeFocused()
  await expect(topic.composerLinks).toHaveText('the plan')

  // Again on the same words: the editor shows the link, and a new one replaces it.
  await select(topic.composer, 'the plan')
  await juno.palette.shortcut()
  await expect(url).toHaveValue('https://example.com/plan')
  await url.fill('example.com/plan-2')
  await url.press('Enter')
  await expect(editor).toHaveCount(0)

  // Esc closes the editor and leaves the link as it was.
  await select(topic.composer, 'the plan')
  await juno.palette.shortcut()
  await expect(url).toBeFocused()
  await url.press('Escape')
  await expect(editor).toHaveCount(0)

  // ⌘K with nothing selected is still the palette.
  await caretToEnd(topic.composer)
  await juno.palette.open()
  await juno.palette.input.press('Escape')

  await topic.composer.press('Enter')
  await topic.expectSent('the plan is ready')
  expect(postedLinks(fake.calls)).toEqual([{ type: 'link', url: 'http://example.com/plan-2', text: 'the plan' }])

  // Remove takes a link off and keeps the words.
  await topic.composer.fill('one more thing')
  await select(topic.composer, 'more')
  await juno.palette.shortcut()
  await url.fill('https://example.com')
  await url.press('Enter')
  await expect(editor).toHaveCount(0)
  await select(topic.composer, 'more')
  await juno.palette.shortcut()
  await editor.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(topic.composerLinks).toHaveCount(0)
  await expect(topic.composer).toHaveValue('one more thing')
}
