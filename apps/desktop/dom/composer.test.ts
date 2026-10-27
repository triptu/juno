// The composer (spec section 8, inventory 7.1): Slack's markup typed in the field goes to Slack as
// rich_text styles and a code block, shows styled, and edits as markup; ⌘B and ⌘I keep picked
// mentions and linked words, in the composer and the inline edit; @ and # suggest people, user
// groups and channels and send real Slack mentions and channel links; Esc keeps the typed text; a
// draft keeps its mentions; Home suggests too; and colon emoji insert Unicode. Which emoji and
// people match, and in what order, are domain rules (packages/domain/test/composer-*.test.ts). ⌘Z
// after an edit the app made, a picked person's Backspace and where the lists sit stay in the
// browser lane (`e2e/composer.spec.ts`, `e2e/formatting.spec.ts`).
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'

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

/** ⌘V with `text` on the clipboard, into `field`. */
function pasteText(juno: Juno, field: HTMLElement, text: string): void {
  const page = juno.win.window as unknown as typeof globalThis
  const data = new page.DataTransfer()
  data.setData('text/plain', text)
  field.dispatchEvent(new page.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
}

const posts = (fake: FakeSlack) => fake.calls.filter((call) => call.method === 'chat.postMessage').length
const updates = (fake: FakeSlack) => fake.calls.filter((call) => call.method === 'chat.update')
const postedText = (fake: FakeSlack) => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => String(call.args['text']))

// One launch: each step opens the topic it types in.
domTest('markup, formatting, mentions, channel links and colon emoji go to Slack as Slack sends them, in topics, edits and Home', async ({ juno, fake, step }) => {
  const context = { juno, fake }
  await step('markup typed in the composer goes as Slack styles and a code block, shows styled, and edits as markup', () => sendMarkup(context))
  await step('formatting keeps picked mentions and linked words', () => formatMentionsAndLinks(context))
  await step('inline edit formatting expands partial mentions and links', () => formatInEdit(context))
  await step('a user group is suggested after the people who match, and posts as Slack sends a group mention', () => mentionGroup(context))
  await step('link a channel with #, picked with Tab', () => linkChannel(context))
  await step('Esc closes the list and keeps the text', () => navigateMentions(context))
  await step('a draft keeps its mentions across topic switches', () => keepMentionDraft(context))
  await step('Home suggests people and channels inside a question for Juno and once a person or channel is chosen', () => homeSuggestions(context))
  await step('colon suggestions insert Unicode and send it; Esc keeps the colon text and a closing colon converts it', () => colonEmoji(context))
})

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

async function formatMentionsAndLinks({ juno, fake }: Context): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.composer.fill('')
  const before = posts(fake)
  await topic.composer.pressSequentially('@ma')
  // The list for "@ma", not the one for "@m" still on screen.
  await expect(topic.suggestions.getByRole('option').first()).toHaveAccessibleName(/^Maya/)
  await topic.composer.press('Enter')
  select(await topic.composer.element(), 2, 4)
  await topic.composer.press('Meta+i')
  await expect(topic.composer).toHaveValue('_@Maya_ ')
  await expect(topic.composerChips).toHaveText(['@Maya'])
  await topic.composer.press('Enter')
  await topic.expectSent('Maya')
  expect(lastPost(fake.calls).elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'user', user_id: 'U0MAYA', style: { italic: true } }] }])

  await topic.composer.fill('plan')
  select(await topic.composer.element(), 0, 4)
  pasteText(juno, await topic.composer.element(), 'https://example.com/plan')
  select(await topic.composer.element(), 0, 4)
  await topic.composer.press('Meta+b')
  await expect(topic.composerLinks).toHaveText('plan')
  await topic.composer.press('Enter')
  await expect.poll(() => posts(fake)).toBe(before + 2)
  expect(lastPost(fake.calls).elements).toEqual([{ type: 'rich_text_section', elements: [{ type: 'link', text: 'plan', url: 'https://example.com/plan', style: { bold: true } }] }])
}

async function formatInEdit({ juno, fake }: Context): Promise<void> {
  const composer = juno.topic.composer
  const before = { posts: posts(fake), updates: updates(fake).length }
  await composer.pressSequentially('@ma')
  await expect(juno.topic.suggestions.getByRole('option').first()).toHaveAccessibleName(/^Maya/)
  await composer.press('Enter')
  await composer.pressSequentially('plan')
  select(await composer.element(), 6, 10)
  pasteText(juno, await composer.element(), 'https://example.com/plan')
  await composer.press('Enter')
  await expect.poll(() => posts(fake)).toBe(before.posts + 1)
  await juno.topic.expectSent('Maya plan')
  await composer.press('ArrowUp')
  await juno.topic.message('Maya plan').press('e')
  const field = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(field).toHaveValue('@Maya plan')
  select(await field.element(), 2, 4)
  await field.press('Meta+i')
  await expect(field).toHaveValue('_@Maya_ plan')
  select(await field.element(), 9, 10)
  await field.press('Meta+b')
  await expect(field).toHaveValue('_@Maya_ *plan*')
  await field.press('Enter')
  await expect.poll(() => updates(fake).length).toBe(before.updates + 1)
  const update = updates(fake).at(-1)!
  expect(lastPost([{ method: 'chat.postMessage', args: update.args }]).elements).toEqual([{ type: 'rich_text_section', elements: [
    { type: 'user', user_id: 'U0MAYA', style: { italic: true } }, { type: 'text', text: ' ' },
    { type: 'link', text: 'plan', url: 'https://example.com/plan', style: { bold: true } },
  ] }])
}

async function mentionGroup({ juno, fake }: Context): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  // A bare "@" lists people only.
  await topic.composer.pressSequentially('Heads up @')
  await expect(topic.suggestions.getByRole('option').first()).toBeVisible()
  await expect(topic.suggestion('@platform')).toHaveCount(0)

  await topic.composer.pressSequentially('p')
  await expect(topic.suggestion('@platform')).toBeVisible()
  const options = topic.suggestions.getByRole('option')
  await expect(options).not.toHaveCount(1)
  await expect(options.last()).toHaveAccessibleName(/^@platform Platform team/)
  await expect(topic.suggestions).toContainText('Groups')

  await topic.composer.pressSequentially('lat')
  await expect(options).toHaveCount(1)
  await topic.composer.press('Enter')
  await expect(topic.composer).toHaveValue('Heads up @platform ')
  await expect(topic.composerChips).toHaveText(['@platform'])

  await topic.composer.pressSequentially('the cutover is tonight.')
  await topic.composer.press('Enter')
  await topic.expectSent('Heads up')
  expect(postedText(fake).at(-1)).toBe('Heads up <!subteam^S0PLATFORM> the cutover is tonight.')
  const post = fake.calls.filter((call) => call.method === 'chat.postMessage').at(-1)!
  const blocks = post.args['blocks']
  expect(typeof blocks === 'string' ? blocks : JSON.stringify(blocks)).toContain('{"type":"usergroup","usergroup_id":"S0PLATFORM"}')
  await expect(topic.message('Heads up').locator('[data-usergroup="S0PLATFORM"]')).toHaveText('@platform')
}

async function linkChannel({ juno, fake }: Context): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await topic.composer.pressSequentially('Notes are in #plat')
  await expect(topic.suggestion('platform')).toBeVisible()
  await topic.composer.press('Tab')
  await expect(topic.composer).toHaveValue('Notes are in #platform ')
  await expect(topic.composer).toBeFocused()
  await expect(topic.composerChips).toHaveText(['#platform'])

  await topic.composer.pressSequentially('now.')
  await topic.composer.press('Enter')
  await topic.expectSent('Notes are in')
  expect(postedText(fake).at(-1)).toBe('Notes are in <#C0PLATFORM|platform> now.')
  await expect(topic.message('Notes are in').locator('[data-channel="C0PLATFORM"]')).toHaveText('#platform')
}

async function navigateMentions({ juno, fake }: Context): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)

  await topic.composer.pressSequentially('@ma')
  await expect(topic.suggestion('Maya')).toBeVisible()
  await topic.composer.press('Escape')
  await expect(topic.suggestions).toHaveCount(0)
  await expect(topic.composer).toHaveValue('@ma')
  await expect(topic.composer).toBeFocused()
  // Typing on does not bring back the list Esc closed; Enter sends the text as typed.
  await topic.composer.pressSequentially('rch')
  await expect(topic.suggestions).toHaveCount(0)
  await topic.composer.press('Enter')
  await topic.expectSent('@march')
  expect(postedText(fake).at(-1)).toBe('@march')
}

async function keepMentionDraft({ juno, fake }: Context): Promise<void> {
  const { topic, sidebar } = juno
  await sidebar.row(POSTGRES).open()
  await topic.composer.pressSequentially('Ask @pri')
  await expect(topic.suggestion('Priya')).toBeVisible()
  await topic.composer.press('Enter')
  await sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await expect(topic.composer).toHaveValue('Ask @Priya ')
  await expect(topic.composerChips).toHaveText(['@Priya'])
  // Typing goes on at the end of the draft it came back with.
  await topic.composer.pressSequentially('about the copy.')
  await topic.composer.press('Enter')
  await topic.expectSent('Ask')
  expect(postedText(fake).at(-1)).toBe('Ask <@U0PRIYA> about the copy.')
}

async function homeSuggestions({ juno, fake }: Context): Promise<void> {
  const { write } = juno
  await juno.home.open()

  // Before a destination, a first @ is the "Send to" list's, and an @ inside the question suggests people.
  await write.composer.pressSequentially('@le')
  await expect(write.sendTo).toBeVisible()
  await expect(write.suggestions).toHaveCount(0)
  await write.composer.fill('')
  await write.composer.pressSequentially('Ask about @le')
  await expect(write.suggestion('Leo')).toBeVisible()
  await write.composer.press('Enter')
  await expect(write.composer).toHaveValue('Ask about @Leo ')
  await expect(write.composerChips).toHaveText(['@Leo'])
  await write.composer.fill('')

  await write.pickConversation('eng', 'eng')
  await expect(write.composer).toBeFocused()
  await write.composer.pressSequentially('Pairing with @le')
  await expect(write.suggestion('Leo')).toBeVisible()
  await write.composer.press('Enter')
  await expect(write.composer).toHaveValue('Pairing with @Leo ')
  await expect(write.composerChips).toHaveText(['@Leo'])
  await write.composer.pressSequentially('in #')
  await expect(write.suggestion('eng')).toBeVisible()
  // Enter right after typing, before the list for "pla" has answered, still picks.
  await write.composer.pressSequentially('pla')
  await write.composer.press('Enter')
  await expect(write.composer).toHaveValue('Pairing with @Leo in #platform ')

  // Colon emoji work here too, picked with Tab.
  await write.composer.pressSequentially(':smi')
  await expect(write.suggestions).toBeVisible()
  await write.composer.press('Tab')
  await expect(write.composer).toHaveValue('Pairing with @Leo in #platform 😄 ')
  await expect(write.composer).toBeFocused()

  await write.send()
  await expect.poll(() => postedText(fake).at(-1)).toBe('Pairing with <@U0LEO> in <#C0PLATFORM|platform> 😄')
}

async function colonEmoji({ juno, fake }: Context): Promise<void> {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.composer.pressSequentially('Looking good :smi')
  await expect(topic.suggestions.getByRole('option', { name: ':smile:', exact: true })).toBeVisible()
  await topic.composer.press('ArrowDown')
  await topic.composer.press('ArrowUp')
  await topic.composer.press('Enter')
  await expect(topic.composer).toHaveValue('Looking good 😄 ')
  await topic.composer.press('Enter')
  await expect.poll(() => postedText(fake).at(-1)).toBe('Looking good 😄')

  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await topic.composer.pressSequentially(':smi')
  await expect(topic.suggestions).toBeVisible()
  await topic.composer.press('Escape')
  await expect(topic.suggestions).toHaveCount(0)
  await expect(topic.composer).toHaveValue(':smi')
  await topic.composer.pressSequentially('le:')
  await expect(topic.composer).toHaveValue('😄')
  await topic.composer.press('Enter')
  await expect.poll(() => postedText(fake).at(-1)).toBe('😄')
}
