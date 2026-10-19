// @ and # in the composer (spec section 8, inventory 7.1): people, user
// groups and channels suggested as you type, picked with the keyboard, sent
// as real Slack mentions and channel links, Esc and Backspace, and Home's
// composer, in a question for Juno and once a person or channel is chosen.
import { expect, test, type Fixtures } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'

const postedText = (fake: { readonly calls: ReadonlyArray<{ readonly method: string; readonly args: Record<string, unknown> }> }) =>
  fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => String(call.args['text']))

test('picks people, groups and channels, navigates suggestions and keeps a mention draft', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const context = { juno, fake }
  await test.step('mention a person in a reply: Backspace removes it whole, and it posts as <@U…> and shows as a mention', () => mentionPerson(context))
  await test.step('a user group is suggested after the people who match, and posts as Slack sends a group mention', () => mentionGroup(context))
  await test.step('link a channel with #, picked with Tab', () => linkChannel(context))
  await test.step('arrows move through the list, and Esc closes it and keeps the text', () => navigateMentions(context))
  await test.step('a draft keeps its mentions across tab switches', () => keepMentionDraft(context))
})

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

async function mentionGroup({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
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

async function linkChannel({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
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

async function navigateMentions({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
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
}

async function keepMentionDraft({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
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

test('Home suggests people and channels inside a question for Juno and once a person or channel is chosen', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { write } = juno

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
})
