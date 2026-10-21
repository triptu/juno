/**
 * Handlers for the session routes. The live value re-runs on every status
 * change with no debounce; the commands run on the `Session` service and
 * return once the session is verified (or fail with `SignInFailed`).
 */
import { Effect, Stream } from 'effect'
import { SessionRoutes } from '@juno/contract'
import { EngineConfig } from '../config'
import { StoreReader } from '@juno/store'
import { Workspace } from '../workspace'
import { personFrom, type UserRow } from '../topicRows'
import { serveWorkspaceValue, serveLiveValue, timed } from '../protocol/live'
import { Session } from './Session'

export const SessionHandlers = SessionRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    const session = yield* Session
    const config = yield* EngineConfig
    const measure = config.e2e || config.dev
    return {
      'session.profile': () => serveWorkspaceValue(workspace.changes, 'session.profile', ['users', 'team'], Effect.gen(function* () {
        const sql = yield* StoreReader
        const [user] = yield* sql<UserRow>`SELECT u.id, u.name, u.display_name, u.real_name, u.avatar_url, u.avatar_small_url, u.avatar_large_url
          FROM users u JOIN team t ON t.self_user_id = u.id LIMIT 1`
        return user === undefined ? null : personFrom(user.id, user)
      })),
      'session.status': () => serveLiveValue(session.statuses.pipe(Stream.mapEffect(() => Effect.result(timed(session.status)))), { measure }),
      'session.importFromSlackApp': () => session.signIn('import'),
      'session.signOut': () => session.signOut,
    }
  }),
)
