/**
 * The Slack client and workspace url of the ready session, as top-level modules see them.
 *
 * A top-level module, like `workspace.ts`, so the outbox (and through it the
 * topic commands) can call Slack without importing the session feature:
 * feature folders do not import each other, and top-level modules do not
 * import feature folders (architecture section 3). The session feature
 * provides the implementation (`session/client.ts`); the composition layer
 * wires it.
 */
import { Context } from 'effect'
import type { Effect } from 'effect'
import type { NotSignedIn } from '@juno/contract'
import type { SlackApiShape } from '@juno/slack'

export class SessionClient extends Context.Service<
  SessionClient,
  {
    /** The ready session's `SlackApi`. Fails with `NotSignedIn` when there is no session. */
    readonly api: Effect.Effect<SlackApiShape, NotSignedIn>
    /** The ready session's workspace url, as `auth.test` gave it (`https://<team>.slack.com/`). Fails with `NotSignedIn` when there is no session. */
    readonly workspaceUrl: Effect.Effect<string, NotSignedIn>
  }
>()('juno/engine/SessionClient') {}
