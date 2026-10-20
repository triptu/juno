/**
 * `juno://pictures/<id>-<size>.webp`: Home's pictures as the engine's
 * picture cache wrote them under `<userData>/pictures/` (SPEC 12, "A
 * picture"). Only names of that shape are served, so nothing else on disk
 * can be read through it.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:small|large)\.webp$/

export async function servePicture(request: URL, userData: string): Promise<Response> {
  const name = request.pathname.slice(1)
  if (!NAME.test(name)) return new Response('Not found', { status: 404 })
  try {
    // The files never change under a name, so the renderer may keep them.
    return new Response(await readFile(join(userData, 'pictures', name)), { status: 200, headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
