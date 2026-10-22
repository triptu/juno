import { app, net } from 'electron'
import { createWriteStream, readFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isVersion, normalizeVersion } from './releaseNotes'

/**
 * Where updates come from: GitHub Releases of a private repository, read with a
 * fine-grained token that can only read that repository (docs/development.md,
 * "Releasing"). The token never leaves main, and no error or log line carries it.
 */
export interface UpdateConfig {
  /** `owner/repo` of the releases repository. */
  readonly repository: string
  readonly token: string
  /** Developer ID signed: Squirrel.Mac can install the update in place. Otherwise the DMG is offered. */
  readonly signed: boolean
  /** GitHub's API, or a local fake under JUNO_E2E. */
  readonly api: string
}

/** The token a JUNO_E2E launch sends to the fake update server; the fake checks it. */
export const E2E_UPDATE_TOKEN = 'e2e-update-token'

/**
 * The packaged app's `update.json`, written into the app by build/package.cjs
 * from JUNO_UPDATE_TOKEN. None in development, in an app built without a
 * token, or in tests unless a test names a fake server (`JUNO_E2E_UPDATE_SERVER`).
 */
export function loadUpdateConfig(e2e: boolean): UpdateConfig | null {
  if (e2e) {
    const server = process.env.JUNO_E2E_UPDATE_SERVER
    return server ? { repository: 'triptu/juno-releases', token: E2E_UPDATE_TOKEN, signed: false, api: `${server}/api/v3` } : null
  }
  if (!app.isPackaged) return null
  try {
    const value: unknown = JSON.parse(readFileSync(join(app.getAppPath(), 'update.json'), 'utf8'))
    if (typeof value !== 'object' || value === null) return null
    const { repository, token, signed } = value as Record<string, unknown>
    if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository) || typeof token !== 'string' || token === '') return null
    return { repository, token, signed: signed === true, api: 'https://api.github.com' }
  } catch {
    return null
  }
}

export interface ReleaseAsset {
  readonly name: string
  /** The API URL; it answers the file itself with `Accept: application/octet-stream`. */
  readonly url: string
}

export interface LatestRelease {
  readonly version: string
  readonly dmg: ReleaseAsset | null
}

/**
 * A GET with the token. Redirects are followed by hand so the token goes only to
 * the origin it was meant for: GitHub sends asset downloads on to a signed URL
 * on another host, which must not see it.
 */
function get(url: string, token: string, accept: string, redirects = 0): Promise<Electron.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const request = net.request({ url, redirect: 'manual', credentials: 'omit', useSessionCookies: false })
    request.setHeader('Accept', accept)
    request.setHeader('X-GitHub-Api-Version', '2022-11-28')
    if (token !== '') request.setHeader('Authorization', `Bearer ${token}`)
    request.on('redirect', (_status, _method, location) => {
      request.abort()
      if (redirects >= 5) return reject(new Error(`Too many redirects from ${target.pathname}`))
      const next = new URL(location, url)
      get(next.href, next.origin === target.origin ? token : '', accept, redirects + 1).then(resolve, reject)
    })
    request.on('response', (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response)
      response.on('data', () => {})
      reject(new Error(`HTTP ${response.statusCode} from ${target.pathname}`))
    })
    request.on('error', reject)
    request.end()
  })
}

async function text(response: Electron.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of response as unknown as AsyncIterable<Buffer>) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

export function createReleaseFeed(config: UpdateConfig) {
  const repo = `${config.api}/repos/${config.repository}`
  return {
    /** The newest published release; drafts and pre-releases are never offered. */
    latest: async (): Promise<LatestRelease> => {
      const body = JSON.parse(await text(await get(`${repo}/releases/latest`, config.token, 'application/vnd.github+json'))) as {
        tag_name?: unknown
        assets?: Array<{ name?: unknown; url?: unknown }>
      }
      if (typeof body.tag_name !== 'string' || !isVersion(body.tag_name)) throw new Error('The latest release has no semver tag')
      const assets = (body.assets ?? []).flatMap((asset) =>
        typeof asset.name === 'string' && typeof asset.url === 'string' ? [{ name: asset.name, url: asset.url }] : [])
      const dmg = assets.find((asset) => asset.name.endsWith('-arm64.dmg')) ?? assets.find((asset) => asset.name.endsWith('.dmg')) ?? null
      return { version: normalizeVersion(body.tag_name), dmg }
    },
    /** CHANGELOG.md from the repository's default branch. */
    changelog: async (): Promise<string> => text(await get(`${repo}/contents/CHANGELOG.md`, config.token, 'application/vnd.github.raw+json')),
    /**
     * Saves an asset to `path`, through a partial file so a failed download leaves nothing behind.
     * `onProgress` gets the share done, from 0 to 1, when the server sends the size.
     */
    download: async (asset: ReleaseAsset, path: string, onProgress?: (share: number) => void): Promise<void> => {
      const partial = `${path}.download`
      try {
        const response = await get(asset.url, config.token, 'application/octet-stream')
        const header = response.headers['content-length']
        const size = Number(Array.isArray(header) ? header[0] : header)
        let received = 0
        const counted = async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            received += chunk.length
            if (size > 0) onProgress?.(Math.min(received / size, 1))
            yield chunk
          }
        }
        await pipeline(Readable.from(counted(response as unknown as AsyncIterable<Buffer>)), createWriteStream(partial))
        await rename(partial, path)
      } catch (error) {
        await rm(partial, { force: true })
        throw error
      }
    },
  }
}
