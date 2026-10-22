import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import type { Slack } from './driver/slack'
import { expect, test } from './fixtures'
import { expectRestSurvivesGrowth } from './scrollGrowthProbe'

async function openLongMain(juno: Juno, fake: FakeSlack, slack: Slack): Promise<string> {
  const channel = slack.channel('eng')
  for (let i = 0; i < 30; i++) fake.workspace.post({ channel, user: slack.as(i % 2 === 0 ? 'Maya' : 'Leo').id, text: `Earlier message ${i}`, silent: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectMessage('Earlier message 29')
  await juno.topic.toLatest()
  expect(await juno.topic.scroller.evaluate((node) => node.scrollHeight > node.clientHeight * 1.5)).toBe(true)
  return channel
}

test('the bottom survives shrinking content and fractional offsets', async ({ juno, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  const result = await juno.topic.scroller.evaluate(async (node) => {
    const row = [...node.querySelectorAll<HTMLElement>('[data-message-row]')].at(-1)!
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    row.style.paddingBottom = '160px'
    await frame()
    await frame()
    node.scrollTop -= 0.5
    row.style.paddingBottom = '80px'
    await frame()
    await frame()
    const shrunk = node.scrollHeight - node.scrollTop - node.clientHeight
    row.style.paddingBottom = '160px'
    await frame()
    await frame()
    const grown = node.scrollHeight - node.scrollTop - node.clientHeight
    row.style.paddingBottom = ''
    return { shrunk, grown }
  })
  expect(result.shrunk).toBeLessThanOrEqual(1)
  expect(result.grown).toBeLessThanOrEqual(1)
})

test('a resting bottom survives growth during a coalesced scrollend', async ({ juno, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  await expectRestSurvivesGrowth(juno.topic.scroller, '[data-message-row]')
})

