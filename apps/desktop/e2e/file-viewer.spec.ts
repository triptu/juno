// What main does for files and menus in #eng, in one launch.
//
// A pasted image is staged by main (`juno://uploads`) and sent once with the
// message. Its sizes, drops, the picker and Retry are in the browser and DOM
// lanes (`attachments.spec.ts`, `dom/attachments.test.ts`).
//
// Files other than pictures in the media viewer (SPEC section 8, "Other
// files"; architecture 9): a PDF and an HTML page open from their cards in
// the viewer, read from main's `juno://files/<id>/content` on the Slack
// session; a zip gets Quick Look. Markdown, CSV and audio cards are in the DOM
// lane (`dom/file-viewer.test.ts`).
//
// Image menus: main's native menu on a picture copies its data, downloads it
// and opens a temporary copy.
//
// The text menu (SPEC 15, "Feels native"): main opens the macOS menu of Cut,
// Copy, Paste and spelling on fields and selected text that no Juno menu took.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import { expect, test, type Fixtures } from './fixtures'
import { schemeSrc, type Juno } from './driver/juno'
import { chart, chip, chips, paste } from './attach'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 180_000 })

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

// Main serves the PDF, sees Esc pressed inside a frame, shows Quick Look and opens the image and text menus: Electron only.
// The viewers go first: the Quick Look step counts downloads, and the image menu downloads a file.
test('in #eng: a pasted image is sent once, a PDF opens in Chromium’s PDF viewer and an HTML file in a sandboxed frame, Quick Look leaves Downloads alone, then the image menus and the text menu', { tag: '@electron' }, async ({ juno, fake }) => {
  await test.step('a pasted image is staged by main and goes with the message, once', async () => {
    const { topic } = juno
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    await paste(topic.composer, [chart()])
    await expect(chip(topic, 'chart.png')).toBeVisible()
    await expect(topic.root.locator(`[data-composer] img${schemeSrc('uploads')}`)).toHaveCount(1)
    await topic.send('The chart for Thursday')
    await expect(chips(topic)).toHaveCount(0)
    await topic.expectSent('The chart for Thursday')
    const row = topic.message('The chart for Thursday')
    await expect(row.getByRole('button', { name: 'Open chart.png' }).locator(`img${schemeSrc('files')}`)).toHaveCount(1, { timeout: 15_000 })
    const shares = fake.calls.filter((call) => call.method === 'files.share')
    expect(shares).toHaveLength(1)
    const posted = fake.messages('C0ENG').filter((m) => m.client_msg_id === shares[0]!.args['client_msg_id'])
    expect(posted.map((m) => m.files?.map((f) => f.name))).toEqual([['chart.png']])
    expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toEqual([])
  })

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

  await test.step('image menus copy image data, download, open a temporary copy and open the viewer; text keeps its message menu', () => imageMenus(juno, fake))

  // Each text menu step starts with an empty composer; the last counts menus from its own baseline.
  await juno.sidebar.row(ENG_MAIN).open()
  await test.step('the composer has Cut, Copy and Paste, and Paste pastes', () => pasteFromTheMenu(juno))
  await test.step('a misspelled word offers guesses, and picking one replaces it', () => pickASpellingGuess(juno))
  await test.step("Juno's own menus win over the text menu, with text selected", () => junoMenusWin(juno))
})

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

async function imageMenus(juno: Juno, fake: Fixtures['fake']): Promise<void> {
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
}

/** Where the field's first word is: its padding, then half a line down. */
function firstWord(field: Locator): Promise<{ readonly x: number; readonly y: number }> {
  return field.evaluate((element) => {
    const style = getComputedStyle(element)
    const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2
    return { x: Number.parseFloat(style.paddingLeft) + 8, y: Number.parseFloat(style.paddingTop) + line / 2 }
  })
}

const EDIT_ITEMS = ['Cut', 'Copy', 'Paste', 'Paste and Match Style', 'Select All']

/** A menu's labels whether on or off: the test seam writes an off item as "(label)". */
const names = (labels: ReadonlyArray<string>): string[] => labels.map((label) => label.replace(/^\((.*)\)$/, '$1'))

async function pasteFromTheMenu(juno: Juno): Promise<void> {
  const composer = juno.topic.composer
  await composer.fill('Hello ')
  await juno.topic.caretToEnd()
  await juno.app.evaluate(({ clipboard }) => clipboard.writeText('from the menu'))

  await juno.chooseNextMenuItem('paste')
  const box = await composer.boundingBox()
  // Past the end of the text, so nothing is selected.
  const point = { x: box!.width - 24, y: (await firstWord(composer)).y }
  await composer.click({ button: 'right', position: point })
  const menu = await juno.lastMenu()
  // Nothing is selected, so Cut and Copy are off.
  expect(menu.labels).toEqual(['(Cut)', '(Copy)', 'Paste', 'Paste and Match Style', 'Select All'])
  // It opens where the right-click was.
  expect(Math.abs(menu.at!.x - (box!.x + point.x))).toBeLessThanOrEqual(1)
  expect(Math.abs(menu.at!.y - (box!.y + point.y))).toBeLessThanOrEqual(1)
  await expect(composer).toHaveValue('Hello from the menu')
}

async function pickASpellingGuess(juno: Juno): Promise<void> {
  const composer = juno.topic.composer
  await composer.fill('')
  await composer.click()
  // Native spelling checks the sentence's language and rechecks the word alone.
  await composer.pressSequentially('recieve message is ready to send ')
  const word = await firstWord(composer)

  // An early right-click can leave macOS's asynchronous check without a
  // spelling marker. Make another edit outside the word between attempts
  // so the checker runs again. Linux may still be loading its dictionary.
  await expect
    .poll(
      async () => {
        await juno.chooseNextMenuItem(null)
        await composer.click({ button: 'right', position: word })
        const { labels } = await juno.lastMenu()
        if (process.platform === 'darwin' && !labels.includes('receive')) {
          await juno.topic.caretToEnd()
          await composer.press('Space')
          await composer.press('Backspace')
        }
        return labels
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toEqual(expect.arrayContaining(['Learn Spelling', 'receive']))
  const { labels } = await juno.lastMenu()
  expect(labels).toContain('receive')
  // Guesses come first, then Learn Spelling, then the edit items.
  expect(labels.indexOf('receive')).toBeLessThan(labels.indexOf('Learn Spelling'))
  // Paste is off when the clipboard is empty, so ignore whether each is on.
  expect(names(labels.slice(-5))).toEqual(EDIT_ITEMS)

  await juno.chooseNextMenuItem('replace:receive')
  await composer.click({ button: 'right', position: word })
  await juno.lastMenu()
  await expect(composer).toHaveValue('receive message is ready to send ')
}

async function junoMenusWin(juno: Juno): Promise<void> {
  const composer = juno.topic.composer
  await composer.fill('')
  const text = 'Words to select in a message'
  await juno.topic.send(text)
  await juno.topic.expectSent(text)
  const words = juno.topic.message(text).getByText(text)
  const selected = () => juno.win.evaluate(() => window.getSelection()?.toString() ?? '')
  const asked = await juno.menusAsked()

  // The message menu, on its selected text: Juno's own, not a native menu, and it copies the selection.
  await words.selectText()
  const message = await juno.topic.chooseInMessageMenu(text, null)
  expect(message.labels).toContain('Copy')
  expect(message.labels).not.toContain('Paste')

  // A tab's menu, and a sidebar row's, while the message text stays selected.
  await words.selectText()
  expect(await selected()).toContain(text)
  await juno.chooseNextMenuItem(null)
  await juno.tabs.tab('eng').click({ button: 'right' })
  expect((await juno.lastMenu()).labels).toContain('Close tab')

  await words.selectText()
  await juno.chooseNextMenuItem(null)
  await juno.sidebar.row('#eng').root.click({ button: 'right', position: { x: 40, y: 20 } })
  expect((await juno.lastMenu()).labels).toContain('Open in new tab')

  // Then the composer's text menu. Main takes right-clicks in order, so a text
  // menu opened by any of the above would be counted before this one.
  await juno.chooseNextMenuItem(null)
  await juno.topic.composer.click({ button: 'right' })
  expect(names((await juno.lastMenu()).labels)).toEqual(EDIT_ITEMS)
  expect((await juno.menusAsked()) - asked).toBe(3)
}
