/**
 * Handlers for the files routes (`contract/src/routes/files.ts`): staging
 * the composer's files and the upload progress of posts being sent.
 */
import { FilesRoutes } from '@juno/contract'
import { Effect, Stream } from 'effect'
import { serveLiveValue, timed } from '../protocol/live'
import { UploadProgress } from '../uploadProgress'
import { Staging } from '../staging'

export const FilesHandlers = FilesRoutes.toLayer(
  Effect.gen(function* () {
    const staging = yield* Staging
    const progress = yield* UploadProgress
    return {
      'files.stage': (chunk) => staging.stage(chunk),
      'files.unstage': ({ id }) => staging.unstage(id),
      'uploads.progress': () => serveLiveValue(progress.changes.pipe(Stream.mapEffect((value) => Effect.result(timed(Effect.succeed(value)))))),
    }
  }),
)
