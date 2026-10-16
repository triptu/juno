import { launchApp, expect } from '../fixtures'
import { Juno } from '../driver/juno'
import { Feel, test } from './feel'
import { landsAndStays } from './checks'

test('launch shows the default New chat composer', async ({ juno, running, userData, fake, slackApp, studio }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect(juno.newChat.composer).toBeVisible()
  await running.close()
  const next = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const again = new Juno(next.app, next.win)
    await new Feel(next.win, studio, 'launch').run({
      name: 'launch', title: 'Launch into the default New chat',
      probes: [
        { kind: 'box', name: 'composer', selector: '[data-new-chat] [data-composer]' },
        { kind: 'text', name: 'tab', selector: '[role="tab"][aria-selected="true"]' },
      ],
      checks: [landsAndStays('composer', 'composer', { tolerance: 0 }), ({ recording }) => {
        const blank = recording.frames.filter(frame => String(frame.values['tab']).includes('New chat') && frame.values['composer'] === null)
        return { name: 'New chat paints with its composer', status: blank.length === 0 ? 'pass' : 'fail', detail: `${blank.length} frames with a New chat tab but no composer`, shots: [] }
      }],
    }, async () => {
      await expect(again.newChat.composer).toBeVisible()
      await expect(again.newChat.composer).toBeFocused()
    })
  } finally { await next.close() }
})
