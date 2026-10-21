/**
 * `PictureCache`: the image files of Home's pictures on disk (SPEC 12, "A
 * picture"; decision home-picture-cache). The catalog is bundled in the
 * renderer; this keeps only the files, under `<userData>/pictures/` as
 * `<id>-<size>.webp`, where main serves them as `juno://pictures/<name>`.
 *
 * Files come from Juno's public picture store (`PICTURES_URL`), or from the
 * fake Slack in tests and against the fake, so no test reaches the
 * network. A download sends nothing but the file's name. It is written to
 * a `.part` file and renamed, so a file on disk is always whole. Two
 * downloads run at a time, and a file asked for twice is downloaded once.
 */
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Context, Effect, Layer } from 'effect'
import type { PictureSize } from '@juno/contract'
import { EngineConfig } from '../config'

/** The public, read-only R2 bucket `juno-art` (scripts/pictures/README.md). */
export const PICTURES_URL: string | undefined = 'https://pub-f2385276dc3043fda2d34a4e3e1c7d28.r2.dev/'

/** A picture id: lower-case letters, digits and single hyphens (`@juno/pictures`). */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(small|large)\.webp$/
/** Larger than any large picture; a bigger answer is not ours. */
const MAX_BYTES = 8 * 1024 * 1024
const TIMEOUT_MILLIS = 30_000
/** Downloads at a time. */
const LANES = 2

export const pictureFileName = (id: string, size: PictureSize): string => `${id}-${size}.webp`

export interface PictureCacheShape {
  /** Downloads the file unless it is on disk; true when it is on disk afterwards. */
  readonly fetch: (id: string, size: PictureSize) => Effect.Effect<boolean>
  /** The ids whose file of this size is on disk. */
  readonly onDisk: (size: PictureSize) => Effect.Effect<ReadonlyArray<string>>
}

export class PictureCache extends Context.Service<PictureCache, PictureCacheShape>()('juno/engine/PictureCache') {
  /** `download` replaces the network in unit tests. */
  static readonly make = (options: { readonly dir: string; readonly baseUrl: string | undefined; readonly download?: (url: string) => Promise<Uint8Array | undefined> }) =>
    Effect.sync(() => {
      const running = new Map<string, Promise<boolean>>()
      let active = 0
      const waiting: Array<() => void> = []
      const inLane = async <A>(task: () => Promise<A>): Promise<A> => {
        if (active >= LANES) await new Promise<void>((resolve) => waiting.push(resolve))
        active++
        try {
          return await task()
        } finally {
          active--
          waiting.shift()?.()
        }
      }
      const download = options.download ?? downloadImage
      const exists = (file: string) => stat(file).then((info) => info.isFile() && info.size > 0, () => false)

      const save = async (name: string): Promise<boolean> => {
        const file = path.join(options.dir, name)
        if (await exists(file)) return true
        if (options.baseUrl === undefined) return false
        const bytes = await download(new URL(name, options.baseUrl).toString()).catch(() => undefined)
        if (bytes === undefined) return false
        const part = `${file}.${process.pid}.part`
        try {
          await mkdir(options.dir, { recursive: true })
          await writeFile(part, bytes)
          await rename(part, file)
          return true
        } catch {
          await rm(part, { force: true })
          return false
        }
      }

      const fetch = (id: string, size: PictureSize): Effect.Effect<boolean> =>
        Effect.suspend(() => {
          if (!ID.test(id)) return Effect.succeed(false)
          const name = pictureFileName(id, size)
          const started = running.get(name) ?? inLane(() => save(name)).finally(() => running.delete(name))
          running.set(name, started)
          return Effect.promise(() => started)
        })

      const onDisk = (size: PictureSize): Effect.Effect<ReadonlyArray<string>> =>
        Effect.promise(async () => {
          const names = await readdir(options.dir).catch(() => [] as string[])
          return names.flatMap((name) => {
            const match = FILE.exec(name)
            return match !== null && match[2] === size ? [match[1]!] : []
          })
        })

      return PictureCache.of({ fetch, onDisk })
    })

  /** Under `<userData>/pictures/`, from the fake Slack when there is one, else from `PICTURES_URL`. */
  static readonly layer = Layer.effect(
    PictureCache,
    Effect.gen(function* () {
      const config = yield* EngineConfig
      const baseUrl = config.fakeSlackUrl === undefined ? PICTURES_URL : new URL('/pictures/', config.fakeSlackUrl).toString()
      return yield* PictureCache.make({ dir: path.join(config.userData, 'pictures'), baseUrl: baseUrl === undefined ? undefined : baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/` })
    }),
  )
}

/** A WebP from a public URL, or undefined for anything else. */
async function downloadImage(url: string): Promise<Uint8Array | undefined> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MILLIS) })
  if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'image/webp') return undefined
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) return undefined
  const bytes = new Uint8Array(await response.arrayBuffer())
  return bytes.length > 0 && bytes.length <= MAX_BYTES ? bytes : undefined
}
