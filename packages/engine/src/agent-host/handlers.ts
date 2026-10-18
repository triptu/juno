/**
 * `agentWrites.approve`: the renderer records the owner's click on a Juno
 * Agent card before it tells the agent (`approvals.ts`). The agent has no
 * way to this route; it reaches the engine only through the AgentHost port.
 */
import { Effect } from 'effect'
import { AgentWritesRoutes, NotSignedIn } from '@juno/contract'
import { transaction } from '@juno/store'
import { Workspace } from '../workspace'
import * as approvals from './approvals'

export const AgentWritesHandlers = AgentWritesRoutes.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Workspace
    return {
      'agentWrites.approve': ({ children }) =>
        Effect.gen(function* () {
          const open = yield* workspace.current
          if (open === undefined) return yield* new NotSignedIn()
          // A store failure is a bug, not a state the owner can act on (architecture 2.6).
          yield* transaction(approvals.record(children)).pipe(Effect.provide(open.context), Effect.orDie)
        }),
    }
  }),
)
