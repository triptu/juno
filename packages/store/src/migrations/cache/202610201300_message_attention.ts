import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE messages ADD COLUMN attention INTEGER`
  yield* sql`ALTER TABLE messages ADD COLUMN attention_context TEXT`
  yield* sql`CREATE TRIGGER messages_attention_changed AFTER UPDATE OF text, blocks_json, attachments_json ON messages
    WHEN NEW.text IS NOT OLD.text OR NEW.blocks_json IS NOT OLD.blocks_json OR NEW.attachments_json IS NOT OLD.attachments_json
    BEGIN UPDATE messages SET attention = NULL, attention_context = NULL WHERE channel = NEW.channel AND ts = NEW.ts; END`
})
