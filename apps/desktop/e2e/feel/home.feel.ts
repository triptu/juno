import { happened, switchesOnce } from './checks'
import { expect, test } from './feel'

test('Home replaces the topic whole after its subscription expires', async ({ juno, win, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.home.open()
  await expect(juno.home.item('waiting')).toBeVisible()
  await juno.sidebar.row('Draft plan is in the doc').open()
  await juno.topic.expectTitle('Draft plan is in the doc')
  await win.waitForTimeout(31_000)

  await feel.run({
    name: 'home-after-idle',
    title: 'Open Home after reading a topic: the topic gives way to the greeting and rows in one step',
    probes: [
      { kind: 'count', within: 'main', name: 'topic', selector: '[data-topic-view]' },
      { kind: 'count', within: 'main', name: 'home', selector: '[data-home-item]' },
      { kind: 'count', within: 'main', name: 'waiting', selector: '[data-home-waiting]' },
    ],
    checks: [
      happened('Home showed its rows', (r) => r.frames.some((f) => Number(f.values['home']) > 0)),
      happened('no empty intermediate page', (r) => r.frames.every((f) => Number(f.values['waiting']) === 0 && (Number(f.values['topic']) > 0 || Number(f.values['home']) > 0))),
      switchesOnce('topic to Home', (v) => Number(v['home']) > 0 ? 'home' : Number(v['topic']) > 0 ? 'topic' : 'empty'),
    ],
  }, async (rec) => {
    await rec.mark('press')
    await juno.home.open()
    await expect(juno.home.item('waiting')).toBeVisible()
  })
})
