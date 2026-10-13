/**
 * Topic art commands (SPEC section 5, "Row anatomy"; `docs/design/topic-art/v2`).
 * The art itself travels with the topics: `topics.list` sends recipes in
 * the delta's `refs.art`, `topics.get` in `TopicDetail.art`.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { AiUnavailable, NotFound, NotSignedIn } from '../errors'

/**
 * Why a redraw did not happen: no workspace, an id that is not a topic a
 * drawing can be made for (a DM's Main keeps its photo), or AI assist off,
 * the daily budget spent, or the model answering nothing usable.
 */
export const RedrawError = Schema.Union([NotSignedIn, NotFound, AiUnavailable])
export type RedrawError = typeof RedrawError.Type

/**
 * "Redraw" in a topic's menu: asks the model for a new drawing that differs
 * from the stored one and replaces it. Waits for the answer (about 2 to
 * 10 s); the new recipe reaches the rows and the header through their live
 * queries, so the command returns nothing.
 */
export const artRedraw = Rpc.make('art.redraw', { payload: { id: Schema.String }, success: Schema.Void, error: RedrawError })

export const ArtRoutes = RpcGroup.make(artRedraw)
