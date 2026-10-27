/**
 * Topic drafts synced with Slack (SPEC 8 "Drafts", architecture 5.7,
 * specs/drafts.qnt, research `slack-drafts.md`). Juno's draft of a topic is
 * what the composer shows; Slack keeps one attached draft per channel and
 * per thread. These rules decide what a version from Slack (an event, a
 * list entry, a deletion) does to Juno's draft:
 *
 * - Stale: no newer than the newest stamp Juno has seen for the place
 *   (`slackStamp`), or of a draft Juno deleted, sent or saw deleted
 *   (`gone`; Slack never reuses an id). Nothing changes.
 * - Of a draft whose text went as a message (`sent`, by Slack's id, or by
 *   the create's `client_msg_id` while Juno has not had the id), whatever
 *   the clocks say: with one of Juno's texts it is the sent text and never
 *   comes back; the link to a draft with files stays (its files kept, the
 *   cleared text goes over it), and any other such draft is for Juno to
 *   delete (`cleanup: 'delete'`). With another text, another device changed
 *   it after the send: it is the place's draft and is not deleted
 *   (`cleanup: 'keep'`); it applies over a draft the send emptied, and when
 *   newer local typing wins over it, it is kept for ⌘Z.
 * - Juno's own: the text Juno has, is sending, or sent in a call whose
 *   answer was lost (`unsure`, until a list after the loss). Only the link
 *   changes; when Juno's text has moved on, it goes over it.
 * - Older than a local edit Slack has not acknowledged (`pending`, by the
 *   edit's time on Juno's clock against Slack's stamp): the local edit stays
 *   and is saved over it. This is the one rule that compares the two clocks;
 *   it assumes they agree to within a few seconds, and within that both
 *   edits were made at nearly the same moment.
 * - Otherwise Juno's draft takes it. When a save is out, or one whose
 *   answer was lost, it is saved again: that save may land after it (that
 *   resave is no local edit). A local edit Slack had not acknowledged that
 *   it replaces is kept (`replaced`): on a clock running behind Slack's it
 *   may be the newer edit, and ⌘Z in the composer brings it back. The kept
 *   text stays until a local change lets it go (typing, ⌘Z, a send, a
 *   clear); a later version never replaces it, so text from Slack is never
 *   kept over it.
 *
 * A composer being typed in keeps its text whatever this decides: the
 * renderer leaves a focused field that was typed in alone, and its next edit
 * is newer than anything Slack sent before it.
 *
 * A deletion says so (`deleted`); a live draft with files and no text is
 * not one, and stays linked. A deletion of a draft Juno does not link only
 * marks it gone. A draft missing from a complete list requested after Juno
 * linked it counts as deleted just after the version Juno knew (`absent`),
 * so local edits Slack has not seen survive it and go as a new draft. A
 * local clear has a time of its own (the store's `cleared_at`), which its
 * deletion carries and is compared by. A list that looks for the place's draft after a lost
 * create or `attached_draft_exists`, while Juno links none (`find`), takes
 * its entry whatever its stamp.
 */

/** Juno's draft of one topic and what it knows of Slack's. Times are epoch milliseconds. */
export interface DraftState {
  /** The composer's encoded text (`encodeDraft`); `''` for no draft. */
  readonly text: string
  /** When the draft last changed, emptied included: Juno's clock for a local edit or clear, Slack's stamp for a version taken from Slack. */
  readonly editedAt: number
  /** Slack's id for the topic's draft, when Juno links one. */
  readonly slackId?: string
  /** The newest Slack stamp Juno has seen for the place. */
  readonly slackStamp?: number
  /** When Juno linked `slackId`, on its clock. */
  readonly seenAt?: number
  /** The text of the newest version Juno has seen of the draft it links: a send counts it among Juno's texts. */
  readonly slackText?: string
  /** A local edit Slack has not acknowledged. A save that only puts a version from Slack back is not one. */
  readonly pending: boolean
  /** The text of the call out, `''` for a delete. */
  readonly sending?: string
  /** Texts of calls whose answers were lost, until a list after the loss. */
  readonly unsure: ReadonlyArray<string>
  /** Slack drafts Juno deleted, sent or saw deleted. */
  readonly gone: ReadonlyArray<string>
  /** Drafts whose text went as a message, until Slack confirms them gone. */
  readonly sent: ReadonlyArray<SentVersion>
  /** Text that lost to the other side and ⌘Z brings back: Juno's local edit a version from another device replaced before Slack had it, or another device's text on a sent draft that newer local typing went over. */
  readonly replaced?: string
}

/** A draft whose text went as a message, and Juno's texts that can be on it: the one sent, and those of calls still out or lost. */
export interface SentVersion {
  /** Slack's id, once Juno has it. */
  readonly id?: string
  /** The `client_msg_id` of Juno's create, for a draft whose create was not answered when the text went. */
  readonly clientMsgId?: string
  readonly texts: ReadonlyArray<string>
  /** When it went, on Juno's clock: it is forgotten 30 days on. */
  readonly at: number
}

/** A version of the place's draft from Slack. */
export interface SlackDraft {
  readonly id: string
  /** The composer's encoded text for its blocks (`draftMarkup`); `''` for none (a draft of files alone, or deleted). */
  readonly text: string
  /** Slack's update stamp; a deletion's time for a deletion. */
  readonly stamp: number
  /** Deleted or sent: the draft is no longer live. */
  readonly deleted: boolean
  /** The `client_msg_id` its create had. */
  readonly clientMsgId?: string
}

/**
 * - `stale`: older than what Juno knows, or of a draft that is gone;
 * - `linked`: Juno's own text, or the same; only the link changes;
 * - `kept`: Juno's newer local edit stays and is saved over it;
 * - `applied`: Juno's draft takes Slack's version.
 */
export type DraftOutcome = 'stale' | 'linked' | 'kept' | 'applied'

export interface ObservedDraft {
  readonly state: DraftState
  readonly outcome: DraftOutcome
  /** Juno's text must go to Slack: a pending row is needed, and is due now. */
  readonly save: boolean
  /** For a draft whose text went as a message: delete it (it holds only Juno's text), or keep it (another device changed it). */
  readonly cleanup?: 'delete' | 'keep'
}

export interface ObserveHow {
  /** Juno's clock when it learned of the version. */
  readonly seenAt: number
  /** A complete list without the linked draft. */
  readonly absent?: boolean
  /** A list looking for the place's draft while Juno links none. */
  readonly find?: boolean
  /** Compares two encoded texts as Slack would store them. */
  readonly same: (a: string, b: string) => boolean
}

/** How many gone drafts a topic remembers; older ones can no longer come back from a list or an event. */
export const GONE_KEPT = 20

const withGone = (gone: ReadonlyArray<string>, id: string): ReadonlyArray<string> => (gone.includes(id) ? gone : [...gone, id].slice(-GONE_KEPT))

/** Applies a version from Slack by the rules above. */
export function observeSlackDraft(state: DraftState, slack: SlackDraft, how: ObserveHow): ObservedDraft {
  const stale = (how.absent !== true && how.find !== true && state.slackStamp !== undefined && state.slackStamp >= slack.stamp) || state.gone.includes(slack.id)
  if (stale) return { state, outcome: 'stale', save: false }
  const sentAs = state.sent.find((each) => each.id === slack.id || (slack.clientMsgId !== undefined && each.clientMsgId === slack.clientMsgId))
  if (sentAs !== undefined) return observeSentDraft(state, sentAs, slack, how)
  return observeVersion(state, slack, how)
}

/** A version of a draft whose text went as a message, by the rules above. */
function observeSentDraft(state: DraftState, sentAs: SentVersion, slack: SlackDraft, how: ObserveHow): ObservedDraft {
  const others = state.sent.filter((each) => each !== sentAs)
  // Slack has it gone: nothing to delete, and it is forgotten.
  if (slack.deleted) return observeVersion({ ...state, sent: others }, slack, how)
  if (sentAs.texts.some((text) => how.same(text, slack.text))) {
    const known = { ...state, sent: state.sent.map((each) => (each === sentAs ? { ...each, id: slack.id } : each)) }
    if (state.slackId !== slack.id) return { state: known, outcome: 'linked', save: false, cleanup: 'delete' }
    return { state: { ...known, slackStamp: Math.max(state.slackStamp ?? 0, slack.stamp), slackText: slack.text }, outcome: 'linked', save: !how.same(state.text, slack.text) }
  }
  // Changed after the send: the place's draft. A send's empty draft takes it whatever the clocks say.
  const observed = observeVersion({ ...state, sent: others }, slack, how, state.text === '')
  const lost = observed.outcome === 'kept' && observed.state.replaced === undefined ? { replaced: slack.text } : {}
  return { ...observed, state: { ...observed.state, ...lost }, cleanup: 'keep' }
}

/** A version of the place's draft, by the rules above; `takes` lets it apply over a pending local edit. */
function observeVersion(state: DraftState, slack: SlackDraft, how: ObserveHow, takes = false): ObservedDraft {
  const deleted = slack.deleted
  // An old draft of the place, not the one Juno links: it can never come back, and nothing else changes.
  if (deleted && state.slackId !== slack.id) return { state: { ...state, gone: withGone(state.gone, slack.id) }, outcome: 'linked', save: false }
  const own = (state.sending !== undefined && how.same(slack.text, state.sending)) || state.unsure.some((text) => how.same(slack.text, text))
  const same = how.same(slack.text, state.text)
  const kept = !takes && state.pending && state.editedAt > slack.stamp
  const relinked = deleted ? undefined : slack.id
  const link: DraftState = {
    ...withoutLink(state),
    ...(relinked === undefined ? {} : { slackId: relinked, seenAt: relinked === state.slackId && state.seenAt !== undefined ? state.seenAt : how.seenAt, slackText: slack.text }),
    slackStamp: how.absent === true ? (state.slackStamp ?? slack.stamp) : Math.max(state.slackStamp ?? 0, slack.stamp),
    gone: deleted ? withGone(state.gone, slack.id) : state.gone,
  }
  if (same || own || kept) {
    // Juno's text goes over its own older text in Slack, or over the older version.
    return { state: link, outcome: same ? 'linked' : own ? 'linked' : 'kept', save: !same }
  }
  const text = deleted ? '' : slack.text
  const replaced = state.replaced ?? (state.pending && state.text !== '' && !how.same(state.text, text) ? state.text : undefined)
  return { state: { ...link, text, editedAt: slack.stamp, pending: false, ...(replaced === undefined ? {} : { replaced }) }, outcome: 'applied', save: false }
}

function withoutLink(state: DraftState): DraftState {
  const { slackId: _id, seenAt: _seen, slackText: _text, ...rest } = state
  return rest
}
