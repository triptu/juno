// Files other than pictures in the media viewer (SPEC section 8, "Other
// files"; architecture 9): a PDF, an HTML page, a Markdown snippet, a CSV
// and audio open from their cards in the viewer, read from main's
// `juno://files/<id>/content` on the Slack session; a zip gets Quick Look.
// Markdown, CSV and audio cards are in the DOM lane (`dom/file-viewer.test.ts`).
import { expect, test, type Fixtures } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'

type Kind = 'pdf' | 'html' | 'markdown' | 'csv' | 'json' | 'audio' | 'voice' | 'zip'

/** Opens #eng with a message from Maya carrying one file of each kind given. */
async function postFiles({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>, text: string, kinds: ReadonlyArray<Kind>) {
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
  fake.control('injectFiles', { channel: 'C0ENG', text, files: kinds.map((kind) => ({ kind })) })
  const row = juno.topic.message(text)
  await expect(row.locator('[data-file-card]')).toHaveCount(kinds.length)
  return row
}

/**
 * Esc as the keyboard sends it, through main (`webContents.sendInputEvent`).
 * Playwright's keys go straight to the page and skip `before-input-event`,
 * the only place a key pressed inside a frame can be seen.
 */
async function pressEscape({ juno }: Pick<Fixtures, 'juno'>) {
  await juno.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((each) => each.isVisible())!
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  })
}

async function openCard({ juno }: Pick<Fixtures, 'juno'>, row: ReturnType<Fixtures['juno']['topic']['message']>, name: string) {
  const open = row.getByRole('button', { name: `Open ${name}` })
  await open.scrollIntoViewIfNeeded()
  await open.click()
  const viewer = juno.win.getByRole('dialog')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText(name)
  return viewer
}

// Main serves the PDF, sees Esc pressed inside a frame and shows Quick Look: Electron only.
test('a PDF opens in Chromium’s PDF viewer, an HTML file in a sandboxed frame, Esc closes both from inside, and Quick Look on a zip leaves Downloads alone', { tag: '@electron' }, async ({ juno, fake }) => {
  await test.step('a PDF opens in Chromium’s PDF viewer from the content main serves as a PDF', async () => {
    const row = await postFiles({ juno, fake }, 'The capacity review', ['pdf'])
    // The card keeps Download.
    await expect(row.getByRole('button', { name: 'Download capacity-review.pdf' })).toBeVisible()
    const viewer = await openCard({ juno }, row, 'capacity-review.pdf')
    const frame = viewer.locator('[data-viewer-kind="pdf"] iframe')
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    const src = await frame.getAttribute('src')
    expect(src).toMatch(/^juno:\/\/files\/[^/]+\/content\/capacity-review\.pdf\?url=/)
    const answer = await juno.win.evaluate(async (url) => {
      const response = await fetch(url)
      return { type: response.headers.get('content-type'), start: new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5)) }
    }, src!)
    expect(answer).toEqual({ type: 'application/pdf', start: '%PDF-' })
    // Esc closes it from inside Chromium's PDF viewer too.
    await frame.focus()
    await expect.poll(() => juno.win.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME')
    await pressEscape({ juno })
    await expect(viewer).toHaveCount(0)
  })

  await test.step('an HTML file shows in a sandboxed frame where its script does not run', async () => {
    const row = await postFiles({ juno, fake }, 'This week’s digest', ['html'])
    const viewer = await openCard({ juno }, row, 'weekly-digest.html')
    const frame = viewer.locator('[data-viewer-kind="html"] iframe')
    await expect(frame).toHaveAttribute('sandbox', '')
    const page = viewer.frameLocator('[data-viewer-kind="html"] iframe')
    await expect(page.getByRole('heading', { name: 'Weekly digest' })).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-script-ran', /.*/)
    await expect(viewer.getByRole('button', { name: 'Open in browser' })).not.toHaveAttribute('aria-disabled', 'true')
    // Esc closes it from inside the page too, which keeps its keys from the app.
    await page.locator('body').click()
    await pressEscape({ juno })
    await expect(viewer).toHaveCount(0)
  })

  await test.step('Quick Look on a zip asks main to show it in the preview window, and nothing goes into Downloads', async () => {
    const row = await postFiles({ juno, fake }, 'Logs from the nightly build', ['zip'])
    await expect(row.getByRole('button', { name: /^Open / })).toHaveCount(0)
    await row.getByRole('button', { name: 'Quick Look build-logs.zip' }).click()
    const looked = () => juno.app.evaluate(() => (globalThis as unknown as { junoTest: { quickLooked: Array<{ path: string; name: string }> } }).junoTest.quickLooked.slice())
    await expect.poll(looked, { timeout: 15_000 }).toHaveLength(1)
    const [shown] = await looked()
    expect(shown!.name).toBe('build-logs.zip')
    expect(shown!.path).toMatch(/Temp\/[0-9a-f]{16}\/build-logs\.zip$/)
    // Again, into the same folder: the copy is replaced, not added to.
    await row.getByRole('button', { name: 'Quick Look build-logs.zip' }).click()
    await expect.poll(looked, { timeout: 15_000 }).toHaveLength(2)
    expect((await looked())[1]!.path).toBe(shown!.path)
    expect(await juno.app.evaluate(() => (globalThis as unknown as { junoTest: { downloads: string[] } }).junoTest.downloads.length)).toBe(0)
  })
})
