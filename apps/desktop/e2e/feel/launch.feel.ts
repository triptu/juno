import { launchApp, expect } from '../fixtures'
import { Juno } from '../driver/juno'
import { Feel, test } from './feel'
import { landsAndStays, shotsOf } from './checks'

test('launch shows Home with its composer', async ({ juno, running, userData, fake, slackApp, studio }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect(juno.write.composer).toBeVisible()
  await running.close()
  const next = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const again = new Juno(next.app, next.win)
    await new Feel(next.win, studio, 'launch').run({
      name: 'launch', title: 'Launch into Home',
      probes: [
        { kind: 'box', name: 'composer', selector: '[data-home] [data-composer-field]' },
        { kind: 'count', name: 'recentRows', within: '[data-home-recent]', selector: 'button' },
        { kind: 'text', name: 'tab', selector: '[role="tab"][aria-selected="true"]' },
      ],
      checks: [landsAndStays('composer', 'composer', { tolerance: 0 }), ({ recording }) => {
        const blank = recording.frames.filter(frame => String(frame.values['tab']).includes('Home') && frame.values['composer'] === null)
        return { name: 'Home paints with its composer', status: blank.length === 0 ? 'pass' : 'fail', detail: `${blank.length} frames with a Home tab but no composer`, shots: [] }
      }],
    }, async () => {
      await expect(again.write.composer).toBeVisible()
      await expect(again.write.composer).toBeFocused()
      await expect(again.write.recent.getByRole('button').first()).toBeVisible()
    })
  } finally { await next.close() }
})

test('relaunch while Slack checks the session never shows the sign-in page', async ({ juno, running, userData, fake, slackApp, studio }) => {
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  // The engine stays `starting` until auth.test answers, as on a slow network.
  fake.holdNext({ method: 'auth.test' })
  const next = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const again = new Juno(next.app, next.win)
    await new Feel(next.win, studio, 'relaunch').run({
      name: 'relaunch-checking', title: 'Relaunch while Slack checks the session',
      probes: [
        { kind: 'box', name: 'signIn', selector: '#sign-in-title' },
        { kind: 'box', name: 'sidebar', selector: '[role="complementary"][aria-label="Sidebar"]' },
      ],
      checks: [(evidence) => {
        const { frames } = evidence.recording
        const wrong = frames.filter(frame => frame.values['signIn'] !== null || frame.values['sidebar'] === null)
        return { name: 'The shell shows in every frame, the sign-in page in none', status: wrong.length === 0 ? 'pass' : 'fail', detail: `${wrong.length} of ${frames.length} frames without the shell or with the sign-in page`, shots: shotsOf(evidence, wrong) }
      }],
    }, async () => {
      await expect.poll(() => fake.heldCount({ method: 'auth.test' }), { timeout: 15_000 }).toBe(1)
      await again.sidebar.row('Draft plan is in the doc').expectVisible()
      fake.release({ method: 'auth.test' })
      await again.expectSignedIn('Juno Fake')
    })
  } finally { await next.close() }
})
