/**
 * The Chime page for `huddle-live.ts`: bundles `huddle-live-page.ts` as the
 * app builds its renderer (Vite and Rolldown, the renderer's plugins and
 * output, minified), so the check runs the Chime code a release ships. A
 * Bun bundle hid a Chime that failed only in the app's build (10-27). It
 * serves the page from localhost and opens it in Playwright's Chromium (or
 * Google Chrome when Playwright has no Chromium installed), with
 * Chromium's fake microphone. The meeting and attendee reach the page
 * through `page.evaluate` only, never a url or a file.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { buildLikeRenderer } from '../apps/desktop/renderer.vite.ts'
import { log, safeError, type HuddleEvent } from './huddle-live-report.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface PageGlobals {
  junoJoin(meeting: unknown, attendee: unknown, noiseSuppression: boolean): Promise<string>
  junoLeave(): Promise<void>
}

export interface HuddlePage {
  /** Starts audio with the fake microphone, unmuted. */
  join(meeting: unknown, attendee: unknown): Promise<void>
  /** Stops the session, waiting at most 5 s. Returns what happened. */
  leave(): Promise<string>
  close(): Promise<void>
}

export async function openHuddlePage(options: { readonly headed: boolean; readonly noiseSuppression: boolean; readonly onEvent: (event: HuddleEvent) => void }): Promise<HuddlePage> {
  const dir = await mkdtemp(join(existsSync('/Volumes/AgentWork/tmp') ? '/Volumes/AgentWork/tmp' : tmpdir(), 'juno-huddle-'))
  const cleanups: Array<() => Promise<unknown>> = [() => rm(dir, { recursive: true, force: true })]
  const close = async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup().catch(() => {})
  }
  try {
    await buildLikeRenderer({ repoRoot: root, name: 'page', entry: join(root, 'scripts/huddle-live-page.ts'), outDir: dir }).catch((error: unknown) => {
      throw new Error(`bundling the page failed: ${safeError(error)}`)
    })
    const server = createServer((request, response) => {
      if (request.url === '/') return void response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>huddle check</title><audio autoplay></audio><script type="module" src="/page.js"></script>')
      // The page and its lazy chunks, from the build folder only.
      const file = /^\/[\w./-]+\.js$/.test(request.url ?? '') && !request.url!.includes('..') ? join(dir, request.url!) : undefined
      if (file === undefined) return void response.writeHead(404).end()
      readFile(file).then(
        (body) => response.writeHead(200, { 'content-type': 'text/javascript' }).end(body),
        () => response.writeHead(404).end(),
      )
    })
    await new Promise<void>((done) => server.listen(0, 'localhost', done))
    cleanups.push(() => new Promise((done) => server.close(done)))
    const port = (server.address() as { port: number }).port

    const bundled = existsSync(chromium.executablePath())
    const browser = await chromium.launch({
      headless: !options.headed,
      // The script closes the browser itself, after stopping the session.
      handleSIGINT: false,
      handleSIGTERM: false,
      ...(bundled ? {} : { channel: 'chrome' }),
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    })
    cleanups.push(() => browser.close())
    log(`browser: ${bundled ? "Playwright's Chromium" : 'Google Chrome (Playwright has no Chromium here)'}, ${options.headed ? 'headed' : 'headless'}`)
    const page = await browser.newPage()
    await page.exposeFunction('junoReport', options.onEvent)
    page.on('pageerror', (error) => log(`page error: ${safeError(error)}`))
    await page.goto(`http://localhost:${port}/`)
    const loaded = await page.evaluate(() => typeof (globalThis as unknown as Partial<PageGlobals>).junoJoin === 'function')
    log(`page loaded from localhost, Chime SDK ${loaded ? 'ready' : 'MISSING'}`)
    if (!loaded) throw new Error('the page did not load the Chime SDK')

    let joined = false
    return {
      join: async (meeting, attendee) => {
        joined = true
        await page.evaluate(([m, a, ns]) => (globalThis as unknown as PageGlobals).junoJoin(m, a, ns).then(() => undefined), [meeting, attendee, options.noiseSuppression] as const)
      },
      leave: async () => {
        if (!joined) return 'not started'
        return Promise.race([
          page.evaluate(() => (globalThis as unknown as PageGlobals).junoLeave()).then(() => 'stopped'),
          new Promise<string>((done) => setTimeout(() => done('did not stop within 5 s'), 5_000)),
        ]).catch((error: unknown) => (/has been closed/.test(String(error)) ? 'the browser had already closed, which ended the media' : `stop failed (${safeError(error)})`))
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
