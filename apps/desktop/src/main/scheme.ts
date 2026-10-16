/**
 * The `juno://` scheme (architecture section 14, performance 2.1).
 *
 * `juno://app/` serves the built renderer. `standard` gives it a real origin
 * and relative URLs, `secure` lets it use secure-context APIs, `codeCache`
 * lets Chromium keep the V8 code cache for the bundle between launches.
 * `juno://files/` serves message thumbnails on the Slack session and
 * `juno://uploads/` the images the composer staged (files.ts).
 */
import { app, net, protocol } from 'electron'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serveThumbnail, serveUpload } from './files'
import { serveImage } from './images'

export const APP_SCHEME = 'juno'
export const APP_ORIGIN = `${APP_SCHEME}://app`
export const APP_URL = `${APP_ORIGIN}/index.html`

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  ])
}

/**
 * Must run after `app.whenReady()`. `rendererDir` is the built renderer
 * folder; `fakeSlackOrigin` is the fake Slack thumbnails may also come from
 * under JUNO_E2E.
 */
export function serveAppScheme(rendererDir: string, fakeSlackOrigin?: string): void {
  const root = resolve(rendererDir)
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.host === 'images') return serveImage(url, fakeSlackOrigin)
    if (url.host === 'files') return serveThumbnail(url, fakeSlackOrigin, request.headers.get('range'))
    if (url.host === 'uploads') return serveUpload(url, app.getPath('userData'))
    if (url.host !== 'app') return new Response('Not found', { status: 404 })
    const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
    // Resolve against the root and refuse anything that escapes it. Chromium
    // normalises `..` before the request reaches us; this is the second lock.
    const file = resolve(root, `.${pathname}`)
    if (file !== root && !file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Not found', { status: 404 }))
  })
}
