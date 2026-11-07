// Pictures in a topic keep their box (SPEC 8, "Images and the media viewer"; architecture 9, "Late
// thumbnails"): an image the user sends, and images and videos other people post. Live, a fresh image reaches
// the socket before Slack has made its thumbnails, and a socket message can carry a partial file
// (`file_access: "check_file_info"`); nothing in the message changes later, so Juno re-reads the message and
// the card becomes the picture in place. The viewer's keys are in the DOM lane (`dom/attachments.test.ts`).
import type { Page } from '@playwright/test'
import { schemeSrc } from './driver/juno'
import { expect, syncedTest, test, type Fixtures } from './fixtures'
import { chart, paste, staged } from './attach'
import { expectStableAnchor } from './shiftProbe'

const ENG_MAIN = '#eng'

/** The size of the picture at `src`, loaded as an image in the page. */
function naturalSize(win: Page, src: string): Promise<{ width: number; height: number }> {
  return win.evaluate(
    (url) =>
      new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image()
        image.addEventListener('load', () => resolve({ width: image.naturalWidth, height: image.naturalHeight }), { once: true })
        image.addEventListener('error', () => reject(new Error('poster did not load')), { once: true })
        image.src = url
      }),
    src,
  )
}

// When an old card becomes the picture, and the retry on reopen after the lookups ran out, are engine
// behaviour (packages/engine/test/flows/message-content.flow.test.ts). Here a wide picture is held to the
// card's height.
async function heldToCardHeight({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  fake.injectMedia({ channel: 'C0ENG', user: 'U0LEO', text: 'The venue floor plan', media: [{ name: 'floor-plan.png', width: 800, height: 600 }] })
  const image = juno.topic.message('The venue floor plan').getByRole('button', { name: 'Open floor-plan.png' })
  await expect(image.locator(`img${schemeSrc('files')}`)).toHaveCount(1)
  await expect.poll(() => image.boundingBox()).toMatchObject({ width: 320, height: 240 })
}

syncedTest('pictures keep their box: a sent image before and after Slack\'s thumbnails, a 4:3 picture, a video, a partial file, late bytes; the viewer zooms and pans', async ({ juno, win, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await test.step('a sent image Slack has no thumbnails for yet shows at once from the local copy, then takes Slack\'s in the same box', () => beforeThumbnails({ juno, win, fake }))
  await test.step('a 4:3 picture shows in a box held to the card height', () => heldToCardHeight({ juno, fake }))
  await test.step('a video plays inline with its poster, and opens full screen', async () => {
    fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Recording of the demo', media: [{ name: 'demo.mp4', width: 1280, height: 720, kind: 'video' }] })
    const row = topic.message('Recording of the demo')
    const player = row.locator('[data-inline-video] video')
    await expect(player).toHaveCount(1)
    await expect(row.locator('[data-file-card]')).toHaveCount(0)
    // Reserved from the poster's size; the poster comes through main on the Slack session, as images do.
    expect(await row.locator('[data-inline-video]').boundingBox()).toMatchObject({ width: 360, height: 203 })
    const poster = await player.getAttribute('poster')
    expect(poster).toMatch(/^(?:juno:\/\/|\/__juno\/)files\/[^/]+\/poster\?url=/)
    expect(await player.getAttribute('src')).toMatch(/^(?:juno:\/\/|\/__juno\/)files\/[^/]+\/video\?url=/)
    // Loaded as an image, as the player loads it: a real picture of the poster's size.
    expect(await naturalSize(win, poster!)).toEqual({ width: 1280, height: 720 })

    const open = row.getByRole('button', { name: 'Open demo.mp4 full screen' })
    await open.click()
    const viewer = win.getByRole('dialog')
    await expect(viewer.locator(`video${schemeSrc('files', 'poster')}`)).toHaveCount(1)
    await expect(viewer.locator('[data-viewer-name]')).toHaveText('demo.mp4')
    await win.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(open).toBeFocused()
  })
  await test.step('an image that arrives as a partial file on the socket becomes the picture once Slack fills it in', async () => {
    // The first look at the file waits, so the partial copy is on screen first.
    fake.holdNext({ method: 'files.info', before: true })
    fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Screenshot of the failing check', partial: true, media: [{ name: 'Screenshot check.png', width: 640, height: 400 }] })
    const row = topic.message('Screenshot of the failing check')
    await expect(row.locator('[data-file-card]')).toHaveCount(1)
    await expect(row.locator('[data-thumbnail]')).toHaveCount(0)

    await expect.poll(() => fake.heldCount({ method: 'files.info' }), { timeout: 15_000 }).toBeGreaterThan(0)
    fake.release({ method: 'files.info' })
    const image = row.getByRole('button', { name: 'Open Screenshot check.png' })
    await expect(image.locator(`img${schemeSrc('files')}`)).toHaveCount(1, { timeout: 15_000 })
    await expect.poll(() => image.locator('img').evaluate((node: HTMLImageElement) => node.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
    await expect.poll(() => image.boundingBox()).toMatchObject({ width: 360, height: 225 })
    await expect(row.locator('[data-file-card]')).toHaveCount(0)
  })
  await test.step('a picture in the viewer zooms with a double-click and a pinch, and pans with a drag', () => zoomAndPan({ juno, win, fake }))
  await test.step('a picture whose first fetch fails is asked for again and shows in the same box, without a relaunch', () => failedOnce({ juno, win, fake }))
  // Last: the held bytes rule outlives the step.
  await test.step('delayed image bytes keep the reserved thumbnail box', async () => {
    fake.holdNext({ method: 'file:bytes', times: 100 })
    await juno.sidebar.row('Proposal: cut offline mode').open()
    const image = juno.topic.list.locator('[data-thumbnail] img').last()
    await expect(image).toBeVisible()
    await expect.poll(() => fake.heldCount({ method: 'file:bytes' })).toBeGreaterThan(0)
    expect(await image.evaluate((node) => node instanceof HTMLImageElement && node.complete)).toBe(false)
    await expectStableAnchor(win, '[data-thumbnail]', async () => {
      fake.release({ method: 'file:bytes' })
      await expect.poll(() => image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true)
    })
  })
})

// Live, Slack shares a fresh image before it has made thumbnails: the echo has no `thumb_*` and no size, and
// `file_thumbnail_generated` follows (research section 3, "Files"). The sent image shows its staged copy at its
// final size from the first frame, then Slack's thumbnail in the same box.
async function beforeThumbnails({ juno, win, fake }: Pick<Fixtures, 'juno' | 'win' | 'fake'>): Promise<void> {
  const { topic } = juno
  fake.holdThumbnails()
  await paste(topic.composer, [chart()])
  await staged(topic, 1)
  fake.holdNext({ method: 'files.share', before: true })
  await topic.send('Before the thumbnails')
  const row = topic.message('Before the thumbnails')
  const image = row.locator('[data-thumbnail][title="chart.png"]')
  await expect(image).toBeVisible()
  expect(await image.boundingBox()).toMatchObject({ width: 360, height: 225 })

  await expectStableAnchor(win, '[data-message-row] [data-thumbnail][title="chart.png"]', async () => {
    fake.release()
    await topic.expectSent('Before the thumbnails')
    // Stored without thumbnails: still the staged copy, still an image.
    await expect(image.locator(`img${schemeSrc('uploads')}`)).toHaveCount(1)
    await expect(row.getByRole('button', { name: 'Download chart.png' })).toHaveCount(0)
    // After the first background try Slack makes them, and file_created follows.
    await expect.poll(() => fake.calls.filter((call) => call.method === 'conversations.history' && call.args['_x_reason'] === 'file').length, { timeout: 15_000 }).toBeGreaterThan(0)
    fake.releaseThumbnails({ event: 'file_created' })
    await expect(image.locator(`img${schemeSrc('files')}`)).toHaveCount(1, { timeout: 15_000 })
    await expect.poll(() => image.locator(`img${schemeSrc('files')}`).evaluate((node: HTMLImageElement) => node.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
  }, { within: '[data-topic-view]' })
  expect(await image.boundingBox()).toMatchObject({ width: 360, height: 225 })
}

// A thumbnail's first fetch fails (the laptop asleep, Slack slow, the file host down). The picture must not
// stay broken until the app restarts: it is asked for again by itself, and shows in the box it had.
async function failedOnce({ juno, win, fake }: Pick<Fixtures, 'juno' | 'win' | 'fake'>): Promise<void> {
  fake.failFiles({ times: 1 })
  fake.injectMedia({ channel: 'C0ENG', user: 'U0LEO', text: 'The venue after the storm', media: [{ name: 'storm.png', width: 640, height: 480 }] })
  const image = juno.topic.message('The venue after the storm').locator('[data-thumbnail][title*="storm.png"]')
  await expect(image.locator('[data-broken]')).toHaveCount(1)
  expect(await image.boundingBox()).toMatchObject({ width: 320, height: 240 })
  const loaded = () => image.locator(`img${schemeSrc('files')}`).evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)
  await expectStableAnchor(win, '[data-message-row] [data-thumbnail][title*="storm.png"]', async () => {
    await expect.poll(loaded, { timeout: 15_000 }).toBe(true)
  }, { within: '[data-topic-view]' })
  await expect(image.locator('[data-broken]')).toHaveCount(0)
  await expect(image).toHaveAttribute('title', 'storm.png')
  expect(await image.boundingBox()).toMatchObject({ width: 320, height: 240 })
  // One refused fetch, one that served: nothing in between hammered the host.
  const fileId = fake.calls.find((call) => call.kind === 'file' && call.status !== 200)?.method
  await expect.poll(() => fake.calls.filter((call) => call.kind === 'file' && call.method === fileId).map((call) => call.status)).toEqual([503, 200])
}

// An image zooms inside its box (SPEC 8, "Zoom"): a double-click goes to 2.5x and back, a pinch zooms, and a drag pans
// without closing the viewer, even when it ends over the backdrop.
async function zoomAndPan({ juno, win, fake }: Pick<Fixtures, 'juno' | 'win' | 'fake'>): Promise<void> {
  const { topic } = juno
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Whiteboard from the planning session', media: [{ name: 'whiteboard.png', width: 900, height: 600 }] })
  await topic.message('Whiteboard from the planning session').getByRole('button', { name: 'Open whiteboard.png' }).click()
  const viewer = win.getByRole('dialog')
  const frame = viewer.locator('[data-viewer-item]')
  const zoom = frame.locator('[data-viewer-zoom]')
  const view = () => zoom.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform))
  await expect.poll(async () => (await view()).a).toBe(1)

  await frame.dblclick()
  await expect.poll(async () => (await view()).a).toBe(2.5)
  const box = (await frame.boundingBox())!
  const before = await view()
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 4 })
  await win.mouse.move(box.x - 24, box.y + box.height / 2, { steps: 4 })
  await win.mouse.up()
  await expect(viewer).toHaveCount(1)
  await expect.poll(async () => (await view()).e).not.toBe(before.e)

  await frame.dblclick()
  await expect.poll(async () => (await view()).a).toBe(1)
  await expect.poll(async () => (await view()).e).toBe(0)

  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.keyboard.down('Control')
  await win.mouse.wheel(0, -100)
  await win.keyboard.up('Control')
  await expect.poll(async () => (await view()).a).toBeGreaterThan(2)
  await win.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
}
