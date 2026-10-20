import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark'] as const) {
  test(`composer formatting keeps glyph geometry in ${theme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.goto(`/#/Composer?__state=markup/mixed&theme=${theme}`)
    const field = page.locator('[data-composer] textarea')
    const code = page.getByTestId('textarea-code-block')
    const quote = page.getByTestId('textarea-quote')
    await expect(code.first()).toBeVisible()
    await expect(quote.first()).toBeVisible()
    expect(await code.first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(await quote.first().evaluate((el) => getComputedStyle(el).backgroundColor))
    await expect(code.first()).not.toHaveCSS('box-shadow', 'none')
    await expect(page.getByTestId('textarea-bold').first()).toHaveCSS('-webkit-text-stroke-width', /0\./)
    await page.evaluate(() => document.fonts.ready)
    const geometry = await page.locator('[data-textarea-layer]').evaluate((layer) => {
      const rect = layer.getBoundingClientRect()
      const clone = layer.cloneNode(true) as HTMLElement
      Object.assign(clone.style, { position: 'fixed', inset: 'auto', top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, visibility: 'hidden' })
      for (const node of clone.querySelectorAll('[data-testid="textarea-code-block"], [data-testid="textarea-quote"]')) node.removeAttribute('class')
      layer.parentElement!.append(clone)
      const boxes = (root: Element) => {
        const out: number[][] = []
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const node = walker.currentNode
          for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
            const range = document.createRange()
            range.setStart(node, i)
            range.setEnd(node, i + 1)
            const box = range.getBoundingClientRect()
            out.push([box.x, box.y, box.width])
          }
        }
        return out
      }
      const styled = boxes(layer), plain = boxes(clone)
      clone.remove()
      return Math.max(...styled.flatMap((box, i) => box.map((value, axis) => Math.abs(value - plain[i]![axis]!))))
    })
    expect(geometry).toBeLessThan(0.5)
    await page.locator('[data-fixture-frame]').screenshot({ path: testInfo.outputPath(`composer-${theme}.png`) })
    for (const text of ['שלום', 'שלום hello עולם', 'hello שלום world']) {
      await field.fill(text)
      const layer = page.locator('[data-textarea-layer]')
      await expect(layer).toHaveText(text)
      expect(await layer.evaluate((el) => getComputedStyle(el).direction)).toBe(await field.evaluate((el) => getComputedStyle(el).direction))
    }
  })
}
