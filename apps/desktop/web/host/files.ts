/**
 * What the web shell serves under `/__juno/` in place of main's `juno://`
 * scheme (apps/desktop/src/main/scheme.ts):
 *
 * - `files/<id>/<variant>?url=…`, `images/?url=…`: the bytes of a file on the
 *   fake Slack, fetched with the session's cookie, `Range` passed on. A url
 *   anywhere else (a public unfurl, a Slack CDN) is never fetched: images get
 *   a grey placeholder, everything else a 404, so the shell needs no network.
 * - `uploads/<name>`: an image the composer staged, from the engine's folder.
 * - `pictures/<name>`: Home's pictures, from the engine's picture cache.
 * - `download?url=…&name=…`: a fake Slack file as an attachment, for the
 *   browser's own download.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { DOWNLOAD_PATH, SCHEME_PREFIX } from '../paths'
import { fakeAddress } from './fakeMain'

const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#8884"/></svg>'
const UPLOAD_NAME = /^[\w-]+\.(png|jpe?g|gif|webp)$/
const PICTURE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:small|large)\.webp$/
const STREAMED = new Set(['video', 'audio', 'content'])

export interface FileSource {
  /** The fake Slack's origin, the only place file bytes come from. */
  readonly origin: string
  /** Other origins that mean the fake (`fakeMain.ts`, `aliases`). */
  readonly aliases?: ReadonlyArray<string>
  /** The session cookie the fake checks. */
  readonly cookie: () => string
  /** The engine's data folder. */
  readonly userData: string
}

function send(response: ServerResponse, status: number, type: string, body: string | Uint8Array): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  response.end(body)
}

async function fromFake(request: IncomingMessage, response: ServerResponse, source: FileSource, raw: string | null, extra: Record<string, string> = {}): Promise<boolean> {
  let asked: URL
  try {
    asked = new URL(raw ?? '')
  } catch {
    return false
  }
  const url = fakeAddress(asked, source.origin, source.aliases)
  if (url === undefined) return false
  const range = request.headers.range
  const answer = await fetch(url, { headers: { cookie: source.cookie(), ...(range === undefined ? {} : { range }) }, redirect: 'manual' })
  if (answer.status >= 300 && answer.status < 400) return false
  const headers: Record<string, string> = { 'cache-control': 'no-store', ...extra }
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition']) {
    const value = answer.headers.get(name)
    if (value !== null) headers[name] = value
  }
  response.writeHead(answer.status, headers)
  response.end(new Uint8Array(await answer.arrayBuffer()))
  return true
}

async function fromFolder(response: ServerResponse, file: string | undefined, type: string): Promise<void> {
  if (file === undefined || !existsSync(file)) return send(response, 404, 'text/plain', 'Not found')
  send(response, 200, type, await readFile(file))
}

async function uploadFile(userData: string, name: string): Promise<string | undefined> {
  const root = join(userData, 'workspaces')
  if (!existsSync(root)) return undefined
  for (const workspace of await readdir(root)) {
    const file = join(root, workspace, 'uploads', name)
    if (existsSync(file)) return file
  }
  return undefined
}

/** Answers a request under `/__juno/`, or returns false for anything else. */
export async function serveFile(request: IncomingMessage, response: ServerResponse, source: FileSource): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://web-shell')
  if (url.pathname === DOWNLOAD_PATH) {
    const name = (url.searchParams.get('name') ?? 'download').replace(/["\\\r\n]/g, '')
    if (!(await fromFake(request, response, source, url.searchParams.get('url'), { 'content-disposition': `attachment; filename="${name}"` }))) send(response, 404, 'text/plain', 'Not found')
    return true
  }
  if (!url.pathname.startsWith(SCHEME_PREFIX)) return false
  const [host = '', ...rest] = url.pathname.slice(SCHEME_PREFIX.length).split('/')
  const path = rest.join('/')
  if (host === 'files' || host === 'images') {
    if (await fromFake(request, response, source, url.searchParams.get('url'))) return true
    // `files/<id>/<variant>`: a player or the viewer gets nothing rather than a picture.
    if (host === 'files' && STREAMED.has(rest[1] ?? '')) send(response, 404, 'text/plain', 'Not found')
    else send(response, 200, 'image/svg+xml', PLACEHOLDER)
    return true
  }
  if (host === 'uploads') {
    const match = UPLOAD_NAME.exec(path)
    await fromFolder(response, match === null ? undefined : await uploadFile(source.userData, path), `image/${match?.[1] === 'jpg' ? 'jpeg' : (match?.[1] ?? 'png')}`)
    return true
  }
  if (host === 'pictures') {
    await fromFolder(response, PICTURE_NAME.test(path) ? join(source.userData, 'pictures', path) : undefined, 'image/webp')
    return true
  }
  send(response, 404, 'text/plain', 'Not found')
  return true
}
