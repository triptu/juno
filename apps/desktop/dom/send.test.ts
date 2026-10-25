// Sending from a topic (spec section 8): a message settles in place in Main when Slack's
// echo comes before the answer, and a refused send stays with Retry and Delete draft.
import { expect } from './expect'
import { domTest } from './test'

domTest('in Main, a message settles when the echo comes before the answer, and a refused send stays with Retry and Delete draft', async ({ juno, fake, step }) => {
  const { topic } = juno
  await juno.sidebar.row('#eng').open()
  await topic.expectTitle('Main')

  await step('a message settles when the echo comes before the answer', async () => {
    fake.holdNext({ method: 'chat.postMessage' })
    await topic.send('Lunch order goes in at noon')
    await topic.expectSent('Lunch order goes in at noon')
    fake.release()
    // The same channel's next send waits for the first HTTP answer to finish.
    await topic.send('Then book a table for six')
    await topic.expectSent('Then book a table for six')
    await topic.expectSent('Lunch order goes in at noon')
    expect(fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['channel'])).toEqual(['C0ENG', 'C0ENG'])
  })

  await step('a refused send stays in the row with Retry and Delete draft', async () => {
    fake.forceError({ method: 'chat.postMessage', error: 'restricted_action', times: 2 })
    await topic.send('Please try this one again')
    await expect(topic.failed('Please try this one again').row).toContainText('Not sent.')
    await topic.send('Please drop this one')
    await expect(topic.failed('Please drop this one').row).toContainText('Not sent.')

    await topic.failed('Please try this one again').retry()
    await topic.expectSent('Please try this one again')
    await topic.failed('Please drop this one').discard()
    await expect(topic.message('Please drop this one')).toHaveCount(0)
    expect(fake.messages('C0ENG').filter((m) => m.text === 'Please drop this one')).toHaveLength(0)
  })
})
