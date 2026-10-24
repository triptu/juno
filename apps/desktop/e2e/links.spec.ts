// Links (spec section 8): URLs sent from the composer show as links before
// and after Slack's echo, a URL pasted over selected words links them and
// goes to Slack as Slack's client sends it, a rich link pasted from another
// app keeps its label, ⌘K on a selection edits the
// link, and ⌘-click opens it in the browser (a plain click opens the web
// panel, web-panel.spec.ts).
import type { Locator } from '@playwright/test'
import { expect, test, type Fixtures } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'

type Json = Record<string, unknown>

/** A paste of `text`, as ⌘V gives the field. */
async function pasteText(field: Locator, text: string): Promise<void> {
  await field.evaluate((element, pasted) => {
    const data = new DataTransfer()
    data.setData('text/plain', pasted)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
}

/** A rich paste, with the plain fallback another app puts beside its HTML. */
async function pasteHtml(field: Locator, plain: string, html: string): Promise<void> {
  await field.evaluate((element, pasted) => {
    ;(element as HTMLTextAreaElement).focus()
    const data = new DataTransfer()
    data.setData('text/plain', pasted.plain)
    data.setData('text/html', pasted.html)
    const native = element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    // A synthetic paste has no browser default. Reproduce the textarea's ordinary plain-text fallback.
    if (native) document.execCommand('insertText', false, pasted.plain)
  }, { plain, html })
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

test('sends plain links, pastes linked words and edits links with the keyboard', async ({ juno, fake }) => {
  const context = { juno, fake }
  await test.step('URLs and domains sent from the composer show as links before and after the echo', () => sendPlainLinks(context))
  await test.step('a URL pasted over selected words links them, is sent as Slack sends it, and Undo gives the plain paste', () => pasteLinkedWords(context))
  await test.step('a rich link pasted from another app is sent and edited with its label and the URL', () => pasteRichLink(context))
  await test.step('⌘K on selected words edits their link', () => editLinkedWords(context))
})

async function pasteRichLink({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
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

async function sendPlainLinks({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
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

async function editLinkedWords({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)

  await topic.composer.fill('the plan is ready')
  await select(topic.composer, 'the plan')
  await juno.palette.shortcut()
  const editor = topic.linkEditor.root
  const url = topic.linkEditor.url
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

  // Esc closes the editor and leaves the link as it was.
  await select(topic.composer, 'the plan')
  await juno.palette.shortcut()
  await url.press('Escape')
  await expect(editor).toHaveCount(0)

  // ⌘K with nothing selected is still the palette.
  await topic.caretToEnd()
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
  await select(topic.composer, 'more')
  await juno.palette.shortcut()
  await topic.linkEditor.remove.click()
  await expect(topic.composerLinks).toHaveCount(0)
  await expect(topic.composer).toHaveValue('one more thing')
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
