import { serveThumbnail, thumbnailUrl } from './files'
import { publicImage } from './publicImage'

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
