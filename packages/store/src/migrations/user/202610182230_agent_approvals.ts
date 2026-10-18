import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * The owner's clicks on Juno Agent cards, as the engine saw them (decision
 * of 10-18). The renderer records each approved child here before it tells
 * the agent, and the host writes to Slack only for a dispatch whose action
 * and digest match an unused row. `used_by` is the authorization that took
 * it: one click, one write, whatever the agent asks for later.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Safe to run again, as later migrations must be (test/migrations.test.ts).
  yield* sql`CREATE TABLE IF NOT EXISTS agent_approvals (
    action_id TEXT NOT NULL,
    digest TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    used_by TEXT,
    used_at TEXT,
    PRIMARY KEY (action_id, digest)
  )`
})
