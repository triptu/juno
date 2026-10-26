// Attachments (spec section 8; architecture 9) where the browser matters: a
// pasted image at its final size, the canary that also runs in Electron with
// its image clipboard. The local copy before Slack's thumbnails is in
// media.spec.ts. Paste, drop, the picker, a failed upload's Retry, unreadable
// files and the viewer are in the DOM lane (`dom/attachments.test.ts`).
import { schemeSrc } from './driver/juno'
import { expect, test } from './fixtures'
import { chart, chip, chips, paste } from './attach'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'

test('a pasted image goes with the message and shows in it at its final size', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await paste(topic.composer, [chart()])
  await expect(chip(topic, 'chart.png')).toBeVisible()
  await expect(topic.root.locator(`[data-composer] img${schemeSrc('uploads')}`)).toHaveCount(1)

  fake.holdNext({ method: 'files.share', before: true })
  await topic.send('The chart for Thursday')
  await expect(chips(topic)).toHaveCount(0)
  const row = topic.message('The chart for Thursday')
  await expect(row).toHaveAttribute('data-pending', 'sending')
  const pending = row.getByRole('img', { name: 'chart.png' }).or(row.getByRole('button', { name: 'Open chart.png' }))
  await expect(pending).toBeVisible()
  const box = await pending.boundingBox()
  expect({ width: box!.width, height: box!.height }).toEqual({ width: 360, height: 225 })

  fake.release()
  await topic.expectSent('The chart for Thursday')
  await expect(row.getByRole('button', { name: 'Open chart.png' }).locator(`img${schemeSrc('files')}`)).toHaveCount(1, { timeout: 15_000 })
  await expect.poll(() => row.getByRole('button', { name: 'Open chart.png' }).boundingBox()).toMatchObject({ width: 360, height: 225 })

  const shares = fake.calls.filter((call) => call.method === 'files.share')
  expect(shares).toHaveLength(1)
  const posted = fake.messages('C0ENG').filter((m) => m.client_msg_id === shares[0]!.args['client_msg_id'])
  expect(posted.map((m) => m.files?.map((f) => f.name))).toEqual([['chart.png']])
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toEqual([])

  // Another person's 800 × 600 image shows at its own final size.
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Whiteboard from today', media: [{ name: 'whiteboard.png', width: 800, height: 600 }] })
  const whiteboard = topic.message('Whiteboard from today').getByRole('button', { name: 'Open whiteboard.png' })
  await expect(whiteboard.locator(`img${schemeSrc('files')}`)).toHaveCount(1)
  await expect.poll(() => whiteboard.boundingBox()).toMatchObject({ width: 320, height: 240 })
})
