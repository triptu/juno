import { Context, Layer } from 'effect'
import * as path from 'node:path'

/**
 * The files of one workspace directory. `<userData>/workspaces/<workspaceId>/`
 * holds `cache.db` (the disposable Slack mirror), `user.db` (durable Juno
 * data) and `uploads/` (staged files waiting in the outbox).
 */
export interface WorkspacePaths {
  readonly dir: string
  readonly cacheDb: string
  readonly userDb: string
  readonly uploads: string
}

export const CACHE_DB_FILE = 'cache.db'
export const USER_DB_FILE = 'user.db'
export const UPLOADS_DIR = 'uploads'

/** Paths for one workspace directory. */
export const workspacePathsFromDir = (dir: string): WorkspacePaths => ({
  dir,
  cacheDb: path.join(dir, CACHE_DB_FILE),
  userDb: path.join(dir, USER_DB_FILE),
  uploads: path.join(dir, UPLOADS_DIR),
})

/**
 * Paths for a workspace under the app's user data directory. `workspaceId` is
 * the `team_id`, prefixed with the `enterprise_id` on Enterprise Grid
 * (`<enterprise_id>-<team_id>`), so two teams of one org keep apart.
 */
export const workspacePaths = (userData: string, workspaceId: string): WorkspacePaths =>
  workspacePathsFromDir(path.join(userData, 'workspaces', workspaceId))

/** The workspace directory the store opens. */
export class StorePaths extends Context.Service<StorePaths, WorkspacePaths>()('juno/store/StorePaths') {
  static readonly layer = (paths: WorkspacePaths): Layer.Layer<StorePaths> => Layer.succeed(StorePaths, paths)
  static readonly layerFromDir = (dir: string): Layer.Layer<StorePaths> =>
    Layer.succeed(StorePaths, workspacePathsFromDir(dir))
}
