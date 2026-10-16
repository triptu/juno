// ⌘K's Conversations search by words (spec section 10): "dmitriy wi" finds
// the group DM with Dmitriy and wience, whose label holds both words in
// another order with a comma between, highlights what matched, and opens
// it with Enter.
import { SELF_ID, TEAM } from '@juno/fake-slack'
import { expect, test } from './fixtures'

const DAY = 86_400_000

test('"dmitriy wi" lists the group DM with Dmitriy and wience, and Enter opens it', async ({ juno, slack }) => {
  const fake = slack.fake
  for (const [id, name, display, real] of [
    ['U0DMITRIY', 'dvasilyuk', 'Dmitriy', 'Dmitriy Vasilyuk'],
    ['U0WIENCE', 'wience', 'wience', 'Wience Ortega'],
  ] as const) {
    fake.workspace.addUser({ id, team_id: TEAM.id, name, real_name: real, profile: { display_name: display, real_name: real } })
  }
  fake.workspace.addConversation({
    id: 'G0DMITRIY',
    name: 'mpdm-tushar--dvasilyuk--wience-1',
    kind: 'mpim',
    members: new Set([SELF_ID, 'U0DMITRIY', 'U0WIENCE']),
    created: fake.now() - 10 * DAY,
    topic: '',
    purpose: '',
    isOpen: true,
    archived: false,
  })
  const last = fake.workspace.post({ channel: 'G0DMITRIY', user: 'U0WIENCE', text: 'Shipping the build tonight', at: fake.now() - DAY, silent: true })
  fake.workspace.reads.set('G0DMITRIY', last.ts)

  await juno.signIn()
  await juno.waitForSync()
  const { palette, tabs } = juno

  await palette.open()
  await palette.type('dmitriy wi')
  const row = palette.section('Conversations').getByRole('option', { name: /Dmitriy, wience/ })
  await expect(row).toBeVisible()
  await expect(row.locator('[data-match]')).toHaveText(['Dmitriy', 'wi'])
  await palette.expectActive(/Dmitriy, wience/)
  await palette.press('Enter')
  await palette.expectClosed()
  await tabs.expectActive('Dmitriy, wience')
})
