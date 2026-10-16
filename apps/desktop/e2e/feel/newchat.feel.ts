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

test('New chat opens a thread without moving the composer or root', async ({ juno, fake, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.newChat.pickConversation('eng', 'eng')
  await juno.newChat.write('first')
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await feel.run({
    name: 'new-chat-thread',
    title: 'Send from New chat Main, then acknowledge the new thread in place',
    probes: [
      { kind: 'box', name: 'composer', selector: '[data-composer] textarea' },
      { kind: 'box', name: 'root', selector: '[data-topic-view] [data-message-row]' },
    ],
    regions: { root: '[data-topic-view] [data-message-row]' },
    checks: [landsAndStays('composer', 'composer', { tolerance: 0 }), landsAndStays('root', 'thread root', { tolerance: 0 }), noFlicker('root', 'thread root')],
  }, async () => {
    await juno.newChat.send()
    await juno.topic.expectMessage('first')
    await expect(juno.sidebar.row('first').root).toBeVisible()
    await expect.poll(() => fake.heldCount({ method: 'chat.postMessage' })).toBe(1)
    fake.release()
    await juno.topic.expectSent('first')
  })
})
