/**
 * `juno://files/<file id>/<variant>?url=<Slack thumbnail url>`: message
 * thumbnails (architecture 9, owner decision 10-13). The engine writes these
 * urls; main fetches the bytes on the Slack session, so the cookie never
 * leaves the `persist:slack` partition, and only from Slack's file hosts
 * (or the fake Slack under JUNO_E2E). Display only: downloads and uploads
 * are M6.
 */
import { session as electronSession } from 'electron'
import { SLACK_PARTITION } from './signInWindow'

const SLACK_FILE_HOSTS = ['files.slack.com', 'slack-files.com']

/** The thumbnail url of a `juno://files` request when it points at a host Juno may fetch from, else undefined. */
export function thumbnailUrl(request: URL, extraOrigin: string | undefined): URL | undefined {
  const raw = request.searchParams.get('url')
  if (raw === null) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:' && (SLACK_FILE_HOSTS.includes(url.hostname) || url.hostname.endsWith('.slack-edge.com'))) return url
    if (extraOrigin !== undefined && url.origin === extraOrigin) return url
  } catch {
    // Not a url.
  }
  return undefined
}

/** Serves one thumbnail. Anything but an image answers 404, so a Slack sign-in page never reaches an `<img>`. */
export async function serveThumbnail(request: URL, extraOrigin: string | undefined): Promise<Response> {
  const url = thumbnailUrl(request, extraOrigin)
  if (url === undefined) return new Response('Not found', { status: 404 })
  try {
    const response = await electronSession.fromPartition(SLACK_PARTITION).fetch(url.toString(), { credentials: 'include' })
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !type.startsWith('image/')) return new Response('Not found', { status: 404 })
    return new Response(response.body, { status: 200, headers: { 'content-type': type, 'cache-control': 'private, max-age=86400' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
