/**
 * Home's rules (SPEC section 12, `docs/design/home/README.md`, "Items: how
 * they are chosen and capped"): which messages wait on the user, the
 * thresholds, and the ranking that turns candidates into at most three rows.
 */

/** Ranked in this order. */
export type HomeKind = 'waiting' | 'mentioned' | 'missedHuddle' | 'resume' | 'moved' | 'followUp' | 'automated' | 'tidyUp' | 'doneFollowUps' | 'oldDrafts' | 'unfollow' | 'ignore' | 'automatedMoves'

/**
 * A mention in an ignored channel comes right after a question: it is the
 * message exception for that channel. Missed huddles follow mentions. Automated's question comes before
 * Tidy up: it is asked once, and an unanswered one keeps a channel in the
 * wrong place. The other review cards come after it: nothing is lost while
 * they wait; Unfollow and Ignore, which change more, after the others.
 * Automated's record comes last: it reports what Juno already did.
 */
export const HOME_KINDS: ReadonlyArray<HomeKind> = ['waiting', 'mentioned', 'missedHuddle', 'resume', 'moved', 'followUp', 'automated', 'tidyUp', 'doneFollowUps', 'oldDrafts', 'unfollow', 'ignore', 'automatedMoves']

/** Moved a lot: a followed topic with at least this many new messages. */
export const MOVED_A_LOT_MIN = 8
/** Tidy up: a settled score at least this high, on at least this many topics. */
export const SETTLED_MIN_SCORE = 0.8
export const TIDY_UP_MIN_TOPICS = 2
/** The cards that open a review sheet, and the fewest topics each needs once the rows above took theirs. */
export const REVIEW_MIN_TOPICS: Partial<Record<HomeKind, number>> = { tidyUp: TIDY_UP_MIN_TOPICS, doneFollowUps: 1, oldDrafts: 1, unfollow: 1, ignore: 1 }
/** At most this many rows; on a window shorter than `HOME_SHORT_WINDOW` px, `HOME_SHORT_LIMIT`. */
export const HOME_LIMIT = 3

/**
 * A message that asks something: its text ends in a question mark, after
 * trailing spaces, closing quotes and brackets, and emoji.
 */
export function isQuestion(text: string): boolean {
  // Emoji, with their joiners and variation selectors, may follow the mark.
  return /\?(?:[\s"'\u201d\u2019)\]]|\p{Extended_Pictographic}|\u200d|\ufe0f)*$/u.test(text)
}

/** A message that asks the user: a question that mentions them, or any question in a one-to-one DM. */
export function asksUser(message: { readonly text: string }, selfId: string, directMessage: boolean): boolean {
  return isQuestion(message.text) && (directMessage || message.text.includes(`<@${selfId}>`))
}

/** A candidate row: one topic, or several for Tidy up. */
export interface HomeCandidate<T> {
  readonly kind: HomeKind
  readonly topicIds: ReadonlyArray<string>
  readonly value: T
}

/**
 * Ranks candidates into rows: kinds in `HOME_KINDS` order, at most one of
 * each (the first given wins), a topic only once (the higher kind keeps it;
 * a review card drops the topics already shown and needs
 * `REVIEW_MIN_TOPICS` left), at most `limit` rows.
 */
export function rankHomeItems<T>(candidates: ReadonlyArray<HomeCandidate<T>>, limit = HOME_LIMIT): ReadonlyArray<HomeCandidate<T>> {
  const shown = new Set<string>()
  const out: Array<HomeCandidate<T>> = []
  for (const kind of HOME_KINDS) {
    if (out.length >= limit) break
    for (const candidate of candidates) {
      if (candidate.kind !== kind) continue
      const least = REVIEW_MIN_TOPICS[kind]
      if (least !== undefined) {
        const topicIds = candidate.topicIds.filter((id) => !shown.has(id))
        if (topicIds.length < least) continue
        topicIds.forEach((id) => shown.add(id))
        out.push({ ...candidate, topicIds })
        break
      }
      if (candidate.topicIds.some((id) => shown.has(id))) continue
      candidate.topicIds.forEach((id) => shown.add(id))
      out.push(candidate)
      break
    }
  }
  return out
}

/** What a topic's last messages show about why it looks settled (the contract's `SettledWhy`, before names). */
export interface SettledEvidence {
  readonly kind: 'thanks' | 'done' | 'agreed' | 'afterYou' | 'quiet'
  /** Who wrote the last message; absent when it was the user. */
  readonly by?: string
}

const THANKS = /\b(thanks|thank you|thank u|thx|tysm|ty|cheers|appreciate it|much appreciated)\b|:pray:|🙏/iu
const DONE = /\b(done|merged|shipped|fixed|deployed|released|landed|closed|resolved|sorted|completed)\b|:white_check_mark:|:heavy_check_mark:|✅/iu
const AGREED = /^\s*(ok|okay|k|kk|sounds good|sgtm|lgtm|great|perfect|works for me|cool|yep|yes|agreed|got it|:\+1:|:thumbsup:|:ok_hand:|👍|👌)(?![\p{L}\p{N}])/iu
/** "not done", "isn't merged", "no thanks": a closing word that is denied does not close. */
const DENIED = /\b(not|isn't|isnt|hasn't|hasnt|haven't|havent|never|no thanks)\b/i
/** An agreement is a short reply; a long message that starts with "ok" goes on to say something else. */
const AGREED_MAX = 60

/**
 * Why a topic looks settled, from its latest messages, newest first
 * (`docs/design/settled-suggestions/README.md`, "Where the reason comes
 * from"). The settled decision chose the topic; this records what its last
 * messages show, so the review can say it in plain words. Undefined means
 * the topic must not be proposed at all: someone asked the user something
 * the user has not answered, or the last message mentions the user.
 */
export function settledEvidence(messages: ReadonlyArray<{ readonly user_id: string | null; readonly text: string }>, selfId: string, directMessage: boolean): SettledEvidence | undefined {
  const written = messages.filter((message) => message.user_id !== null)
  const last = written[0]
  if (last === undefined) return undefined
  // Newest first: a question to the user before any message from them is still waiting.
  for (const message of written) {
    if (message.user_id === selfId) break
    if (asksUser(message, selfId, directMessage)) return undefined
  }
  const mine = last.user_id === selfId
  if (!mine && last.text.includes(`<@${selfId}>`)) return undefined
  const by = mine ? {} : { by: last.user_id! }
  const closing = !isQuestion(last.text) && !DENIED.test(last.text)
  if (closing && THANKS.test(last.text)) return { kind: 'thanks', ...by }
  if (closing && DONE.test(last.text)) return { kind: 'done', ...by }
  if (closing && last.text.length <= AGREED_MAX && AGREED.test(last.text)) return { kind: 'agreed', ...by }
  if (mine && written.some((message) => message.user_id !== selfId)) return { kind: 'afterYou' }
  return { kind: 'quiet', ...by }
}

/** A message of the user's after a promise, as `followUpDelivery` reads it. */
export interface LaterMessage {
  readonly ts: string
  readonly user_id: string | null
  readonly text: string
  /** How many files it carries. */
  readonly files: number
}

/** What a later message of the user's shows: a file, a link, or words that hand the thing over. */
export interface Delivery {
  readonly ts: string
  readonly kind: 'file' | 'link' | 'said'
}

/** A link in Slack's markup (`<https://…|label>`) or bare. */
const LINK = /<https?:\/\/[^>\s]+>|\bhttps?:\/\/\S+/i
/** "Here's the deck", "Attached", "Sent it over", "Done": words that open a message handing something over. */
const HANDED_OVER = /^\s*(here(?:'s|\u2019s| is| are| you go| it is)|attached|sent|shared|uploaded|posted|done|just sent|pushed)(?![\p{L}\p{N}])/iu

/**
 * Whether the user kept a promise, from their own later messages in the
 * same topic (`docs/design/settled-suggestions/README.md`, "More
 * self-management", card 4): the first message of theirs after it with a
 * file, a link, or words that open by handing something over ("Here's the
 * deck", "Attached", "Done"). Denied words ("not done yet") do not count.
 * `after` skips messages up to a match the user said was not it, so only
 * a newer one is proposed. The row shows the message itself, so the user
 * judges the match, not Juno.
 */
export function followUpDelivery(promiseTs: string, messages: ReadonlyArray<LaterMessage>, selfId: string, after?: string): Delivery | undefined {
  const from = after !== undefined && after > promiseTs ? after : promiseTs
  const mine = messages.filter((message) => message.user_id === selfId && message.ts > from).toSorted((a, b) => (a.ts < b.ts ? -1 : 1))
  for (const message of mine) {
    if (message.files > 0) return { ts: message.ts, kind: 'file' }
    if (DENIED.test(message.text) || isQuestion(message.text)) continue
    if (LINK.test(message.text)) return { ts: message.ts, kind: 'link' }
    if (HANDED_OVER.test(message.text)) return { ts: message.ts, kind: 'said' }
  }
  return undefined
}

/** Old drafts: untouched this long. */
export const OLD_DRAFT_MILLIS = 14 * 24 * 60 * 60 * 1000

/**
 * A draft worth clearing (card 5): untouched for `OLD_DRAFT_MILLIS`, in a
 * topic with activity after it, and not kept as it is now (`keptAt` is the
 * `updatedAt` the user chose Keep at; editing the draft ends the keep).
 * Times are epoch milliseconds.
 */
export function isOldDraft(draft: { readonly updatedAt: number; readonly keptAt?: number }, lastActivity: number | undefined, now: number): boolean {
  if (now - draft.updatedAt < OLD_DRAFT_MILLIS) return false
  if (lastActivity === undefined || lastActivity <= draft.updatedAt) return false
  return draft.keptAt !== draft.updatedAt
}

/** A draft's first line with words, for its row. */
export function draftFirstLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? ''
}
