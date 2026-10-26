import { expect, test } from './fixtures'
import { expectRestSurvivesGrowth } from './scrollGrowthProbe'
import { openLongMain } from './stickBottomLists'

test('a scroll that stops just short of the end stays put, and a resting bottom survives growth during a coalesced scrollend', async ({ juno, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  const { topic } = juno
  await test.step('a scroll down that stops just short of the end stays where it stopped', async () => {
    const distance = () => topic.scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)
    await topic.scrollUp(24)
    const before = await distance()
    expect(before).toBeGreaterThan(9)
    expect(before).toBeLessThanOrEqual(32)
    // Part of the way back down from a script, as scrolling a row into view does. Resting within 32px held the bottom,
    // but no row grew, so the list stays where the scroll put it and the row under a still pointer stays there.
    await topic.scroller.evaluate(async (node) => {
      const ended = new Promise<void>((resolve) => node.addEventListener('scrollend', () => resolve(), { once: true }))
      node.scrollTop += 8
      await ended
      for (let i = 0; i < 5; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(await distance()).toBe(before - 8)
  })
  // The probe scrolls to the end itself, so the step above does not change what it checks.
  await test.step('a resting bottom survives growth during a coalesced scrollend', () => expectRestSurvivesGrowth(topic.scroller, '[data-message-row]'))
})
