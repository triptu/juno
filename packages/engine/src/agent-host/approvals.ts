/**
 * The owner's clicks on Juno Agent cards, in `user.db` (`agent_approvals`).
 * The renderer records each approved child (`agentWrites.approve`) before
 * the agent hears of the click. A host write takes the row for its action
 * and digest inside the write's own transaction, so:
 *
 * - no write runs without a click on that exact action and payload;
 * - a click is taken by one authorization only, so a replay, a second
 *   authorization or another revision of the same action is refused;
 * - a repeat of the authorization that took it finds it again, so the
 *   host's own repeat rules still answer it.
 */
import { AgentHostError } from '@juno/agent-contract'
import { StoreWriter } from '@juno/store'
import { Clock, Effect } from 'effect'

const now = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString())

/** Records approved children. A row already recorded is kept as it is, used or not. */
export const record = (children: ReadonlyArray<{ readonly actionId: string; readonly digest: string }>) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const at = yield* now
    for (const child of children) {
      yield* sql`INSERT INTO agent_approvals (action_id, digest, approved_at) VALUES (${child.actionId}, ${child.digest}, ${at}) ON CONFLICT DO NOTHING`
    }
  })

const notApproved = (message: string) => new AgentHostError({ reason: 'rejected', message })

/** Takes the click on `actionId` with `digest` for `authorizationId`, or fails. Run it in the write's transaction. */
export const take = (actionId: string, digest: string, authorizationId: string) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const rows = yield* sql<{ digest: string; used_by: string | null }>`SELECT digest, used_by FROM agent_approvals WHERE action_id = ${actionId}`
    if (rows.some((row) => row.used_by === authorizationId && row.digest === digest)) return
    if (rows.some((row) => row.used_by !== null)) return yield* notApproved('This approval was already used.')
    if (!rows.some((row) => row.digest === digest)) {
      return yield* notApproved(rows.length === 0 ? 'The owner did not approve this action.' : 'The action differs from what the owner approved.')
    }
    const at = yield* now
    yield* sql`UPDATE agent_approvals SET used_by = ${authorizationId}, used_at = ${at} WHERE action_id = ${actionId} AND digest = ${digest} AND used_by IS NULL`
  })
