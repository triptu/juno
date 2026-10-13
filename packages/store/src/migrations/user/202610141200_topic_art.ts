import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Topic art (docs/design/topic-art/v2). One row per topic that has been
 * drawn, or tried: `recipe` is the canonical recipe `@juno/topic-art`
 * rebuilds the SVG from, `status` says whether it is shown (`ok`), kept
 * only so the topic is not tried again (`unsure`, the model had nothing to
 * draw; `failed`, twice outside the vocabulary). `title_source` is what the
 * title was drawn from, so a thread drawn from its first words is drawn
 * again once it has an AI title. Durable: art is cached for good and only
 * "Redraw" replaces it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE topic_art (
    topic_id TEXT PRIMARY KEY,
    recipe TEXT NOT NULL,
    recipe_hash TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    hue TEXT NOT NULL,
    title_source TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`
  yield* sql`CREATE INDEX topic_art_created ON topic_art (created_at)`
})
