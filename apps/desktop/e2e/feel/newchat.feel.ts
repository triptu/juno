import { expect } from '../fixtures'
import { landsAndStays, neverZero, noFlicker } from './checks'
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

test('the conversation list keeps its rows while a search is typed', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.newTabButton.click()
  await juno.newChat.conversationButton.click()
  await expect(juno.newChat.option('eng')).toBeVisible()
  await feel.run({
    name: 'new-chat-picker-typing',
    title: 'Type a search into the conversation list; it never draws empty',
    probes: [{ kind: 'count', name: 'rows', within: '[data-new-chat] [role="listbox"]', selector: '[role="option"]' }],
    regions: { list: '[data-new-chat] [role="listbox"]' },
    checks: [neverZero('rows', 'the conversation list', { from: 'type' }), noFlicker('list', 'the conversation list', { from: 'type' })],
  }, async (rec) => {
    await rec.mark('type')
    // One key at a time, each a new query, as a person types.
    await juno.newChat.search.pressSequentially('eng', { delay: 60 })
    await expect(juno.newChat.option('eng')).toBeVisible()
    await juno.win.waitForTimeout(200)
  })
})
