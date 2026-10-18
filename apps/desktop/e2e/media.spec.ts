// Images and videos other people post (SPEC 8, "Images and the media viewer"; architecture 9, "Late
// thumbnails"). Live, a fresh image reaches the socket before Slack has made its thumbnails, and a socket
// message can carry a partial file (`file_access: "check_file_info"`); nothing in the message changes
// later, so Juno asks `files.info` and the card becomes the picture in place.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

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

test('an old card stored before Slack made the thumbnail becomes the picture when its topic opens', async ({ juno, win, fake }) => {
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
  expect(await image.boundingBox()).toMatchObject({ width: 320, height: 240 })
})

// One Main in #eng. The partial file goes last: it holds the next files.info, which the other
// media, injected with their thumbnails and poster, never ask.
test('images and videos in #eng show inline and open full screen, and a partial file becomes the picture', async ({ juno, win, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
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

