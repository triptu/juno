/**
 * Home (SPEC section 12, `docs/design/home/`): what wants the user, Mark
 * done, and the visit log behind "Pick up where you left off". Resolve all
 * is `topics.resolve` per topic, with one undo (`topics.restoreAll`).
 *
 * `home.view` is computed from the local cache only, never from Slack or a
 * model before it answers. It is a live value so a title rewrite from the
 * assistant reaches a Home that is on screen; the renderer keeps the items
 * it showed when Home appeared and takes only their `aiTitle` from later
 * values, so a row never moves or leaves under the pointer.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotSignedIn } from '../errors'
import { liveValueRoute } from '../live'

/** Ranked in this order: at most one of each, and at most three in all. */
export const HomeItemKind = Schema.Literals(['waiting', 'resume', 'moved', 'followUp', 'tidyUp'])
export type HomeItemKind = typeof HomeItemKind.Type

/** A topic as a Home row names it. */
export const HomeTopic = Schema.Struct({
  id: Schema.String,
  /** The topic's title, or the channel label for Main ("#eng", "Maya Chen"). */
  title: Schema.String,
  /** Where it lives: "eng", "Maya Chen". */
  place: Schema.String,
  /** The topic's art recipe for the tile. Absent shows the placeholder. */
  art: Schema.optionalKey(Schema.String),
})
export type HomeTopic = typeof HomeTopic.Type

export const HomeItem = Schema.Struct({
  /** Stable for the same thing: `<kind>:<topic id>`, `followUp:<topic id>:<ts>`, `tidyUp`. */
  id: Schema.String,
  kind: HomeItemKind,
  /** The title line with AI off: "Elena asked you something", "3 topics look settled". */
  title: Schema.String,
  /** A sharper title line from the assistant, only when it was confident. Never changes the meta line. */
  aiTitle: Schema.optionalKey(Schema.String),
  /** The topic the row opens; for Tidy up, the settled topics it resolves. */
  topics: Schema.Array(HomeTopic),
  /** Epoch milliseconds for the meta line's time: the question, the last visit, the promise. */
  at: Schema.optionalKey(Schema.Number),
  /** Moved a lot: the new messages since the user last read the topic. */
  newCount: Schema.optionalKey(Schema.Int),
  /** Follow-up: the user's message the promise was found in, for Mark done. */
  messageTs: Schema.optionalKey(Schema.String),
})
export type HomeItem = typeof HomeItem.Type

export const HomeView = Schema.Struct({
  /** From the Slack profile. Absent drops the name from the greeting. */
  firstName: Schema.optionalKey(Schema.String),
  /** Ranked, at most three. */
  items: Schema.Array(HomeItem),
  /** A followed topic has unread messages. With no items and none of these, the user is caught up. */
  unread: Schema.Boolean,
  /**
   * The workspace has finished a first sync, so the cache can say what
   * waits. Until then Home shows nothing rather than "All caught up".
   */
  ready: Schema.Boolean,
})
export type HomeView = typeof HomeView.Type

/** The most items Home shows; the renderer shows two on a window shorter than 600px. */
export const HOME_ITEM_LIMIT = 3

export const homeView = liveValueRoute('home.view', { value: HomeView })

/**
 * The user had `id` open for more than a minute, and was there until now.
 * The renderer calls it when the minute passes and again when the topic
 * leaves the screen. Feeds "Pick up where you left off".
 */
export const homeVisit = Rpc.make('home.visit', { payload: { id: Schema.String }, success: Schema.Void, error: NotSignedIn })

/** Mark done on a Follow-up: that promise does not come back. No undo. */
export const homeMarkDone = Rpc.make('home.markDone', {
  payload: { topicId: Schema.String, messageTs: Schema.String },
  success: Schema.Void,
  error: NotSignedIn,
})

export const HomeRoutes = RpcGroup.make(homeView, homeVisit, homeMarkDone)
