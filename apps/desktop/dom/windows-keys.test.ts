// On Windows Ctrl takes ⌘'s place (decision D2): the page's own shortcuts answer to it, their labels say Ctrl, and a
// Ctrl-press on a row opens a new tab, where on the Mac it is the context menu and does nothing.
import { expect } from './expect'
import { domTest } from './test'

const OFFSITE = 'Can eng take the Wednesday afternoon'

domTest('on Windows Ctrl leads the shortcuts and their labels, and Ctrl-click opens a new tab', async ({ juno, step }) => {
  const { palette, sidebar, tabs } = juno

  await step('the title bar names Hide sidebar by its Windows keys', async () => {
    await expect(juno.win.getByRole('button', { name: 'Hide sidebar Ctrl+Shift+S', exact: true })).toBeVisible()
  })

  await step('the palette labels its sections Ctrl+2 and Ctrl+3, and Ctrl+3 shows Messages', async () => {
    await palette.open()
    await palette.expectTab('All')
    await expect(palette.section('Frequent')).toContainText('Ctrl+2')
    await palette.press('Control+3')
    await palette.expectTab('Messages')
    await palette.press('Escape')
    await palette.expectClosed()
  })

  await step('Ctrl-click on a sidebar row opens it in a new tab', async () => {
    const open = (await tabs.titles()).length
    await sidebar.row(OFFSITE).root.click({ modifiers: ['Control'] })
    await tabs.expectCount(open + 1)
  })
}, { windows: true })
