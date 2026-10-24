/**
 * Files on the Slack session (architecture 9, owner decision 10-13).
 *
 * - `juno://files/<file id>/<variant>?url=<Slack file url>`: message
 *   thumbnails and the viewer's full image. The engine writes these urls;
 *   main fetches the bytes on the Slack session, so the cookie never leaves
 *   the `persist:slack` partition, and only from Slack's file hosts (or the
 *   fake Slack under JUNO_E2E).
 *   `juno://files/<file id>/video?url=…` and `/audio?url=…` stream a video
 *   or an audio file for the player, passing its `Range` on, so it can seek.
 *   `juno://files/<file id>/content/<name>?url=…` streams a PDF, HTML or text file
 *   for the viewer with the type Slack answers (text with a charset). Any
 *   answer but a PDF carries a CSP sandbox that allows no scripts and no
 *   network, so an HTML file in the viewer's frame cannot run code or load
 *   anything. The PDF frame itself is sandboxed with only scripts allowed.
 * - `juno://uploads/<id>.<ext>`: an image the composer staged, from the
 *   engine's `uploads/` folder, for its chip and the pending row.
 * - `downloadFile`: Download, into ~/Downloads, then shown in Finder.
 * - `openFile`: the viewer's Open in browser for an HTML file, into a
 *   temporary folder, then opened in the default app.
 * - `quickLook`: Quick Look on a file card or in the viewer, into the same
 *   temporary folder, then shown in the macOS preview window.
 * - `copyImage`: the viewer's Copy image, from a `juno://files` or
 *   `juno://uploads` url, onto the clipboard as an image.
 */
import { createHash } from 'node:crypto'
import { app, clipboard, ClipboardItem, nativeImage, session as electronSession, shell, type BrowserWindow, type DownloadItem } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join, parse } from 'node:path'
import type { DownloadResult } from '@juno/contract'
import { SLACK_PARTITION } from './slackSession'

const SLACK_FILE_HOSTS = ['files.slack.com', 'slack-files.com', 'secure.gravatar.com']

/** The thumbnail url of a `juno://files` request when it points at a host Juno may fetch from, else undefined. */
export function thumbnailUrl(request: URL, extraOrigin: string | undefined): URL | undefined {
  const raw = request.searchParams.get('url')
  return raw === null ? undefined : slackFileUrl(raw, extraOrigin)
}

/** `raw` as a url when it is on a host Juno may fetch Slack files from, else undefined. */
function slackFileUrl(raw: string, extraOrigin: string | undefined): URL | undefined {
  try {
    const url = new URL(raw)
    if (url.username || url.password) return undefined
    if (url.protocol === 'https:' && (SLACK_FILE_HOSTS.includes(url.hostname) || url.hostname.endsWith('.slack-edge.com'))) return url
    if (extraOrigin !== undefined && url.origin === extraOrigin) return url
  } catch {
    // Not a url.
  }
  return undefined
}

/** The variants that stream for a player, with the types each may answer. */
const STREAMED: Readonly<Record<string, ReadonlyArray<string>>> = { video: ['video/'], audio: ['audio/', 'video/mp4'] }

/** A file's content in the viewer: no scripts, no forms, no network, inline styles and inline images only. */
const CONTENT_POLICY = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"

/** Whether a redirect goes to a sign-in page (Slack's, or the fake's under JUNO_E2E) rather than to the file. */
function isSignInPage(url: URL): boolean {
  return url.pathname === '/' || url.pathname.startsWith('/signin')
}

/**
 * Serves one thumbnail or file. A picture variant answers only an image,
 * so a Slack sign-in page never reaches an `<img>`, and a redirect to a
 * sign-in page answers 404 for every variant. A `video` or `audio` variant
 * answers only its kind, with `range` passed to Slack and its partial
 * answer passed back. A `content` variant answers what Slack serves, for
 * the app's page alone (`origin`).
 */
export async function serveThumbnail(request: URL, extraOrigin: string | undefined, range?: string | null, origin?: string | null): Promise<Response> {
  let url = thumbnailUrl(request, extraOrigin)
  if (url === undefined) return new Response('Not found', { status: 404 })
  // `/<file id>/<variant>`, and for `content` the file's name after it.
  const variant = request.host === 'files' ? (request.pathname.split('/')[2] ?? '') : ''
  const streamed = STREAMED[variant]
  const content = variant === 'content'
  try {
    const session = electronSession.fromPartition(SLACK_PARTITION)
    // A video plays for minutes and a long PDF takes a while; only their first answer has to come quickly.
    const signal = streamed !== undefined || content ? undefined : AbortSignal.timeout(15_000)
    const headers = streamed !== undefined && range ? { range } : undefined
    const get = (target: URL) => session.fetch(target.toString(), { credentials: 'include', redirect: 'manual', ...(signal === undefined ? {} : { signal }), ...(headers === undefined ? {} : { headers }) })
    let response = await get(url)
    for (let redirects = 0; response.status >= 300 && response.status < 400 && redirects < 3; redirects++) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      url = location === null ? undefined : slackFileUrl(new URL(location, url).toString(), extraOrigin)
      if (url === undefined || isSignInPage(url)) return new Response('Not found', { status: 404 })
      response = await get(url)
    }
    const type = response.headers.get('content-type') ?? ''
    if (streamed !== undefined) {
      if (!response.ok || !streamed.some((prefix) => type.startsWith(prefix))) {
        await response.body?.cancel()
        return new Response('Not found', { status: 404 })
      }
      const passed = new Headers({ 'content-type': type, 'accept-ranges': 'bytes' })
      for (const name of ['content-length', 'content-range']) {
        const value = response.headers.get(name)
        if (value !== null) passed.set(name, value)
      }
      return new Response(response.body, { status: response.status, headers: passed })
    }
    if (content) {
      if (!response.ok) {
        await response.body?.cancel()
        return new Response('Not found', { status: 404 })
      }
      return new Response(response.body, { headers: contentHeaders(type, response.headers.get('content-length'), origin) })
    }
    if (request.host === 'files' && request.pathname !== '/avatar') {
      if (!response.ok || !type.startsWith('image/')) {
        await response.body?.cancel()
        return new Response('Not found', { status: 404 })
      }
      return new Response(response.body, { headers: { 'content-type': type, 'cache-control': 'private, max-age=86400' } })
    }
    const maxBytes = 8 * 1024 * 1024
    if (!response.ok || !type.startsWith('image/') || Number(response.headers.get('content-length')) > maxBytes || response.body === null) {
      await response.body?.cancel()
      return new Response('Not found', { status: 404 })
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        return new Response('Not found', { status: 404 })
      }
      chunks.push(value)
    }
    return new Response(Buffer.concat(chunks), { status: 200, headers: { 'content-type': type, 'cache-control': 'private, max-age=86400' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

/**
 * The headers of a `content` answer: Slack's type, with a charset on text
 * (UTF-8 when Slack names none), never sniffed, and the sandbox policy on
 * anything but a PDF, whose Chromium viewer needs its own scripts.
 * The app's page may read it (`fetch` for a text file); no other origin may.
 */
export function contentHeaders(type: string, length: string | null, origin: string | null | undefined): Headers {
  const essence = type.split(';')[0]!.trim().toLowerCase() || 'application/octet-stream'
  const textual = essence.startsWith('text/') || essence === 'application/json' || essence.endsWith('+json') || essence.endsWith('+xml')
  const headers = new Headers({
    'content-type': textual && !/;\s*charset=/i.test(type) ? `${essence}; charset=utf-8` : type || essence,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=86400',
  })
  if (essence !== 'application/pdf') headers.set('content-security-policy', CONTENT_POLICY)
  if (length !== null) headers.set('content-length', length)
  if (origin !== null && origin !== undefined && isAppOrigin(origin)) headers.set('access-control-allow-origin', origin)
  return headers
}

/** The app's page: `juno://app`, or the dev server on this machine. */
function isAppOrigin(origin: string): boolean {
  return origin === 'juno://app' || /^http:\/\/localhost:\d+$/.test(origin)
}

/** Staged images by extension; the engine names a staged image `<uuid>.<ext>` and anything else `.bin`. */
const UPLOAD_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const UPLOAD_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif|webp)$/

/** Serves a staged image from any signed-in workspace's `uploads/` folder. Only image names the engine writes resolve. */
export async function serveUpload(request: URL, userData: string): Promise<Response> {
  const match = UPLOAD_NAME.exec(request.pathname.slice(1))
  if (match === null) return new Response('Not found', { status: 404 })
  const name = match[0]
  const root = join(userData, 'workspaces')
  try {
    for (const workspace of await readdir(root)) {
      const file = join(root, workspace, 'uploads', name)
      if (!existsSync(file)) continue
      return new Response(await readFile(file), { status: 200, headers: { 'content-type': UPLOAD_TYPES[match[2]!]!, 'cache-control': 'private, max-age=86400' } })
    }
  } catch {
    // No workspace yet.
  }
  return new Response('Not found', { status: 404 })
}

/** Under JUNO_E2E, saved downloads are recorded here and not shown in Finder. */
const downloadsForTests: string[] = []

/** A free path for `name` in `folder`: "plan.pdf", then "plan (1).pdf", as Finder names copies. */
export function freePath(folder: string, name: string, exists: (path: string) => boolean = existsSync): string {
  const safe = parse(name.replace(/[/\\:]/g, '-')).base.replace(/^\.+/, '') || 'download'
  const { name: stem, ext } = parse(safe)
  let candidate = join(folder, safe)
  for (let n = 1; exists(candidate); n++) candidate = join(folder, `${stem} (${n})${ext}`)
  return candidate
}

/**
 * Downloads a Slack file on the Slack session into ~/Downloads (under
 * JUNO_E2E, `<userData>/Downloads`) under the name it has in Slack, and
 * shows it in Finder. Only Slack's file hosts, or the fake Slack in tests.
 */
export function downloadFile(file: { readonly url: string; readonly name: string }, extraOrigin: string | undefined, e2e: boolean): Promise<DownloadResult> {
  const folder = e2e ? join(app.getPath('userData'), 'Downloads') : app.getPath('downloads')
  return saveFile(file, folder, extraOrigin, (path) => {
    if (e2e) downloadsForTests.push(path)
    else shell.showItemInFolder(path)
  })
}

/** Under JUNO_E2E, files Open in browser would have opened are recorded here instead. */
export const openedForTests: string[] = []

/**
 * Open in browser in the viewer: the Slack file saved under its name into
 * its folder in the temporary folder (`fileFolder`), then opened in the
 * default app (the browser, for an HTML file).
 */
export function openFile(file: { readonly url: string; readonly name: string }, extraOrigin: string | undefined, e2e: boolean): Promise<DownloadResult> {
  return saveFile(file, fileFolder(file.url, e2e), extraOrigin, (path) => {
    if (e2e) openedForTests.push(path)
    else void shell.openPath(path)
  })
}

/** Under JUNO_E2E, the files Quick Look would have shown, by path and the name it would show. */
const quickLookedForTests: Array<{ readonly path: string; readonly name: string }> = []

/**
 * Quick Look on a card or in the viewer: the Slack file saved under its
 * name into its folder in the temporary folder (`fileFolder`), then shown in
 * the macOS preview window over `window`, as Finder's space bar shows it.
 * Nothing goes into Downloads and no app opens. Electron does not say when
 * the preview closes, so the copy stays until the next start
 * (`clearTemporaryFiles`).
 */
export function quickLook(file: { readonly url: string; readonly name: string }, window: BrowserWindow | undefined, extraOrigin: string | undefined, e2e: boolean): Promise<DownloadResult> {
  return saveFile(file, fileFolder(file.url, e2e), extraOrigin, (path) => {
    if (e2e) quickLookedForTests.push({ path, name: file.name })
    else window?.previewFile(path, file.name)
  })
}

/** Where Quick Look and Open in browser keep their copies: `Juno` in the temporary folder, or under JUNO_E2E the test's own `<userData>/Temp`. */
function temporaryRoot(e2e: boolean): string {
  return e2e ? join(app.getPath('userData'), 'Temp') : join(app.getPath('temp'), 'Juno')
}

/**
 * One folder for each Slack file, named from its url, emptied before each
 * copy: opening a file again replaces its copy, and two files of one name
 * never meet.
 */
function fileFolder(url: string, e2e: boolean): string {
  const folder = join(temporaryRoot(e2e), createHash('sha256').update(url).digest('hex').slice(0, 16))
  rmSync(folder, { recursive: true, force: true })
  return folder
}

/** Deletes the copies Quick Look and Open in browser left in the temporary folder. At start, before any is made. */
export function clearTemporaryFiles(e2e: boolean): Promise<void> {
  return rm(temporaryRoot(e2e), { recursive: true, force: true }).catch(() => {})
}

/** Under JUNO_E2E, how many images Copy image put on the clipboard. */
const copiedForTests = { images: 0 }

/** Main's file test hooks (`junoTest`): what Download, Open in browser and Quick Look would have saved, and the images copied. */
export const fileTestHooks = {
  downloads: downloadsForTests,
  opened: openedForTests,
  quickLooked: quickLookedForTests,
  copiedImages: () => copiedForTests.images,
}

/** Copy image in the viewer: the bytes behind a `juno://files` or `juno://uploads` url, onto the clipboard. */
export async function copyImage(src: string, extraOrigin: string | undefined, e2e: boolean): Promise<'copied' | 'failed'> {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return 'failed'
  }
  if (url.protocol !== 'juno:') return 'failed'
  const response = url.host === 'files' && url.pathname !== '/avatar' ? await serveThumbnail(url, extraOrigin) : url.host === 'uploads' ? await serveUpload(url, app.getPath('userData')) : undefined
  if (response === undefined || !response.ok) return 'failed'
  const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()))
  if (image.isEmpty()) return 'failed'
  // As PNG whatever it came as, which every app pastes.
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
  if (e2e) copiedForTests.images++
  return 'copied'
}

/** Saves a Slack file on the Slack session into `folder` under its name, then calls `saved` with its path. */
function saveFile(file: { readonly url: string; readonly name: string }, folder: string, extraOrigin: string | undefined, saved: (path: string) => void): Promise<DownloadResult> {
  const url = slackFileUrl(file.url, extraOrigin)
  if (url === undefined) return Promise.resolve('failed')
  const session = electronSession.fromPartition(SLACK_PARTITION)
  mkdirSync(folder, { recursive: true })
  return new Promise((resolve) => {
    const onDownload = (_event: unknown, item: DownloadItem) => {
      if (item.getURLChain()[0] !== url.toString()) return
      session.off('will-download', onDownload)
      // Slack names the file in its download answer; the title the message shows may have no extension.
      const path = freePath(folder, item.getFilename() || file.name)
      item.setSavePath(path)
      item.once('done', (_done, state) => {
        if (state !== 'completed') return resolve('failed')
        saved(path)
        resolve('saved')
      })
    }
    session.on('will-download', onDownload)
    session.downloadURL(url.toString())
  })
}
