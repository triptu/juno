// The web panel: a plain click on a web link in a message opens it in a
// panel beside the topic; ⌘-click, Google apps and a window too narrow for
// the panel open it in the browser, as does every link with Open links in
// Juno off. ⌘K hides the page while the palette is open, the panel belongs
// to its tab, and close takes it away.
import type { FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const DOC = 'https://docs.google.com/document/d/1fakeDocId/edit'

const page = (fake: FakeSlack) => `${fake.url}/web/page`

/** Seeds a reply in the Postgres thread with a link to the fake page and one to a Google doc. */
function seedLinks(fake: FakeSlack): void {
  const root = fake.messages('C0ENG').find((message) => message.text?.includes(POSTGRES))!
  fake.workspace.post({
    channel: 'C0ENG',
    user: 'U0MAYA',
    threadTs: root.ts,
    text: `Have a look at <${page(fake)}|the fake page> and <${DOC}|the doc>.`,
    silent: true,
  })
}

/** Signs in, opens the Postgres thread and returns its links by their words. */
async function openLinks(juno: Juno) {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  const links = juno.topic.message('Have a look at').locator('[data-msg-text] a')
  return (text: string) => links.filter({ hasText: text })
}

// One launch: the panel's life in a wide window, then the narrow window, then Open links in Juno off.
test('a click opens a link in the web panel; ⌘-click, Google apps, a narrow window and Open links in Juno off open the browser; ⌘K hides the page; close ends it', async ({ juno, fake }) => {
  seedLinks(fake)
  const link = await openLinks(juno)
  const setSize = (width: number, height: number) => juno.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height })
  // Wide enough that the panel sits beside the topic and leaves its links clickable.
  await setSize(1440, 900)
  const panel = juno.win.getByTestId('web-panel')
  const url = page(fake)

  await test.step('a click opens the panel; ⌘-click and Google apps open the browser; ⌘K hides the page; the panel belongs to its tab; close ends it', async () => {
    await link('the fake page').click()
    await expect(panel).toBeVisible()
    await expect(juno.win.getByTestId('web-panel-title')).toHaveText('Fake page')
    await expect.poll(() => juno.webPanel()).toEqual({ url, visible: true })
    expect(await juno.browserLinks()).toEqual([])

    // ⌘-click goes to the browser and leaves the panel's page as it was.
    await link('the fake page').click({ modifiers: ['Meta'] })
    await expect.poll(() => juno.browserLinks()).toEqual([url])
    expect(await juno.webPanel()).toEqual({ url, visible: true })

    // The page is a native view drawn over the app, so it hides while the palette is open.
    await juno.palette.open()
    await expect.poll(() => juno.webPanel()).toEqual({ url, visible: false })
    await juno.palette.input.press('Escape')
    await juno.palette.expectClosed()
    await expect.poll(() => juno.webPanel()).toEqual({ url, visible: true })

    // The panel belongs to its tab.
    await juno.tabs.newTabButton.click()
    await juno.tabs.expectActive('Home')
    await expect(panel).toBeHidden()
    await expect.poll(() => juno.webPanel()).toEqual({ url, visible: false })
    await juno.tabs.select(POSTGRES)
    await expect(panel).toBeVisible()
    await expect.poll(() => juno.webPanel()).toEqual({ url, visible: true })

    // Google refuses sign-in in embedded pages, so its apps open in the browser.
    await link('the doc').click()
    await expect.poll(() => juno.browserLinks()).toEqual([url, DOC])
    expect(await juno.webPanel()).toEqual({ url, visible: true })

    await juno.win.getByTestId('web-panel-close').click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => juno.webPanel()).toEqual({ url: null, visible: false })
  })

  await test.step('in a window too narrow for the panel beside the topic, a click opens the browser', async () => {
    // The smallest window the app allows.
    await setSize(720, 480)
    await link('the fake page').click()
    await expect.poll(() => juno.browserLinks()).toEqual([url, DOC, url])
    await expect(panel).toHaveCount(0)
    expect(await juno.webPanel()).toEqual({ url: null, visible: false })
  })

  await test.step('with Open links in Juno off, the open panel closes and a click opens the browser', async () => {
    await setSize(1440, 900)
    await link('the fake page').click()
    await expect(panel).toBeVisible()

    await juno.openSettings('General')
    const toggle = juno.settings.root.getByRole('switch', { name: 'Open links in Juno' })
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await expect(toggle).not.toBeChecked()
    await expect.poll(() => juno.webPanel()).toEqual({ url: null, visible: false })
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    await expect(panel).toHaveCount(0)

    await link('the fake page').click()
    await expect.poll(() => juno.browserLinks()).toEqual([url, DOC, url, url])
    await expect(panel).toHaveCount(0)
  })
})
