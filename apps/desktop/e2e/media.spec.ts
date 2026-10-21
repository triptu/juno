// Images and videos other people post (SPEC 8, "Images and the media viewer"; architecture 9, "Late
// thumbnails"). Live, a fresh image reaches the socket before Slack has made its thumbnails, and a socket
// message can carry a partial file (`file_access: "check_file_info"`); nothing in the message changes
// later, so Juno re-reads the message and the card becomes the picture in place.
import type { Page } from '@playwright/test'
import { expect, syncedTest, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const PHOTOS_MAIN = '#photos'
const DAY_MINUTES = 24 * 60

/** The size of the picture at `src`, loaded as an image in the page. */
function naturalSize(win: Page, src: string): Promise<{ width: number; height: number }> {
  return win.evaluate(
    (url) =>
      new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => reject(new Error('poster did not load'))
        image.src = url
      }),
    src,
  )
}

test('an old card stored before Slack made the thumbnail becomes the picture through file info when its topic opens', async ({ juno, win, fake }) => {
  fake.addChannel({ id: 'C0PHOTOS', name: 'photos', messages: [{ user: 'U0LEO', text: 'Photos from the offsite go here.', ago: 3 * DAY_MINUTES }] })
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  // Two days old and without thumbnails: written as it arrives, it is too old to be asked about then.
  fake.holdThumbnails()
  fake.resetCalls()
  fake.injectMedia({ channel: 'C0PHOTOS', user: 'U0LEO', text: 'The venue floor plan', ago: 2 * DAY_MINUTES, media: [{ name: 'floor-plan.png', width: 800, height: 600 }] })
  fake.releaseThumbnails({ event: 'none' })
  await win.waitForTimeout(3_000)
  expect(fake.calls.filter((call) => call.method === 'files.info')).toHaveLength(0)

  await juno.sidebar.row(PHOTOS_MAIN).open()
  const row = topic.message('The venue floor plan')
  await row.scrollIntoViewIfNeeded()
  const image = row.getByRole('button', { name: 'Open floor-plan.png' })
  await expect(image.locator('img[src^="juno://files/"]')).toHaveCount(1, { timeout: 20_000 })
  expect(fake.calls.filter((call) => call.method === 'files.info').length).toBeGreaterThan(0)
  expect(fake.calls.filter((call) => call.method === 'conversations.history' && call.args['_x_reason'] === 'file')).toHaveLength(0)
  expect(fake.calls.filter((call) => call.method === 'files.info').every((call) => call.ok)).toBe(true)
  expect(await image.boundingBox()).toMatchObject({ width: 320, height: 240 })
})

syncedTest('reopening a topic retries an image after its background lookups ran out', async ({ juno, win, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  fake.holdThumbnails()
  fake.resetCalls()
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Slow image processing', media: [{ name: 'late.png', width: 800, height: 600 }] })
  await expect(topic.message('Slow image processing').locator('[data-file-card]')).toHaveCount(1)
  await expect.poll(() => fake.calls.filter((call) => call.method === 'conversations.history' && call.args['_x_reason'] === 'file').length, { timeout: 60_000 }).toBe(4)
  await win.waitForTimeout(1_000)
  // No message update or file event arrives, and the next history page is newer than this message.
  fake.releaseThumbnails({ event: 'none' })
  await juno.sidebar.row('Proposal: cut offline mode').open()
  await juno.sidebar.row(ENG_MAIN).open()
  const image = topic.message('Slow image processing').getByRole('button', { name: 'Open late.png' })
  await expect(image).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => image.locator('img').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0)
})

syncedTest('images and videos in #eng show inline and open full screen, and a partial file becomes the picture', async ({ juno, win, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await test.step('a video plays inline with its poster, and opens full screen', async () => {
    fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Recording of the demo', media: [{ name: 'demo.mp4', width: 1280, height: 720, kind: 'video' }] })
    const row = topic.message('Recording of the demo')
    const player = row.locator('[data-inline-video] video')
    await expect(player).toHaveCount(1)
    await expect(row.locator('[data-file-card]')).toHaveCount(0)
    // Reserved from the poster's size; the poster comes through main on the Slack session, as images do.
    expect(await row.locator('[data-inline-video]').boundingBox()).toMatchObject({ width: 360, height: 203 })
    const poster = await player.getAttribute('poster')
    expect(poster).toMatch(/^juno:\/\/files\/[^/]+\/poster\?url=/)
    expect(await player.getAttribute('src')).toMatch(/^juno:\/\/files\/[^/]+\/video\?url=/)
    // Loaded as an image, as the player loads it: a real picture of the poster's size.
    expect(await naturalSize(win, poster!)).toEqual({ width: 1280, height: 720 })

    const open = row.getByRole('button', { name: 'Open demo.mp4 full screen' })
    await open.click()
    const viewer = win.getByRole('dialog')
    await expect(viewer.locator('video[poster^="juno://files/"]')).toHaveCount(1)
    await expect(viewer.locator('[data-viewer-name]')).toHaveText('demo.mp4')
    await win.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(open).toBeFocused()
  })
  await test.step('images and a video from the socket open full screen, and the arrow keys and Esc move through and close it', async () => {
    const media = [{ name: 'before.png', width: 900, height: 600 }, { name: 'after.png', width: 900, height: 600 }, { name: 'walkthrough.mp4', width: 1280, height: 720, kind: 'video' as const }]
    fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Before and after the fix', media })
    const row = topic.message('Before and after the fix')
    await expect(row.locator('[data-thumbnail-grid]')).toHaveAttribute('data-count', '3')
    const first = row.getByRole('button', { name: 'Open before.png' })
    await first.click()
    const viewer = win.getByRole('dialog')
    const current = viewer.locator('[data-viewer-item]')
    await expect(current).toHaveAttribute('data-viewer-item', '1')
    await win.keyboard.press('ArrowRight')
    await expect(current).toHaveAttribute('data-viewer-item', '2')
    await win.keyboard.press('ArrowRight')
    await expect(current).toHaveAttribute('data-viewer-item', '3')
    await expect(current.locator('video')).toHaveCount(1)
    await win.keyboard.press('ArrowLeft')
    await expect(current).toHaveAttribute('data-viewer-item', '2')
    await win.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(first).toBeFocused()
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
    await expect(image.locator('img[src^="juno://files/"]')).toHaveCount(1, { timeout: 15_000 })
    await expect.poll(() => image.locator('img').evaluate((node: HTMLImageElement) => node.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
    expect(await image.boundingBox()).toMatchObject({ width: 360, height: 225 })
    await expect(row.locator('[data-file-card]')).toHaveCount(0)
  })
})

// The viewer covers only its tab's topic, so the sidebar and the tab strip stay usable while it is open, and each
// tab keeps its own viewer at its own item while another tab shows, even after its topic unmounts (SPEC 8, "Opening").
syncedTest('the viewer covers only its tab, and each tab keeps its own picture open', async ({ juno, win, fake }) => {
  const { sidebar, tabs, topic } = juno
  await sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Rack photos', media: [{ name: 'rack-front.png', width: 900, height: 600 }, { name: 'rack-back.png', width: 900, height: 600 }] })
  await topic.message('Rack photos').getByRole('button', { name: 'Open rack-front.png' }).click()
  const viewer = win.getByRole('dialog')
  await expect(viewer.locator('[data-viewer-item]')).toHaveAttribute('data-viewer-item', '1')
  await win.keyboard.press('ArrowRight')
  await expect(viewer.locator('[data-viewer-item]')).toHaveAttribute('data-viewer-item', '2')
  await expect(viewer).not.toHaveAttribute('aria-modal')
  // The dialog fills the topic, not the window.
  const view = win.locator('[data-topic-view]').filter({ visible: true })
  expect(await viewer.boundingBox()).toEqual(await view.boundingBox())
  expect((await viewer.boundingBox())!.y).toBeGreaterThan(0)

  // The sidebar is not under the viewer: ⌘-click opens another topic in a new tab, with no viewer there.
  await sidebar.row('#product').openInNewTab()
  await tabs.expectCount(2)
  await tabs.expectActive('product')
  await expect(viewer).toHaveCount(0)
  fake.injectMedia({ channel: 'C0PRODUCT', user: 'U0MAYA', text: 'Pricing page mock', media: [{ name: 'pricing.png', width: 800, height: 800 }] })
  await topic.message('Pricing page mock').getByRole('button', { name: 'Open pricing.png' }).click()
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('pricing.png')

  // Back through the strip: the first tab still shows its picture at the same item, and the second keeps its own.
  await tabs.select('eng')
  await tabs.expectActive('eng')
  await expect(viewer).toHaveCount(1)
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('rack-back.png')
  await expect(viewer.locator('[data-viewer-item]')).toHaveAttribute('data-viewer-item', '2')

  // Five more topic tabs: the first two leave the five kept mounted, and their viewers with them.
  const others = ['#incidents', '#design-review', '#hiring', 'Rina finished the onsite', 'Draft plan is in the doc']
  for (const [index, title] of others.entries()) {
    await sidebar.row(title).openInNewTab()
    await tabs.expectCount(3 + index)
  }
  await expect(win.locator('[data-media-viewer]')).toHaveCount(0)
  // Each comes back mounted afresh, at its own item.
  await tabs.select('eng')
  await tabs.expectActive('eng')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('rack-back.png')
  await expect(viewer.locator('[data-viewer-item]')).toHaveAttribute('data-viewer-item', '2')
  await win.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await tabs.select('product')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('pricing.png')
})

// An image zooms inside its box (SPEC 8, "Zoom"): a double-click goes to 2.5x and back, a pinch zooms, and a drag pans
// without closing the viewer, even when it ends over the backdrop.
syncedTest('a picture in the viewer zooms with a double-click and a pinch, and pans with a drag', async ({ juno, win, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
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
  expect((await view()).e).not.toBe(before.e)

  await frame.dblclick()
  await expect.poll(async () => (await view()).a).toBe(1)
  expect((await view()).e).toBe(0)

  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.keyboard.down('Control')
  await win.mouse.wheel(0, -100)
  await win.keyboard.up('Control')
  await expect.poll(async () => (await view()).a).toBeGreaterThan(2)
  await win.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
})
