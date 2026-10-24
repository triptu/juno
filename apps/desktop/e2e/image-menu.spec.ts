import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.use({ synced: true })

const IMAGE_ITEMS = ['Open', 'Open in Preview', '-', 'Copy image', 'Download']

async function choose(juno: Juno, image: Locator, item: string | null): Promise<string[]> {
  const before = await juno.menusAsked()
  await juno.chooseNextMenuItem(item)
  await image.click({ button: 'right' })
  const menu = await juno.lastMenu()
  expect(await juno.menusAsked()).toBe(before + 1)
  return menu.labels
}

async function clipboardImageSize(juno: Juno) {
  return juno.app.evaluate(async ({ clipboard, nativeImage }) => {
    const items = await clipboard.read()
    const item = items.find((item) => item.types.includes('image/png'))
    if (item === undefined) return null
    const bytes = await (await item.getType('image/png')).arrayBuffer()
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    return image.isEmpty() ? null : image.getSize()
  })
}

test('image menus copy image data, download, open a temporary copy and open the viewer; text keeps its message menu', { tag: '@electron' }, async ({ juno, fake }) => {
  await juno.sidebar.row('#eng').open()
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Image menu sample', media: [{ name: 'image-menu.png', width: 800, height: 600 }] })
  const row = juno.topic.message('Image menu sample')
  const image = row.locator('[data-thumbnail]')
  await expect(image).toBeVisible()

  await juno.app.evaluate(({ clipboard }) => clipboard.clear())
  expect(await choose(juno, image, 'copy-image')).toEqual(IMAGE_ITEMS)
  await expect.poll(() => clipboardImageSize(juno)).toEqual({ width: 800, height: 600 })
  await expect(juno.win.locator('[data-media-viewer]')).toHaveCount(0)

  expect(await choose(juno, image, 'download')).toEqual(IMAGE_ITEMS)
  const downloads = await juno.app.evaluate(({ app }) => `${app.getPath('userData')}/Downloads`)
  await expect.poll(async () => (await readFile(join(downloads, 'image-menu.png')).catch(() => Buffer.alloc(0))).byteLength).toBeGreaterThan(0)

  expect(await choose(juno, image, 'open-in-preview')).toEqual(IMAGE_ITEMS)
  await expect.poll(() => juno.app.evaluate(() => (globalThis as unknown as { junoTest: { opened: string[] } }).junoTest.opened.length)).toBe(1)
  const opened = await juno.app.evaluate(() => (globalThis as unknown as { junoTest: { opened: string[] } }).junoTest.opened[0]!)
  expect(opened).toContain('/Temp/')
  expect((await readFile(opened)).equals(await readFile(join(downloads, 'image-menu.png')))).toBe(true)

  // The message's text keeps the message's own menu, not a native image menu.
  const asked = await juno.menusAsked()
  const text = await juno.topic.messageMenu('Image menu sample')
  const textMenu = await text.labels()
  expect(textMenu).toContain('Start thread')
  expect(textMenu).not.toContain('Copy image')
  await text.close()
  expect(await juno.menusAsked()).toBe(asked)

  expect(await choose(juno, image, 'open')).toEqual(IMAGE_ITEMS)
  const viewer = juno.win.locator('[data-media-viewer]')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('image-menu.png')
  await juno.app.evaluate(({ clipboard }) => clipboard.clear())
  expect(await choose(juno, viewer.locator('[data-viewer-item]'), 'copy-image')).toEqual(IMAGE_ITEMS.slice(1))
  await expect.poll(() => clipboardImageSize(juno)).toEqual({ width: 800, height: 600 })
  await viewer.getByRole('button', { name: 'Close', exact: true }).click()
})

test('Open from an image menu in a peek opens its topic viewer', async ({ juno, fake }) => {
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Peek image menu sample', media: [{ name: 'peek-image-menu.png', width: 800, height: 600 }] })
  await juno.sidebar.row('#eng').peek()
  const image = juno.peek.root.locator('[data-thumbnail]')
  await expect(image).toBeVisible()

  expect(await choose(juno, image, 'open')).toEqual(IMAGE_ITEMS)
  await expect(juno.win.locator('[data-media-viewer] [data-viewer-name]')).toHaveText('peek-image-menu.png')
  await juno.peek.release()
})
