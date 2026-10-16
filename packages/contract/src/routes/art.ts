/**
 * Topic art commands (SPEC section 5, "Row anatomy"; `docs/design/topic-art/v2`).
 * The art itself travels with the topics: `topics.list` sends recipes in
 * the delta's `refs.art`, `topics.get` in `TopicDetail.art`.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { AiUnavailable, NotFound, NotSignedIn } from '../errors'
import { artRestorePayload, CommandResult } from './topics'

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
 * queries. Returns the undo, `art.restore` with the drawing before.
 */
export const artRedraw = Rpc.make('art.redraw', { payload: { id: Schema.String }, success: CommandResult, error: RedrawError })

/** Puts a topic's drawing back as it was before a redraw, or removes it when there was none: the undo of `art.redraw`. */
export const artRestore = Rpc.make('art.restore', { payload: artRestorePayload, success: Schema.Void, error: NotSignedIn })

/**
 * Whether Redraw art can draw now, for the topic menu: AI assist on, an
 * OpenRouter key, and today's AI spend cap not reached for the engine's
 * calls. False with no workspace. Answers within a fraction of a second;
 * when the spend ledger is slow to say, it answers true and Redraw art
 * says why if it then cannot draw.
 */
export const artAvailable = Rpc.make('art.available', { success: Schema.Boolean })

export const ArtRoutes = RpcGroup.make(artRedraw, artRestore, artAvailable)
