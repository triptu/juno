/**
 * `Staging`: the files a composer holds before they are sent (architecture
 * 9). The renderer sends each file's bytes in chunks (`files.stage`); they
 * are written under the open workspace's `uploads/` folder as
 * `<id>.<ext>`, so the outbox can upload them later, after a restart too.
 * An image is named with its own extension, which is how main knows it may
 * serve it as `juno://uploads/<name>` for the chip and the pending row.
 *
 * What the composer attached is remembered in memory until it is sent or
 * removed. A send may take a file that is still staging (Enter before the
 * last chunk, spec section 8): its post names it at once, marked `staging`,
 * and the rest of its chunks still come here. The post worker asks
 * `status` before it uploads, and waits for `settled` while the file is
 * being written; the composer's `files.unstage` for such a file means the
 * rest will not come, and the post fails. Staged bytes that no pending post names, and that no sent
 * message still shows (`uploaded_files`), are deleted a day after they were
 * written (`sweep`, when a workspace opens).
 */
import { appendFile, mkdir, open as openFile, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Clock, Context, Effect, Layer, PubSub, Stream } from 'effect'
import { MAX_FILE_BYTES, NotSignedIn, Rejected, type StagedFile, type StageError } from '@juno/contract'
import { pendingPosts, uploadedNames, type PendingFile } from '@juno/sync'
import { Workspace, type OpenWorkspace } from './workspace'
import { imageSize } from '@juno/agent-contract'

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
  /** The whole file's bytes, with the first chunk. */
  readonly size?: number | undefined
  readonly bytes: Uint8Array
  readonly last: boolean
}

interface Entry {
  file: PendingFile
  readonly path: string
  /** Bytes written so far. */
  written: number
  done: boolean
  /** A send took it while it was staging, and the rest of its bytes will not come. */
  failed: boolean
}

/** How far a file a post took while it was staging has got. `unknown` after a restart, which loses the rest of its bytes. */
export type StagingStatus =
  | { readonly _tag: 'writing' }
  | { readonly _tag: 'ready'; readonly file: PendingFile }
  | { readonly _tag: 'failed' }
  | { readonly _tag: 'unknown' }

export class Staging extends Context.Service<
  Staging,
  {
    /** Writes one chunk. The last answers the file as its chip shows it. */
    readonly stage: (chunk: StageChunk) => Effect.Effect<StagedFile | null, StageError>
    readonly unstage: (id: string) => Effect.Effect<void>
    /**
     * The staged files `ids` name, in order, for a post. A file still
     * staging is taken as it is, marked `staging`. `file_not_found` for one
     * that is missing.
     */
    readonly take: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<PendingFile>, Rejected>
    /** How far a file a post took while it was staging has got. A ready file is forgotten once asked about; a failed one at `release`. */
    readonly status: (id: string) => Effect.Effect<StagingStatus>
    /** A file a post took while it was staging finished, or will not. */
    readonly settled: Stream.Stream<void>
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
      // Files a post took while they were staging, until the worker has the complete file or the post is discarded.
      const claimed = new Map<string, Entry>()
      const settles = yield* PubSub.unbounded<void>()
      const settle = Effect.asVoid(PubSub.publish(settles, undefined))

      const stage = (chunk: StageChunk): Effect.Effect<StagedFile | null, StageError> =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          if (!ID.test(chunk.id)) return yield* new Rejected({ code: 'bad_chunk' })
          const taken = claimed.get(chunk.id)
          if (taken !== undefined) return yield* stageClaimed(taken, chunk)
          let entry = entries.get(chunk.id)
          // The composer names a file with an empty first chunk before it reads any bytes; the bytes start at 0 again.
          if (chunk.offset === 0 && (entry === undefined || entry.written > 0 || entry.done)) {
            const extension = IMAGE_EXTENSIONS[chunk.mimetype] ?? 'bin'
            const stagedName = `${chunk.id}.${extension}`
            entry = {
              file: { id: chunk.id, stagedName, name: chunk.name, mimetype: chunk.mimetype, size: chunk.size ?? 0 },
              path: path.join(open.paths.uploads, stagedName),
              written: 0,
              done: false,
              failed: false,
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
          const file = yield* finish(entry)
          // A send took it while this chunk was being written: its post waits for it.
          if (claimed.get(chunk.id) === entry) yield* settle
          return stagedOf(file)
        })

      /** A chunk of a file a post took while it was staging. A refused chunk fails the post; the last makes it ready. */
      const stageClaimed = (entry: Entry, chunk: StageChunk): Effect.Effect<StagedFile | null, StageError> =>
        Effect.gen(function* () {
          if (entry.done || entry.failed) return yield* new Rejected({ code: 'bad_chunk' })
          if (entry.written !== chunk.offset || entry.written + chunk.bytes.byteLength > MAX_FILE_BYTES) {
            entry.failed = true
            yield* settle
            return yield* new Rejected({ code: entry.written === chunk.offset ? 'file_too_large' : 'bad_chunk' })
          }
          yield* io(() => appendFile(entry.path, chunk.bytes)).pipe(Effect.orDie)
          entry.written += chunk.bytes.byteLength
          if (!chunk.last) return null
          const file = yield* finish(entry)
          yield* settle
          return stagedOf(file)
        })

      /** The last chunk is written: the file's size, and an image's pixel size from its header. */
      const finish = (entry: Entry) =>
        Effect.gen(function* () {
          entry.done = true
          const header = yield* io(() => readHead(entry.path)).pipe(Effect.orDie)
          const size = IMAGE_EXTENSIONS[entry.file.mimetype] === undefined ? undefined : imageSize(header)
          const { staging: _, ...rest } = entry.file
          entry.file = { ...rest, size: entry.written, ...(size === undefined ? {} : { width: size.width, height: size.height }) }
          return entry.file
        })

      const status = (id: string): Effect.Effect<StagingStatus> =>
        Effect.sync(() => {
          const entry = claimed.get(id)
          if (entry === undefined) return { _tag: 'unknown' } as const
          if (entry.failed) return { _tag: 'failed' } as const
          if (!entry.done) return { _tag: 'writing' } as const
          // The worker keeps the complete file on the post now.
          claimed.delete(id)
          return { _tag: 'ready', file: entry.file } as const
        })

      const unstage = (id: string) =>
        Effect.gen(function* () {
          const taken = claimed.get(id)
          // A post owns it: only a file still staging changes, to failed.
          if (taken !== undefined) {
            if (!taken.done && !taken.failed) {
              taken.failed = true
              yield* settle
            }
            return
          }
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
            if (entry === undefined) return yield* new Rejected({ code: 'file_not_found' })
            files.push(entry.done ? entry.file : { ...entry.file, staging: true })
          }
          // The post owns them now; removing a chip later must not delete them.
          for (const id of ids) {
            const entry = entries.get(id)
            entries.delete(id)
            if (entry !== undefined && !entry.done) claimed.set(id, entry)
          }
          return files
        })

      const read = (open: OpenWorkspace, file: PendingFile) =>
        io(async () => new Uint8Array(await readFile(path.join(open.paths.uploads, file.stagedName)))).pipe(
          Effect.mapError(() => new Rejected({ code: 'file_not_found_on_device' })),
        )

      const release = (open: OpenWorkspace, files: ReadonlyArray<PendingFile>) =>
        Effect.forEach(
          files,
          (file) =>
            Effect.suspend(() => {
              claimed.delete(file.id)
              return removeFile(path.join(open.paths.uploads, file.stagedName))
            }),
          { discard: true },
        )

      /** Deletes staged bytes older than a day that no pending post and no chip names. */
      const sweep = (open: OpenWorkspace) =>
        Effect.gen(function* () {
          const posts = yield* pendingPosts.pipe(Effect.provide(open.context))
          // A sent image's copy stays while its message shows it, until Slack's thumbnails arrive (`uploaded_files`).
          const shown = yield* uploadedNames.pipe(Effect.provide(open.context))
          const keep = new Set([...posts.flatMap((post) => post.files.map((file) => file.stagedName)), ...shown, ...[...entries.values()].map((entry) => entry.file.stagedName)])
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
            claimed.clear()
            if (open !== undefined) yield* sweep(open)
          }),
        ),
      )

      return Staging.of({ stage, unstage, take, status, settled: Stream.fromPubSub(settles), read, release })
    }),
  )
}

/** The url main serves a staged image at (`apps/desktop/src/main/files.ts`). */
export const uploadsUrl = (stagedName: string): string => `juno://uploads/${stagedName}`

const stagedOf = (file: PendingFile): StagedFile => ({
  id: file.id,
  name: file.name,
  mimetype: file.mimetype,
  size: file.size,
  ...(file.width === undefined || file.height === undefined ? {} : { width: file.width, height: file.height, preview: uploadsUrl(file.stagedName) }),
})

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
