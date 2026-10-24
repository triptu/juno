// ⌘K's All tab (spec section 10): one word finds a channel, a thread by its
// title, a message and a command, each in its own group, and Enter on each
// does what that kind of row does. ⌘3 and ⌘4 keep the text.
import { SELF_ID } from '@juno/fake-slack'
import { expect, test, type Fixtures } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const DAY = 86_400_000
const THREAD = 'Theme switcher plan for Settings'
const REPLY = 'Draft is ready for review'
const MESSAGE = 'The dark theme ships on Friday'

test('All shows each kind in its group, Enter opens each, and ⌘3 and ⌘4 keep the text', async ({ juno, slack }) => {
  const fake = slack.fake
  fake.workspace.addConversation({
    id: 'C0THEMES',
    name: 'theme-studio',
    kind: 'public',
    members: new Set([SELF_ID, 'U0LEO']),
    created: fake.now() - 10 * DAY,
    topic: '',
    purpose: '',
    isOpen: true,
    archived: false,
  })
  fake.workspace.post({ channel: 'C0THEMES', user: 'U0LEO', text: 'Kickoff notes are pinned', at: fake.now() - DAY, silent: true })

  await juno.signIn()
  await juno.waitForSync()
  slack.as('Leo').postIn('eng', THREAD)
  slack.as('Dev').replyIn(THREAD, REPLY)
  slack.as('Maya').postIn('product', MESSAGE)

  const context = { juno }
  await test.step('⌘K opens on All, and "theme" fills each group', () => groups(context))
  await test.step('Enter on the thread opens it, and on the message lands on it', () => matches(context))
  await test.step('⌘3 shows Messages and ⌘4 Commands with the same text; Theme: Dark there applies it', () => otherTabs(context))
  await test.step('Enter on a command in All runs it', () => command(context))
})

const scheme = ({ juno }: Pick<Fixtures, 'juno'>) => juno.win.evaluate(() => getComputedStyle(document.documentElement).colorScheme)

async function openOnTheme({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const { palette } = juno
  await palette.open()
  await palette.expectTab('All')
  await palette.type('theme')
  await palette.expectResults()
}

async function groups(context: Pick<Fixtures, 'juno'>): Promise<void> {
  const { palette, topic } = context.juno
  await openOnTheme(context)
  await expect(palette.input).toHaveAttribute('placeholder', 'Search, or ask Juno')
  await expect(palette.section('Conversations').getByRole('option', { name: /theme-studio/ })).toBeVisible()
  const found = palette.section('Topics and messages').getByRole('option')
  // The thread's title and its root both match: one row.
  await expect(found.filter({ hasText: THREAD })).toHaveCount(1, { timeout: 15_000 })
  await expect(found.filter({ hasText: MESSAGE })).toBeVisible({ timeout: 15_000 })
  // The matched words are marked in titles and in messages.
  await expect(found.filter({ hasText: THREAD }).locator('[data-match]').first()).toHaveText('Theme')
  await expect(found.filter({ hasText: MESSAGE }).locator('[data-match]')).toHaveText(['theme'])
  await expect(palette.section('Pages, settings and commands').getByRole('option', { name: /Theme: Dark/ })).toBeVisible()
  await palette.expectActive(/theme-studio/)
  await palette.press('Enter')
  await palette.expectClosed()
  await topic.expectTitle('Main')
  await expect(topic.header).toContainText('theme-studio')
}

async function matches(context: Pick<Fixtures, 'juno'>): Promise<void> {
  const { palette, topic } = context.juno
  await openOnTheme(context)
  await palette.arrowTo(THREAD)
  await palette.press('Enter')
  await palette.expectClosed()
  await topic.expectMessage(REPLY)

  await openOnTheme(context)
  await palette.arrowTo(MESSAGE)
  await palette.press('Enter')
  await palette.expectClosed()
  await expect(topic.message(MESSAGE)).toBeInViewport({ timeout: 15_000 })
}

async function otherTabs(context: Pick<Fixtures, 'juno'>): Promise<void> {
  const { palette } = context.juno
  await openOnTheme(context)
  await palette.press('Meta+3')
  await palette.expectTab('Messages')
  await expect(palette.input).toHaveValue('theme')
  await palette.expectResults()
  await expect(palette.section('Topics and messages').getByRole('option').filter({ hasText: MESSAGE })).toBeVisible()
  await expect(palette.section('Conversations')).toHaveCount(0)

  await palette.press('Meta+4')
  await palette.expectTab('Commands')
  await expect(palette.input).toHaveValue('theme')
  await palette.choose('Theme: Dark')
  await palette.expectClosed()
  await expect.poll(() => scheme(context)).toBe('dark')
}

async function command(context: Pick<Fixtures, 'juno'>): Promise<void> {
  const { palette } = context.juno
  await openOnTheme(context)
  await palette.arrowTo(/Theme: Light/)
  await palette.press('Enter')
  await palette.expectClosed()
  await expect.poll(() => scheme(context)).toBe('light')
}
