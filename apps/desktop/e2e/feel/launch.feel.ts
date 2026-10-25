// The relaunch that never paints the sign-in page while Slack checks the
// session is checked frame by frame in `session.spec.ts`.
import { expect } from '../fixtures'
import { Feel, test } from './feel'
import { landsAndStays } from './checks'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test('launch shows Home with its composer', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, relaunch, studio }) => {
  await expect(juno.write.composer).toBeVisible()
  const again = await relaunch()
  await new Feel(again.win, studio, 'launch').run({
    name: 'launch', title: 'Launch into Home',
    probes: [
      { kind: 'box', name: 'composer', selector: '[data-home] [data-composer-field]' },
      { kind: 'text', name: 'tab', selector: '[role="tab"][aria-selected="true"]' },
    ],
    checks: [landsAndStays('composer', 'composer', { tolerance: 0 }), ({ recording }) => {
      const blank = recording.frames.filter(frame => String(frame.values['tab']).includes('Home') && frame.values['composer'] === null)
      return { name: 'Home paints with its composer', status: blank.length === 0 ? 'pass' : 'fail', detail: `${blank.length} frames with a Home tab but no composer`, shots: [] }
    }],
  }, async () => {
    await expect(again.write.composer).toBeVisible()
    await expect(again.write.composer).toBeFocused()
    await expect(again.write.chip).toBeVisible()
  })
})
