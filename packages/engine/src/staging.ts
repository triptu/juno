/**
 * `Staging`: the files a composer holds before they are sent (architecture
 * 9). The renderer sends each file's bytes in chunks (`files.stage`); they
 * are written under the open workspace's `uploads/` folder as
 * `<id>.<ext>`, so the outbox can upload them later, after a restart too.
 * An image is named with its own extension, which is how main knows it may
 * serve it as `juno://uploads/<name>` for the chip and the pending row.
 *
 * What the composer attached is remembered in memory until it is sent or
 * removed. Staged bytes that no pending post names are deleted a day after
 * they were written (`sweep`, when a workspace opens).
 */
import { appendFile, mkdir, open as openFile, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Clock, Context, Effect, Layer, Stream } from 'effect'
import { MAX_FILE_BYTES, NotSignedIn, Rejected, type StagedFile, type StageError } from '@juno/contract'
import { pendingPosts, type PendingFile } from '@juno/sync'
import { Workspace, type OpenWorkspace } from './workspace'
import { imageSize } from './imageSize'

/** Staged bytes no post names are deleted after this long. */
const SWEEP_AFTER_MILLIS = 24 * 60 * 60_000
/** Enough of a file to read an image's size from its header. */
const HEADER_BYTES = 64 * 1024
/** Image types main serves back as previews, by the extension the staged file gets. */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
/** A renderer id: a UUID, so it is safe as a file name. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface StageChunk {
  readonly id: string
  readonly name: string
  readonly mimetype: string
  readonly offset: number
  readonly bytes: Uint8Array
  readonly last: boolean
}

interface Entry {
  readonly file: PendingFile
  readonly path: string
  /** Bytes written so far. */
  written: number
  done: boolean
}

export class Staging extends Context.Service<
  Staging,
  {
    /** Writes one chunk. The last answers the file as its chip shows it. */
    readonly stage: (chunk: StageChunk) => Effect.Effect<StagedFile | null, StageError>
    readonly unstage: (id: string) => Effect.Effect<void>
    /** The staged files `ids` name, in order, for a post. `file_not_found` for one that is missing or incomplete. */
    readonly take: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<PendingFile>, Rejected>
    /** A staged file's bytes, for the upload. */
    readonly read: (open: OpenWorkspace, file: PendingFile) => Effect.Effect<Uint8Array, Rejected>
    /** Deletes a post's staged bytes once Slack has the message, or the post was discarded. */
    readonly release: (open: OpenWorkspace, files: ReadonlyArray<PendingFile>) => Effect.Effect<void>
  }
>()('juno/engine/files/Staging') {
  static readonly layer: Layer.Layer<Staging, never, Workspace> = Layer.effect(
    Staging,
    Effect.gen(function* () {
      const workspace = yield* Workspace
      const entries = new Map<string, Entry>()

      const stage = (chunk: StageChunk): Effect.Effect<StagedFile | null, StageError> =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          if (!ID.test(chunk.id)) return yield* new Rejected({ code: 'bad_chunk' })
          let entry = entries.get(chunk.id)
          if (chunk.offset === 0) {
            const extension = IMAGE_EXTENSIONS[chunk.mimetype] ?? 'bin'
            const stagedName = `${chunk.id}.${extension}`
            entry = {
              file: { id: chunk.id, stagedName, name: chunk.name, mimetype: chunk.mimetype, size: 0 },
              path: path.join(open.paths.uploads, stagedName),
              written: 0,
              done: false,
            }
            entries.set(chunk.id, entry)
          }
          if (entry === undefined || entry.done || entry.written !== chunk.offset) return yield* new Rejected({ code: 'bad_chunk' })
          if (entry.written + chunk.bytes.byteLength > MAX_FILE_BYTES) {
            entries.delete(chunk.id)
            yield* removeFile(entry.path)
            return yield* new Rejected({ code: 'file_too_large' })
          }
          const target = entry
          // A disk that cannot take the bytes is not something the composer can fix.
          yield* io(() => (chunk.offset === 0 ? mkdir(path.dirname(target.path), { recursive: true }).then(() => writeFile(target.path, chunk.bytes)) : appendFile(target.path, chunk.bytes))).pipe(Effect.orDie)
          entry.written += chunk.bytes.byteLength
          if (!chunk.last) return null
          entry.done = true
          const header = yield* io(() => readHead(target.path)).pipe(Effect.orDie)
          const size = IMAGE_EXTENSIONS[entry.file.mimetype] === undefined ? undefined : imageSize(header)
          const file: PendingFile = { ...entry.file, size: entry.written, ...(size === undefined ? {} : { width: size.width, height: size.height }) }
          entries.set(chunk.id, { ...entry, file })
          return {
            id: file.id,
            name: file.name,
            mimetype: file.mimetype,
            size: file.size,
            ...(size === undefined ? {} : { width: size.width, height: size.height, preview: uploadsUrl(file.stagedName) }),
          }
        })

      const unstage = (id: string) =>
        Effect.gen(function* () {
          const entry = entries.get(id)
          if (entry === undefined) return
          entries.delete(id)
          yield* removeFile(entry.path)
        })

      const take = (ids: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const files: Array<PendingFile> = []
          for (const id of ids) {
            const entry = entries.get(id)
            if (entry === undefined || !entry.done) return yield* new Rejected({ code: 'file_not_found' })
            files.push(entry.file)
          }
          // The post owns them now; removing a chip later must not delete them.
          for (const id of ids) entries.delete(id)
          return files
        })

      const read = (open: OpenWorkspace, file: PendingFile) =>
        io(async () => new Uint8Array(await readFile(path.join(open.paths.uploads, file.stagedName)))).pipe(
          Effect.mapError(() => new Rejected({ code: 'file_not_found_on_device' })),
        )

      const release = (open: OpenWorkspace, files: ReadonlyArray<PendingFile>) =>
        Effect.forEach(files, (file) => removeFile(path.join(open.paths.uploads, file.stagedName)), { discard: true })

      /** Deletes staged bytes older than a day that no pending post and no chip names. */
      const sweep = (open: OpenWorkspace) =>
        Effect.gen(function* () {
          const posts = yield* pendingPosts.pipe(Effect.provide(open.context))
          const keep = new Set([...posts.flatMap((post) => post.files.map((file) => file.stagedName)), ...[...entries.values()].map((entry) => entry.file.stagedName)])
          const now = yield* Clock.currentTimeMillis
          const names = yield* io(() => readdir(open.paths.uploads))
          for (const name of names) {
            if (keep.has(name)) continue
            const info = yield* io(() => stat(path.join(open.paths.uploads, name)))
            if (now - info.mtimeMs > SWEEP_AFTER_MILLIS) yield* removeFile(path.join(open.paths.uploads, name))
          }
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('files: sweep failed', { cause })))

      // Chips belong to the workspace that staged them.
      yield* Effect.forkScoped(
        Stream.runForEach(workspace.changes, (open) =>
          Effect.gen(function* () {
            entries.clear()
            if (open !== undefined) yield* sweep(open)
          }),
        ),
      )

      return Staging.of({ stage, unstage, take, read, release })
    }),
  )
}

/** The url main serves a staged image at (`apps/desktop/src/main/files.ts`). */
export const uploadsUrl = (stagedName: string): string => `juno://uploads/${stagedName}`

const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => cause })

const removeFile = (file: string) => Effect.ignore(io(() => rm(file, { force: true })))

async function readHead(file: string): Promise<Uint8Array> {
  const handle = await openFile(file, 'r')
  try {
    const buffer = new Uint8Array(HEADER_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
