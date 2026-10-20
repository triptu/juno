/**
 * Handlers for Home's pictures (`contract/src/routes/pictures.ts`): the
 * renderer asks for a file before it shows it, and reads which files are
 * on disk for the gallery's first frame.
 */
import { PicturesRoutes } from '@juno/contract'
import { Effect } from 'effect'
import { PictureCache } from './cache'

export const PicturesHandlers = PicturesRoutes.toLayer(
  Effect.gen(function* () {
    const cache = yield* PictureCache
    return {
      'pictures.fetch': ({ id, size }) => cache.fetch(id, size),
      'pictures.onDisk': ({ size }) => cache.onDisk(size),
    }
  }),
)
