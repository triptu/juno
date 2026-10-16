import { lookup } from 'node:dns'
import { get } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { serveThumbnail, thumbnailUrl } from './files'

const MAX_BYTES = 8 * 1024 * 1024
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon'])
const privateAddresses = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) privateAddresses.addSubnet(address, prefix)
for (const [address, prefix] of [['::', 96], ['fec0::', 10], ['64:ff9b:1::', 48], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) privateAddresses.addSubnet(address, prefix, 'ipv6')

/** Public unfurl bytes use no Slack session, cookies, tokens or renderer headers. */
async function publicImage(url: URL, redirects = 0): Promise<Response> {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || redirects > 3) throw new Error('Invalid image URL')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(host)
  if (family && privateAddresses.check(host, family === 6 ? 'ipv6' : 'ipv4')) throw new Error('Non-public image host')
  return new Promise((resolve, reject) => {
    const request = get(url, {
      // Pin the socket to the checked DNS answer; redirects repeat this check.
      lookup(hostname, options, callback) {
        lookup(hostname, { all: true }, (error, addresses) => {
          if (error) return callback(error, '', 4)
          const publicAddresses = addresses.filter((entry) => !privateAddresses.check(entry.address, entry.family === 6 ? 'ipv6' : 'ipv4'))
          const address = publicAddresses[0]
          if (!address) return callback(new Error('Non-public image host'), '', 4)
          if (options.all) callback(null, publicAddresses)
          else callback(null, address.address, address.family)
        })
      },
      signal: AbortSignal.timeout(15_000),
    }, (response) => {
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.destroy()
        try { resolve(publicImage(new URL(response.headers.location, url), redirects + 1)) } catch (error) { reject(error) }
        return
      }
      const type = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? ''
      if (status !== 200 || !TYPES.has(type) || Number(response.headers['content-length']) > MAX_BYTES) {
        response.destroy()
        reject(new Error('Invalid image response'))
        return
      }
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > MAX_BYTES) response.destroy(new Error('Image too large'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { headers: { 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } })))
    })
    request.on('error', reject)
  })
}

export async function serveImage(request: URL, fakeOrigin?: string): Promise<Response> {
  try {
    const url = new URL(request.searchParams.get('url') ?? '')
    // Cookie-protected Slack files keep the existing authenticated path.
    if (thumbnailUrl(request, fakeOrigin) !== undefined) return serveThumbnail(request, fakeOrigin)
    return await publicImage(url)
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
