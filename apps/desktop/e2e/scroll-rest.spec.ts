// The bottom of Main at 2x zoom, which needs Electron's zoom. Resting short of the end and growth during a
// coalesced scrollend are in stick-bottom.spec.ts.
import { expect, test } from './fixtures'
import { openLongMain } from './stickBottomLists'

test('the bottom survives shrinking content and fractional offsets at 2x', { tag: '@electron' }, async ({ juno, win, slack, fake }) => {
  await openLongMain(juno, fake, slack)
  const zoom = 2 / await win.evaluate(() => devicePixelRatio)
  await juno.app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom), zoom)
  expect(await win.evaluate(() => devicePixelRatio)).toBe(2)
  const result = await juno.topic.scroller.evaluate(async (node) => {
    const row = [...node.querySelectorAll<HTMLElement>('[data-message-row]')].at(-1)!
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    row.style.paddingBottom = '160px'
    await frame()
    await frame()
    node.scrollTop = Math.floor(node.scrollTop) - 0.5
    const fractional = node.scrollTop % 1
    row.style.paddingBottom = '80px'
    await frame()
    await frame()
    const shrunk = node.scrollHeight - node.scrollTop - node.clientHeight
    row.style.paddingBottom = '160px'
    await frame()
    await frame()
    const grown = node.scrollHeight - node.scrollTop - node.clientHeight
    row.style.paddingBottom = ''
    return { fractional, shrunk, grown }
  })
  expect(result.fractional).toBe(0.5)
  expect(result.shrunk).toBeLessThanOrEqual(1)
  expect(result.grown).toBeLessThanOrEqual(1)
})
