import { expect } from '../fixtures'
import { landsAndStays, noFlicker } from './checks'
import { test } from './feel'

test('Frequent stays in place when a destination is chosen', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.newTabButton.click()
  const list = juno.newChat.root.getByRole('list', { name: 'Frequent conversations' })
  await expect(list.getByRole('button')).toHaveCount(6)
  await feel.run({
    name: 'new-chat-frequent',
    title: 'Choose a frequent destination; the rows and composer stay in place',
    probes: [
      { kind: 'box', name: 'frequent', selector: '[aria-label="Frequent conversations"]' },
      { kind: 'box', name: 'composer', selector: '[data-new-chat] [data-composer]' },
    ],
    regions: { frequent: '[aria-label="Frequent conversations"]' },
    checks: [landsAndStays('frequent', 'frequent rows'), landsAndStays('composer', 'composer'), noFlicker('frequent', 'frequent rows')],
  }, async () => {
    await list.getByRole('button').first().click()
    await expect(juno.newChat.composer).toBeFocused()
  })
})
