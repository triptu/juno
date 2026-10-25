// An image's native menu inside a peek (SPEC 7, "Pictures"): Open opens the
// picture in the topic's viewer. Copy, Download and Open in Preview need
// main and the clipboard, so they are the Electron lane's (image-menu.spec.ts).
import { expect } from './expect'
import { domTest } from './test'

domTest('Open from an image menu in a peek opens its topic viewer', async ({ juno, fake }) => {
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Peek image menu sample', media: [{ name: 'peek-image-menu.png', width: 800, height: 600 }] })
  await juno.sidebar.expectTop('#eng')
  await juno.sidebar.row('#eng').peek()
  const image = juno.peek.root.locator('[data-thumbnail]')
  await expect(image).toBeVisible()

  const before = await juno.menusAsked()
  await juno.chooseNextMenuItem('open')
  await image.click({ button: 'right' })
  expect((await juno.lastMenu()).labels).toEqual(['Open', 'Open in Preview', '-', 'Copy image', 'Download'])
  expect(await juno.menusAsked()).toBe(before + 1)
  await expect(juno.win.locator('[data-media-viewer] [data-viewer-name]')).toHaveText('peek-image-menu.png')
  await juno.peek.release()
})
