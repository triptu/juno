/**
 * The web shell (`docs/development.md`, "Web shell"): the real renderer in a
 * browser, for UI work without building or launching Electron. One Node
 * process holds all of it:
 *
 * - a fake Slack seeded with the default seed the e2e and feel tests use,
 *   on a free port, with its control API;
 * - the engine on a fresh data folder, signed in to the fake, with the
 *   fake AI, serving its routes over WebSockets (`socketTransport`);
 * - Vite in dev mode (HMR) serving the renderer with the web page entry
 *   (`../page/main.ts`), the engine socket and `/__juno/` files on the same
 *   port.
 *
 * `stop()` ends all of it and removes the data folder.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Logger, LogLevel } from 'effect'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import { WebSocketServer, type WebSocket } from 'ws'
import { memoryHost, socketTransport, startEngine, type EngineHandle } from '@juno/engine'
import { startFakeSlack } from '@juno/fake-slack'
import { rendererPlugins } from '../../renderer.vite'
import { ENGINE_SOCKET_PATH } from '../paths'
import { fakeMain, memorySessionStore, storedSession } from './fakeMain'
import { serveFile, type FileSource } from './files'

const desktopDir = resolve(import.meta.dirname, '../..')
const repoRoot = resolve(desktopDir, '../..')
const rendererDir = join(desktopDir, 'src/renderer')
const pageEntry = resolve(import.meta.dirname, '../page/main.ts')
const STOP_STEP_MS = 1500

export interface WebShellOptions {
  /** The app's port; 0 picks a free one. */
  readonly port: number
  /** The interface to listen on: 127.0.0.1, or 0.0.0.0 for the LAN (`--host`). */
  readonly host?: string
  /** Vite's log level; the command line keeps it to warnings. */
  readonly logLevel?: 'info' | 'warn' | 'error' | 'silent'
}

export interface WebShell {
  /** The app's address. */
  readonly url: string
  /** The fake Slack's control API: `POST <controlUrl>/<name>` with a JSON body. */
  readonly controlUrl: string
  readonly stop: () => Promise<void>
}

/** The engine's warnings and errors; its info lines (migrations, sync steps) stay out of the shell's output. */
const engineLogger = Logger.make<unknown, void>((options) => {
  if (LogLevel.isGreaterThanOrEqualTo(options.logLevel, 'Warn')) Logger.defaultLogger.log(options)
})

/**
 * The folders Vite may serve files from: the repo, and Bun's global store,
 * where packages such as the fonts really live (`globalStore` in bunfig.toml).
 */
function servedFolders(): string[] {
  const react = realpathSync(join(desktopDir, 'node_modules/react'))
  const links = react.lastIndexOf('/links/')
  return links < 0 ? [repoRoot] : [repoRoot, react.slice(0, links + '/links'.length)]
}

/** Whether a process is running. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * A fresh data folder in scratch space: the AgentWork volume when it is
 * mounted (CLAUDE.md), else the system's. Each folder names the process that
 * owns it, and folders whose process has gone (a shell killed without a
 * chance to clean up) are removed first.
 */
function scratchFolder(): string {
  const volume = '/Volumes/AgentWork'
  const parent = existsSync(volume) ? join(volume, 'tmp') : tmpdir()
  mkdirSync(parent, { recursive: true })
  for (const name of readdirSync(parent)) {
    if (!name.startsWith('juno-web-')) continue
    const owner = Number(/^juno-web-(\d+)-/.exec(name)?.[1])
    if (Number.isInteger(owner) && !running(owner)) rmSync(join(parent, name), { recursive: true, force: true })
  }
  return mkdtempSync(join(parent, `juno-web-${process.pid}-`))
}

/** Whether an upgrade's `Origin` names the host it was sent to. A missing or malformed one does not. */
function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined || !URL.canParse(origin)) return false
  return new URL(origin).host === host
}

/** Serves the page entry in place of the renderer's, the engine socket and the files, on Vite's server. */
function webShellPlugin(httpServer: Server, onSocket: (socket: WebSocket) => void, files: FileSource): Plugin {
  const sockets = new WebSocketServer({ noServer: true })
  return {
    name: 'juno:web-shell',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('src="./main.tsx"', `src="/@fs${pageEntry}"`),
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        serveFile(request, response, files).then((served) => {
          if (!served) next()
        }, next)
      })
      httpServer.on('upgrade', (request, socket, head) => {
        if (new URL(request.url ?? '/', 'http://web-shell').pathname !== ENGINE_SOCKET_PATH) return
        // Only the page itself: another site open in the browser must not reach the engine.
        if (!sameOrigin(request.headers.origin, request.headers.host)) {
          socket.destroy()
          return
        }
        sockets.handleUpgrade(request, socket, head, onSocket)
      })
    },
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      done()
    })
  })
}

function closeHttp(server: Server): Promise<void> {
  return new Promise((done, reject) => {
    if (!server.listening) return done()
    server.close((error) => error === undefined ? done() : reject(error))
    server.closeAllConnections()
  })
}

export async function startWebShell(options: WebShellOptions): Promise<WebShell> {
  const host = options.host ?? '127.0.0.1'
  const userData = scratchFolder()
  const cleanups: Array<() => unknown> = [() => rmSync(userData, { recursive: true, force: true })]
  // Last started, first stopped. A step that hangs gives up after a while, so the data folder still goes.
  const stop = async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
      const step = Promise.resolve().then(cleanup).catch((cause: unknown) => console.error('web shell: stop failed', cause))
      await Promise.race([step, new Promise((resolve) => setTimeout(resolve, STOP_STEP_MS).unref())])
    }
  }
  try {
    const fake = await startFakeSlack({ seedTime: Date.now() })
    cleanups.push(() => fake.close())
    const engineHost = memoryHost()
    const main = fakeMain(engineHost, { fakeUrl: fake.url, store: memorySessionStore(storedSession(fake.signIn())), signIn: () => Promise.resolve(fake.signIn()) })
    const transport = socketTransport({ host, port: options.port })
    const engine: EngineHandle = await startEngine(
      transport,
      { userData, e2e: true, dev: true, fakeSlackUrl: fake.url, ai: 'fake', aiJobs: false },
      { host: engineHost, httpTransport: main.httpTransport, logger: engineLogger },
    )
    cleanups.push(() => engine.stop())
    const open = new Set<WebSocket>()
    // The host owns signals and shutdown. Vite's standalone server exits on SIGTERM
    // before the engine and scratch folder can be cleaned up.
    const httpServer = createHttpServer()
    const server: ViteDevServer = await createServer({
      configFile: false,
      root: rendererDir,
      cacheDir: join(desktopDir, 'node_modules/.vite-web'),
      clearScreen: false,
      logLevel: options.logLevel ?? 'warn',
      plugins: [
        ...rendererPlugins({ repoRoot, minify: false, reportSkipped: false }),
        webShellPlugin(
          httpServer,
          (socket) => {
            open.add(socket)
            socket.on('close', () => open.delete(socket))
            transport.add(socket)
          },
          { origin: new URL(fake.url).origin, cookie: main.cookie, userData },
        ),
      ],
      server: {
        host,
        port: options.port,
        middlewareMode: true,
        hmr: { server: httpServer },

        fs: { allow: servedFolders() },
        // Transform the page's modules while nobody is looking yet, so the first load is quicker.
        warmup: { clientFiles: [pageEntry] },
      },
      optimizeDeps: { entries: [pageEntry], include: ['react/compiler-runtime'], holdUntilCrawlEnd: false },
    })
    cleanups.push(() => closeHttp(httpServer))
    cleanups.push(() => server.close())
    cleanups.push(() => {
      for (const socket of open) socket.terminate()
    })
    httpServer.on('request', server.middlewares)
    await listen(httpServer, options.port, host)
    const address = httpServer.address()
    const port = typeof address === 'object' && address !== null ? address.port : options.port
    return {
      url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/`,
      controlUrl: `${fake.url}/control`,
      stop,
    }
  } catch (cause) {
    await stop()
    throw cause
  }
}
