import { rmSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Store, workspacePathsFromDir, type WorkspacePaths } from '@juno/store'

let template: Promise<WorkspacePaths> | undefined

async function createTemplate(): Promise<WorkspacePaths> {
  const paths = workspacePathsFromDir(await mkdtemp(join(tmpdir(), 'juno-engine-schema-')))
  try {
    // Closing the real store checkpoints its WAL before either database is copied.
    await Effect.runPromise(Effect.void.pipe(Effect.provide(Store.layer(paths))))
    // Removed when the process exits, not after a file: files that share a process share the template.
    process.once('exit', () => rmSync(paths.dir, { recursive: true, force: true }))
    return paths
  } catch (error) {
    await rm(paths.dir, { recursive: true, force: true })
    throw error
  }
}

/** Copies only the empty schema. Every engine still signs in and performs its own cold sync. */
export async function migratedWorkspace(paths: WorkspacePaths): Promise<void> {
  const source = await (template ??= createTemplate())
  await mkdir(paths.dir, { recursive: true })
  await Promise.all([
    copyFile(source.userDb, paths.userDb),
    copyFile(source.cacheDb, paths.cacheDb),
  ])
}
