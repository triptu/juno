// Files other than pictures in the media viewer (SPEC section 8, "Other
// files"; architecture 9): a PDF, an HTML page, a Markdown snippet, a CSV
// and audio open from their cards in the viewer, read from main's
// `juno://files/<id>/content` on the Slack session; a zip gets Quick Look.
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

test('a PDF opens in Chromium’s PDF viewer from the content main serves as a PDF', async ({ juno, fake }) => {
  const row = await postFiles({ juno, fake }, 'The capacity review', ['pdf'])
  // The card keeps Download.
  await expect(row.getByRole('button', { name: 'Download capacity-review.pdf' })).toBeVisible()
  const viewer = await openCard({ juno }, row, 'capacity-review.pdf')
  const frame = viewer.locator('[data-viewer-kind="pdf"] iframe')
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

test('an HTML file shows in a sandboxed frame where its script does not run', async ({ juno, fake }) => {
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

test('a Markdown snippet shows rendered and a CSV as a table, and the arrows move between them', async ({ juno, fake }) => {
  const row = await postFiles({ juno, fake }, 'Notes and metrics', ['markdown', 'csv'])
  const viewer = await openCard({ juno }, row, 'release-notes.md')
  // The snippet's preview is cut short; the viewer reads the whole file.
  await expect(viewer.locator('[data-viewer-text]').getByText('Release 4.2', { exact: true })).toBeVisible()
  await expect(viewer.locator('[data-viewer-text]').getByText('Questions go to the release thread.')).toBeVisible()
  await expect(viewer.locator('[data-viewer-meta]')).toHaveText(/ · 1 of 2$/)
  // Its links are in the tab order and open as a message's do: ⌘-click in the browser.
  const link = viewer.locator('[data-viewer-text]').getByRole('link', { name: 'the tracker' })
  await expect(link).not.toHaveAttribute('tabindex', '-1')
  await link.click({ modifiers: ['Meta'] })
  await expect.poll(() => juno.browserLinks()).toContain('https://example.com/tracker')

  await juno.win.keyboard.press('ArrowRight')
  await expect(viewer.locator('[data-viewer-name]')).toHaveText('cluster-metrics.csv')
  const table = viewer.getByRole('table')
  await expect(table.getByRole('columnheader')).toHaveCount(40)
  await expect(table.getByRole('columnheader').first()).toHaveText('host')
  await expect(table.getByRole('row')).toHaveCount(81)
  // A quoted field keeps its comma.
  await expect(table.getByRole('cell', { name: 'eu-west, 1' }).first()).toBeVisible()
  // The table scrolls inside the stage; the stage never grows.
  const scroller = viewer.locator('[data-viewer-text]')
  const sizes = await scroller.evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight, window: window.innerHeight }))
  expect(sizes.scroll).toBeGreaterThan(sizes.client)
  expect(sizes.client).toBeLessThan(sizes.window)
})

test('audio and a voice clip play in their cards and in the viewer', async ({ juno, fake }) => {
  const row = await postFiles({ juno, fake }, 'Stand-up recording', ['audio'])
  await expect(row.locator('audio[data-inline-audio]')).toHaveAttribute('src', /^juno:\/\/files\/[^/]+\/audio\?url=/)
  await expect(row.locator('[data-file-card]')).toContainText('5:00')
  const viewer = await openCard({ juno }, row, 'standup-recording.wav')
  const player = viewer.locator('audio[controls]')
  await expect(player).toHaveCount(1)
  await expect(viewer.locator('[data-viewer-item]')).toContainText('5:00')
  await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.duration), { timeout: 15_000 }).toBeCloseTo(300, 0)
  await juno.win.keyboard.press('Escape')

  fake.control('injectFiles', { channel: 'C0ENG', text: 'Voice note', files: [{ kind: 'voice' }] })
  const voice = juno.topic.message('Voice note')
  // A voice clip plays Slack's transcoded copy.
  await expect(voice.locator('audio[data-inline-audio]')).toHaveAttribute('src', /aac%3D1$/)
})

test('Quick Look on a zip asks main to show it in the preview window, and nothing goes into Downloads', async ({ juno, fake }) => {
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
