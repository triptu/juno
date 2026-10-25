// The media viewer per tab (SPEC 8, "Images and the media viewer"): it opens
// in its tab only, not over the sidebar or the other tabs, each tab keeps its
// own picture and item, and a tab mounted afresh opens it again where it
// was. That it fills the topic's box is the browser lane's (media.spec.ts).
import { expect } from './expect'
import { domTest } from './test'

const ENG_MAIN = '#eng'

domTest('the viewer covers only its tab, and each tab keeps its own picture open', async ({ juno, fake }) => {
  const { sidebar, tabs, topic, win } = juno
  await sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', text: 'Rack photos', media: [{ name: 'rack-front.png', width: 900, height: 600 }, { name: 'rack-back.png', width: 900, height: 600 }] })
  await topic.message('Rack photos').getByRole('button', { name: 'Open rack-front.png' }).click()
  // The new message moves #eng to the top. Wait for that move before aiming at #product.
  await sidebar.expectTop(ENG_MAIN)
  const viewer = win.getByRole('dialog')
  await expect(viewer.locator('[data-viewer-item]')).toHaveAttribute('data-viewer-item', '1')
  await win.keyboard.press('ArrowRight')
  await expect(viewer.locator('[data-viewer-item]')).toHaveAttribute('data-viewer-item', '2')
  await expect(viewer).not.toHaveAttribute('aria-modal')

  // The sidebar is not under the viewer: ⌘-click opens another topic in a new tab, with no viewer there.
  await sidebar.row('#product').openInNewTab()
  await tabs.expectCount(2)
  await tabs.expectActive('product')
  await expect(viewer).toHaveCount(0)
  fake.injectMedia({ channel: 'C0PRODUCT', user: 'U0MAYA', text: 'Pricing page mock', media: [{ name: 'pricing.png', width: 800, height: 800 }] })
  await topic.message('Pricing page mock').getByRole('button', { name: 'Open pricing.png' }).click()
  // The new message moves #product to the top. Let the sidebar finish that move before later rows are clicked.
  await sidebar.expectTop('#product')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('pricing.png')

  // Back through the strip: the first tab still shows its picture at the same item, and the second keeps its own.
  await tabs.select('eng')
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
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('rack-back.png')
  await expect(viewer.locator('[data-viewer-item]')).toHaveAttribute('data-viewer-item', '2')
  await win.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await tabs.select('product')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('pricing.png')
})
