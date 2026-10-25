import { expect, syncedTest, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

async function revisit(juno: Juno) {
  await juno.sidebar.row('#eng').open()
  await juno.home.open()
}

// Which huddles count as missed, Never and Always, ignored channels, history after a restart and the row's
// title are the engine's home-view flow test. This checks Home's row: Dismiss on the card, then opening the row
// opens the DM and clears it.
syncedTest('a dismissed huddle appears on Home after it ends, and opening it opens the DM and clears it', async ({ juno, fake, win }) => {
  await juno.sidebar.row('#eng').open()
  fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  const card = win.getByRole('region', { name: 'Incoming huddle' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Dismiss' }).click()
  fake.control('endHuddle', { channel: 'D0MAYA' })
  await expect.poll(async () => {
    await revisit(juno)
    return juno.home.title('missedHuddle').allTextContents()
  }).toEqual(['Missed huddle with Maya'])
  await expect(juno.home.meta('missedHuddle')).toContainText('Lasted under a minute')
  await juno.home.openItem('missedHuddle')
  await juno.topic.expectTitle('Maya')
  await revisit(juno)
  await expect(juno.home.item('missedHuddle')).toHaveCount(0)
})
