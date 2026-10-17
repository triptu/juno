import { expect } from '../fixtures'
import { landsAndStays, neverZero, noFlicker } from './checks'
import { test } from './feel'

test('Recent, the chip and the composer stay in place when a destination is chosen', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  const rows = juno.write.recent.getByRole('button')
  await expect(rows.first()).toBeVisible()
  await feel.run({
    name: 'home-write-recent',
    title: 'Choose a destination from Recent; Recent, the chip and the composer stay in place',
    probes: [
      { kind: 'box', name: 'recent', selector: '[data-home-recent]' },
      { kind: 'box', name: 'composer', selector: '[data-home] [data-composer-field]' },
    ],
    regions: { recent: '[data-home-recent]', chip: '[data-home-write] [aria-label^="Send to:"]' },
    checks: [landsAndStays('recent', 'Recent'), landsAndStays('composer', 'composer', { tolerance: 0 }), noFlicker('recent', 'Recent')],
  }, async () => {
    await rows.first().click()
    await expect(juno.write.composer).toBeFocused()
  })
})

test('a send from Home leaves the field where it was', async ({ juno, fake, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.write.pickConversation('eng', 'eng')
  await juno.write.write('first')
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await feel.run({
    name: 'home-write-send',
    title: 'Send to a channel from Home; the field stays, empties and goes back to Juno',
    probes: [{ kind: 'box', name: 'composer', selector: '[data-home] [data-composer-field]' }],
    regions: { composer: '[data-home] [data-composer-field]' },
    checks: [landsAndStays('composer', 'composer', { tolerance: 0 }), noFlicker('composer', 'composer')],
  }, async () => {
    await juno.write.send()
    await expect(juno.write.composer).toHaveValue('')
    await expect(juno.sidebar.row('first').root).toBeVisible()
    await expect.poll(() => fake.heldCount({ method: 'chat.postMessage' })).toBe(1)
    fake.release()
    await juno.write.expectDestination('Juno')
  })
})

test('the destination list keeps its rows while a search is typed', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.write.chip.click()
  await expect(juno.write.option('eng')).toBeVisible()
  await feel.run({
    name: 'home-write-list-typing',
    title: 'Type a search into the destination list; it never draws empty',
    probes: [{ kind: 'count', name: 'rows', within: '[data-home] [role="dialog"] [role="listbox"]', selector: '[role="option"]' }],
    regions: { list: '[data-home] [role="dialog"] [role="listbox"]' },
    checks: [neverZero('rows', 'the destination list', { from: 'type' }), noFlicker('list', 'the destination list', { from: 'type' })],
  }, async (rec) => {
    await rec.mark('type')
    // One key at a time, each a new query, as a person types.
    await juno.write.search.pressSequentially('eng', { delay: 60 })
    await expect(juno.write.option('eng')).toBeVisible()
    await juno.win.waitForTimeout(200)
  })
})
