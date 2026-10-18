/**
 * The Chime page for `huddle-live.ts`: bundles `huddle-live-page.ts` with
 * Bun, serves it from localhost and opens it in Playwright's Chromium (or
 * Google Chrome when Playwright has no Chromium installed), with
 * Chromium's fake microphone. The meeting and attendee reach the page
 * through `page.evaluate` only, never a url or a file.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { log, safeError, type HuddleEvent } from './huddle-live-report.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface PageGlobals {
  junoJoin(meeting: unknown, attendee: unknown): Promise<string>
  junoLeave(): Promise<void>
}

export interface HuddlePage {
  /** Starts audio with the fake microphone, unmuted. */
  join(meeting: unknown, attendee: unknown): Promise<void>
  /** Stops the session, waiting at most 5 s. Returns what happened. */
  leave(): Promise<string>
  close(): Promise<void>
}

export async function openHuddlePage(options: { readonly headed: boolean; readonly onEvent: (event: HuddleEvent) => void }): Promise<HuddlePage> {
  const dir = await mkdtemp(join(existsSync('/Volumes/AgentWork/tmp') ? '/Volumes/AgentWork/tmp' : tmpdir(), 'juno-huddle-'))
  const cleanups: Array<() => Promise<unknown>> = [() => rm(dir, { recursive: true, force: true })]
  const close = async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup().catch(() => {})
  }
  try {
    const bun = join(root, 'node_modules/.bin/bun')
    const built = spawnSync(bun, ['build', join(root, 'scripts/huddle-live-page.ts'), '--target=browser', '--define', 'global=globalThis', '--outfile', join(dir, 'page.js')], {
      encoding: 'utf8',
    })
    if (built.status !== 0) throw new Error(`bundling the page failed: ${built.stderr.slice(0, 300)}`)
    const script = await readFile(join(dir, 'page.js'))
    const server = createServer((request, response) => {
      if (request.url === '/page.js') response.writeHead(200, { 'content-type': 'text/javascript' }).end(script)
      else if (request.url === '/') response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>huddle check</title><audio autoplay></audio><script src="/page.js"></script>')
      else response.writeHead(404).end()
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
    await page.goto(`http://localhost:${port}/`)
    const loaded = await page.evaluate(() => typeof (globalThis as unknown as Partial<PageGlobals>).junoJoin === 'function')
    log(`page loaded from localhost, Chime SDK ${loaded ? 'ready' : 'MISSING'}`)
    if (!loaded) throw new Error('the page did not load the Chime SDK')

    let joined = false
    return {
      join: async (meeting, attendee) => {
        joined = true
        await page.evaluate(([m, a]) => (globalThis as unknown as PageGlobals).junoJoin(m, a).then(() => undefined), [meeting, attendee] as const)
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
