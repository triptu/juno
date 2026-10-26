// @ and # in the composer (spec section 8, inventory 7.1): user groups and
// channels suggested as you type, picked with the keyboard, sent as real
// Slack mentions and channel links, the arrows and Esc, a draft that keeps
// its mentions, and Home's composer, in a question for Juno and once a
// person or channel is chosen. A picked person, Backspace and ⌘Z on it, and
// where the list sits, are in the browser lane (`e2e/composer.spec.ts`).
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const ENG_MAIN = '#eng'

const postedText = (fake: FakeSlack) => fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => String(call.args['text']))

domTest('picks groups and channels, navigates suggestions and keeps a mention draft, in a topic and on Home', async ({ juno, fake, step }) => {
  const context = { juno, fake }
  await step('a user group is suggested after the people who match, and posts as Slack sends a group mention', () => mentionGroup(context))
  await step('link a channel with #, picked with Tab', () => linkChannel(context))
  await step('arrows move through the list, and Esc closes it and keeps the text', () => navigateMentions(context))
  await step('a draft keeps its mentions across tab switches', () => keepMentionDraft(context))
  await step('Home suggests people and channels inside a question for Juno and once a person or channel is chosen', () => homeSuggestions(context))
})

type Context = { readonly juno: Juno; readonly fake: FakeSlack }

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
