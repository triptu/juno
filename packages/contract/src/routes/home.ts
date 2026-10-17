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
import { ChannelRef } from '../refs'

/** Ranked in this order: at most one of each, and at most three in all. */
export const HomeItemKind = Schema.Literals(['waiting', 'resume', 'moved', 'followUp', 'automated', 'tidyUp', 'automatedMoves'])
export type HomeItemKind = typeof HomeItemKind.Type

/**
 * Why Tidy up proposes a topic, from its latest messages (`settledEvidence`
 * in `@juno/domain`). The settled decision chose the topic; this is what it
 * read, so the review sheet can say it in plain words:
 *
 * - `thanks`: the last message thanks someone ("Ended with a thank-you from Maya").
 * - `done`: the last message says the work is done, merged or shipped.
 * - `agreed`: the last message agrees ("sounds good", "lgtm", a thumbs up).
 * - `afterYou`: you wrote last, answering someone, and nobody wrote since.
 * - `quiet`: nobody wrote since someone else's last message.
 */
export const SettledWhy = Schema.Struct({
  kind: Schema.Literals(['thanks', 'done', 'agreed', 'afterYou', 'quiet']),
  /** The first name of who wrote the last message. Absent when it was the user. */
  by: Schema.optionalKey(Schema.String),
  /** The decision's own clause, when a chat model gave one ("the fix was confirmed in staging"). */
  juno: Schema.optionalKey(Schema.String),
})
export type SettledWhy = typeof SettledWhy.Type

/**
 * A move the rules or Juno made to Automated, for the record card ("Juno
 * moved 2 channels to Automated", SPEC 12). The lines are facts from the
 * counts that decided the move.
 */
export const AutomatedMove = Schema.Struct({
  /** The conversation moved, for Move back and Keep. */
  channel: ChannelRef,
  /** `in`: Juno put it in Automated. `out`: Juno took it back out. */
  change: Schema.Literals(['in', 'out']),
  /** "Apps wrote 24 of the last 30 top-level messages", or "Moved back: people start most conversations here". */
  reason: Schema.String,
  /** A second line: Juno's own reason when Juno decided ("Juno: release tags from a bot"), or the counts behind a move back. */
  detail: Schema.optionalKey(Schema.String),
})
export type AutomatedMove = typeof AutomatedMove.Type

/** A topic as a Home row names it. */
export const HomeTopic = Schema.Struct({
  id: Schema.String,
  /** The topic's title, or the channel label for Main ("#eng", "Maya Chen"). */
  title: Schema.String,
  /** Where it lives: "eng", "Maya Chen". */
  place: Schema.String,
  /** The topic's art recipe for the tile. Absent shows the placeholder. */
  art: Schema.optionalKey(Schema.String),
  /** Tidy up: the topic's latest activity, epoch milliseconds. */
  at: Schema.optionalKey(Schema.Number),
  /** Tidy up: why it looks settled. */
  settled: Schema.optionalKey(SettledWhy),
  /** Automated's record: the move, on the conversation's Main. `at` is when it was made. */
  moved: Schema.optionalKey(AutomatedMove),
})
export type HomeTopic = typeof HomeTopic.Type

export const HomeItem = Schema.Struct({
  /** Stable for the same thing: `<kind>:<topic id>`, `followUp:<topic id>:<ts>`, `tidyUp`, `automated:<channel id>`, `automatedMoves`. */
  id: Schema.String,
  kind: HomeItemKind,
  /** The title line with AI off: "Elena asked you something", "3 topics look settled", "Move #ci-builds?". */
  title: Schema.String,
  /** A sharper title line from the assistant, only when it was confident. Never changes the meta line. */
  aiTitle: Schema.optionalKey(Schema.String),
  /** The topic the row opens; for Tidy up, the settled topics it resolves; for Automated's record, the Mains of the channels moved. */
  topics: Schema.Array(HomeTopic),
  /** Epoch milliseconds for the meta line's time: the question, the last visit, the promise. */
  at: Schema.optionalKey(Schema.Number),
  /** Moved a lot: the new messages since the user last read the topic. */
  newCount: Schema.optionalKey(Schema.Int),
  /** Follow-up: the user's message the promise was found in, for Mark done. */
  messageTs: Schema.optionalKey(Schema.String),
  /** Automated: the conversation asked about, for Move, Keep in All and its menu. Its Main is `topics[0]`. */
  channel: Schema.optionalKey(ChannelRef),
  /** Automated: why it is asked, one plain line for the meta line: "Apps wrote 18 of the last 30 messages", or Juno's reason. */
  reason: Schema.optionalKey(Schema.String),
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

/** Settings › Tidy up: how long a topic must be quiet before it is suggested. */
export const TidyUpQuiet = Schema.Literals(['1h', '4h', '1d', '3d'])
export type TidyUpQuiet = typeof TidyUpQuiet.Type

/** Settings › Tidy up, saved as the workspace preference `TIDY_UP_PREF`. */
export const TidyUpPrefs = Schema.Struct({
  quiet: TidyUpQuiet,
  /** Suggest threads. */
  threads: Schema.Boolean,
  /** Suggest the Main of a DM or group DM. */
  dms: Schema.Boolean,
})
export type TidyUpPrefs = typeof TidyUpPrefs.Type
export const TIDY_UP_PREF = 'tidyUp'
export const TIDY_UP_DEFAULTS: TidyUpPrefs = { quiet: '4h', threads: true, dms: true }
export const TIDY_UP_QUIET_MILLIS: Record<TidyUpQuiet, number> = { '1h': 3_600_000, '4h': 4 * 3_600_000, '1d': 86_400_000, '3d': 3 * 86_400_000 }

/** Reads the saved preference, filling what is missing or wrong from the defaults. */
export function tidyUpPrefsOf(value: unknown): TidyUpPrefs {
  const saved = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const quiet = TidyUpQuiet.literals.find((literal) => literal === saved.quiet) ?? TIDY_UP_DEFAULTS.quiet
  return {
    quiet,
    threads: typeof saved.threads === 'boolean' ? saved.threads : TIDY_UP_DEFAULTS.threads,
    dms: typeof saved.dms === 'boolean' ? saved.dms : TIDY_UP_DEFAULTS.dms,
  }
}

/** The most items Home shows; the renderer shows two on a window shorter than 600px. */
export const HOME_ITEM_LIMIT = 3

export const homeView = liveValueRoute('home.view', { value: HomeView })

/**
 * The user had `id` open for more than a minute, and was there until now.
 * The renderer calls it when the minute passes and again when the topic
 * leaves the screen. Feeds "Pick up where you left off".
 */
export const homeVisit = Rpc.make('home.visit', { payload: { id: Schema.String }, success: Schema.Void, error: NotSignedIn })

/** Home showed Automated's record card: it does not show again for a day. Its moves stay until they are seen. */
export const homeMovesShown = Rpc.make('home.movesShown', { payload: {}, success: Schema.Void, error: NotSignedIn })

/** The user opened Automated's record or dismissed its card: these conversations' moves are not listed again. */
export const homeMovesSeen = Rpc.make('home.movesSeen', { payload: { channels: Schema.Array(Schema.String) }, success: Schema.Void, error: NotSignedIn })

/** Mark done on a Follow-up: that promise does not come back. No undo. */
export const homeMarkDone = Rpc.make('home.markDone', {
  payload: { topicId: Schema.String, messageTs: Schema.String },
  success: Schema.Void,
  error: NotSignedIn,
})

export const HomeRoutes = RpcGroup.make(homeView, homeVisit, homeMarkDone, homeMovesShown, homeMovesSeen)
