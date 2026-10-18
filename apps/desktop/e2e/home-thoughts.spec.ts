// Home's thought (SPEC 12, "A thought"): with nothing to show, one quote or
// fact under the greeting; a row that lands during the first sync takes its
// place without moving the greeting; Settings › General turns it off.
import { SELF_ID, startFakeSlack, TEAM, type Workspace } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 150_000 })

const DAY = 24 * 60 * 60 * 1000
const SWITCH = 'Show a thought when Home is empty'

/** Tushar and Leo in #general, everything read. */
function quietSeed(workspace: Workspace, avatarBase: string): void {
  const now = workspace.clock.now()
  for (const [id, name] of [[SELF_ID, 'Tushar'], ['U0LEO', 'Leo Park']] as const) {
    workspace.addUser({ id, team_id: TEAM.id, name, real_name: name, profile: { display_name: name, image_72: `${avatarBase}/${id}.svg` } })
  }
  workspace.addConversation({ id: 'C0QUIET', name: 'general', kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
  const last = workspace.post({ channel: 'C0QUIET', user: 'U0LEO', text: 'Release notes are out.', at: now - 60 * 60_000, silent: true })
  workspace.reads.set('C0QUIET', last.ts)
}

/** Caught up: nothing waits and nothing is unread. */
const quiet = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: quietSeed })
    await use(fake)
    await fake.close()
  },
})

/**
 * Not caught up, with nothing to show when Home is ready: Leo's DM has an
 * unread message that asks nothing. #build-chatter, read after Home is
 * ready, has 55 messages since the last one read 40 days ago, so the
 * Ignore card lands once its history does.
 */
const filling = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({
      seed: (workspace, avatarBase) => {
        quietSeed(workspace, avatarBase)
        const now = workspace.clock.now()
        workspace.addConversation({ id: 'D0LEO', name: '', kind: 'im', members: new Set([SELF_ID, 'U0LEO']), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
        const read = workspace.post({ channel: 'D0LEO', user: 'U0LEO', text: 'Lunch was good.', at: now - 2 * DAY, silent: true })
        workspace.reads.set('D0LEO', read.ts)
        workspace.post({ channel: 'D0LEO', user: 'U0LEO', text: 'The release notes look good.', at: now - 30 * 60_000, silent: true })
        workspace.addConversation({ id: 'C0BUILDS', name: 'build-chatter', kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: now - 90 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
        const old = workspace.post({ channel: 'C0BUILDS', user: 'U0LEO', text: 'Nightly builds move to 2am', at: now - 40 * DAY, silent: true })
        workspace.reads.set('C0BUILDS', old.ts)
        for (let i = 0; i < 55; i++) workspace.post({ channel: 'C0BUILDS', user: 'U0LEO', text: `Build ${i} is green`, at: now - 6 * DAY + i * 2 * 60 * 60_000, silent: true })
      },
    })
    await use(fake)
    await fake.close()
  },
})

quiet('An empty Home shows one thought under the greeting, and none once the setting is off', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { home } = juno
  await home.open()
  await expect(home.greeting).toHaveText('All caught up.')
  expect(await home.kinds()).toEqual([])
  await expect(home.thought).toHaveCount(1)
  await expect(home.thought.locator('p').first()).toHaveText(/\S/)
  // Plain text after the greeting, under it.
  const [greeting, thought] = await Promise.all([home.greeting.boundingBox(), home.thought.boundingBox()])
  expect(thought!.y).toBeGreaterThan(greeting!.y + greeting!.height)
  const shown = await home.thought.textContent()

  // Back within a few minutes: the same thought.
  await juno.openSettings('General')
  await home.open()
  await expect(home.thought).toHaveText(shown!)

  // Off in Settings › General: Home shows none.
  await juno.openSettings('General')
  const toggle = juno.settings.root.getByRole('switch', { name: SWITCH })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await home.open()
  await expect(home.greeting).toHaveText('All caught up.')
  await expect(home.thought).toHaveCount(0)
})

filling('A row that lands during the first sync takes the place of the thought without moving the greeting', async ({ juno, slack }) => {
  const method = 'conversations.history'
  slack.fake.holdNext({ method })
  await juno.signIn()
  const { home } = juno
  await home.navItem.click()
  // History waits a call at a time; let it through until Home is ready. The DM is read first, #build-chatter later.
  await expect
    .poll(
      async () => {
        if ((await home.root.count()) > 0) return true
        if (slack.fake.heldCount({ method }) > 0) {
          slack.fake.release({ method })
          slack.fake.holdNext({ method })
        }
        return false
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  await expect(home.greeting).toHaveText(/Tushar\.$/)
  expect(await home.kinds()).toEqual([])
  await expect(home.thought).toHaveCount(1)
  const before = await home.greeting.boundingBox()

  // The rest of history lands: the Ignore card takes the first reserved slot and the thought goes.
  slack.fake.release({ method })
  await expect(home.item('ignore')).toBeVisible({ timeout: 30_000 })
  await expect(home.thought).toHaveCount(0)
  expect(await home.greeting.boundingBox()).toEqual(before)
})
