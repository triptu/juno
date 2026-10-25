// ⌘K's results while typing (spec section 10, performance 5.3): the list
// never commits empty between one query's results and the next, in each
// search tab, and clearing the field shows the starting rows again. Each
// change to the list is checked as it lands, not on a frame.
import { expect } from './expect'
import { domTest } from './test'

domTest('keeps the rendered results body on every frame while typing unmatched queries in each search tab', async ({ juno, step }) => {
  const { palette } = juno
  const document = juno.win.document
  await palette.open()

  for (const tab of ['All', 'Conversations', 'Messages'] as const) {
    await step(tab, async () => {
      await palette.tab(tab).click()
      await palette.expectResults()
      await expect(palette.rows().first()).toBeVisible()

      // After each change to the page: whether the results list has a body while the field has text.
      const collapsed: string[] = []
      let seen = 0
      const Observer = (juno.win.window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
      const observer = new Observer(() => {
        const query = document.querySelector<HTMLInputElement>('[role="dialog"] [role="combobox"]')?.value ?? ''
        if (query === '') return
        seen++
        const list = document.getElementById('palette-results')
        const body = list !== null && (list.querySelector('[role="option"]') !== null || list.textContent?.includes('No matches.') === true)
        if (!body) collapsed.push(query)
      })
      observer.observe(palette.root.el()!, { subtree: true, childList: true, characterData: true, attributes: true })
      try {
        for (const character of 'zzunmatched 122') {
          await palette.type(character)
          await palette.expectResults()
        }
        await expect(palette.root.getByText('No matches.', { exact: true })).toBeVisible()
        expect(seen).toBeGreaterThan(0)
        expect(collapsed, `${tab}: collapsed commits`).toEqual([])
      } finally {
        observer.disconnect()
      }

      await palette.clear()
      await expect(palette.root.locator('#palette-results')).toContainText(tab === 'Messages' ? 'Recent' : 'Frequent')
      await expect(palette.root.locator('#palette-results')).not.toContainText('No matches.')
      await palette.expectResults()
    })
  }
})
