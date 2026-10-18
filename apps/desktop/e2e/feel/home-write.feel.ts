import { expect } from '../fixtures'
import { landsAndStays, neverZero, noFlicker, shotOfFrame, type Check } from './checks'
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
  // The send button brightens over 150 ms once the field has text. Record from where it settled,
  // so its first frames are not that fade meeting the dimming the send starts.
  await juno.win.locator('[data-home] [data-composer-field]').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
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

/** The held rows keep their Juno row: a frame with Recent first has dropped it before the new rows came. */
const heldWhole: Check = (evidence) => {
  const { recording } = evidence
  const name = 'the held rows keep their first row'
  const mixed = recording.frames.filter((frame) => String(frame.values['list'] ?? '').startsWith('Recent'))
  if (mixed.length === 0) return { name, status: 'pass', detail: `${recording.frames.length} frames, none with Recent first`, shots: [] }
  const shots = [...new Set(mixed.map((frame) => shotOfFrame(evidence, frame.index)))]
  return { name, status: 'fail', detail: `${mixed.length} frames showed the earlier rows without the Juno row`, shots: shots.slice(0, 12) }
}

test('the destination list keeps its rows while a search is typed', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.write.chip.click()
  await expect(juno.write.option('eng')).toBeVisible()
  await feel.run({
    name: 'home-write-list-typing',
    title: 'Type a search into the destination list; it never draws empty',
    probes: [
      { kind: 'count', name: 'rows', within: '[data-home] [role="dialog"] [role="listbox"]', selector: '[role="option"]' },
      { kind: 'text', name: 'list', selector: '[data-home] [role="dialog"] [role="listbox"]' },
    ],
    regions: { list: '[data-home] [role="dialog"] [role="listbox"]' },
    checks: [neverZero('rows', 'the destination list', { from: 'type' }), noFlicker('list', 'the destination list', { from: 'type' }), heldWhole],
  }, async (rec) => {
    await rec.mark('type')
    // One key at a time, each a new query, as a person types.
    await juno.write.search.pressSequentially('eng', { delay: 60 })
    await expect(juno.write.option('eng')).toBeVisible()
    await juno.win.waitForTimeout(200)
  })
})
