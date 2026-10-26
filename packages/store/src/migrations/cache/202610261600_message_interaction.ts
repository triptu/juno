import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

// What a press on a message's button sends back to Slack (`chat.attachmentAction`): whether the message is
// ephemeral, and its app's `bot_id` when `user_id` holds the app's user. The partial index keeps the store's
// open, which drops ephemeral messages, from reading every message.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE messages ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0`
  yield* sql`ALTER TABLE messages ADD COLUMN bot_id TEXT`
  yield* sql`CREATE INDEX messages_ephemeral ON messages(channel, ts) WHERE ephemeral = 1`
})
