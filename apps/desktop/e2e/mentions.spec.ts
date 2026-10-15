// @ and # in the composer (spec section 8, inventory 7.1): people and
// channels suggested as you type, picked with the keyboard, sent as real
// Slack mentions and channel links, Esc and Backspace, and New chat.
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'

const postedText = (fake: { readonly calls: ReadonlyArray<{ readonly method: string; readonly args: Record<string, unknown> }> }) =>
  fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => String(call.args['text']))

test('mention a person in a reply: it posts as <@U…> and shows as a mention', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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

  await topic.composer.pressSequentially('the plan works.')
  await topic.composer.press('Enter')
  await topic.expectSent('Thanks')
  expect(postedText(fake).at(-1)).toBe('Thanks <@U0MAYA> the plan works.')
  await expect(topic.message('Thanks').locator('[data-person="U0MAYA"]')).toHaveText('@Maya')
})

test('link a channel with #, picked with Tab', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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
})

test('arrows move through the list, and Esc closes it and keeps the text', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)

  await topic.composer.pressSequentially('@')
  const rows = topic.suggestions.getByRole('option')
  await expect(rows.first()).toBeVisible()
  const first = await rows.nth(0).getAttribute('id')
  const second = await rows.nth(1).getAttribute('id')
  await expect(topic.composer).toHaveAttribute('aria-activedescendant', first!)
  await topic.composer.press('ArrowDown')
  await expect(topic.composer).toHaveAttribute('aria-activedescendant', second!)
  await topic.composer.press('ArrowUp')
  await expect(topic.composer).toHaveAttribute('aria-activedescendant', first!)

  await topic.composer.pressSequentially('ma')
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
})

test('Backspace into a picked name removes it whole', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)

  await topic.composer.pressSequentially('Hi @le')
  await expect(topic.suggestion('Leo')).toBeVisible()
  await topic.composer.press('Enter')
  await expect(topic.composer).toHaveValue('Hi @Leo ')
  await topic.composer.press('Backspace')
  await expect(topic.composer).toHaveValue('Hi @Leo')
  await topic.composer.press('Backspace')
  await expect(topic.composer).toHaveValue('Hi ')
  await expect(topic.composerChips).toHaveCount(0)
  // ⌘Z brings it back, chip and all.
  await topic.composer.press('ControlOrMeta+z')
  await expect(topic.composer).toHaveValue('Hi @Leo')
  await expect(topic.composerChips).toHaveText(['@Leo'])
})

test('a draft keeps its mentions across tab switches', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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
  await topic.composer.press('End')
  await topic.composer.pressSequentially('about the copy.')
  await topic.composer.press('Enter')
  await topic.expectSent('Ask')
  expect(postedText(fake).at(-1)).toBe('Ask <@U0PRIYA> about the copy.')
})

test('suggestions in New chat, before and after picking where it goes', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { tabs, newChat, topic } = juno

  await tabs.menu('new-chat')
  await expect(newChat.composer).toBeFocused()
  await newChat.composer.pressSequentially('Pairing with @le')
  await expect(newChat.suggestion('Leo')).toBeVisible()
  await newChat.composer.press('Enter')
  await expect(newChat.composer).toHaveValue('Pairing with @Leo ')
  await expect(newChat.composerChips).toHaveText(['@Leo'])

  await newChat.pickConversation('eng', 'eng')
  await expect(newChat.composer).toBeFocused()
  await newChat.composer.press('End')
  await newChat.composer.pressSequentially('in #')
  await expect(newChat.suggestion('eng')).toBeVisible()
  // Enter right after typing, before the list for "pla" has answered, still picks.
  await newChat.composer.pressSequentially('pla')
  await newChat.composer.press('Enter')
  await expect(newChat.composer).toHaveValue('Pairing with @Leo in #platform ')

  await newChat.send()
  await topic.expectMessage('Pairing with')
  expect(postedText(fake).at(-1)).toBe('Pairing with <@U0LEO> in <#C0PLATFORM|platform>')
})
