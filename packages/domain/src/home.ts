/**
 * Home's rules (SPEC section 12, `docs/design/home/README.md`, "Items: how
 * they are chosen and capped"): which messages wait on the user, the
 * thresholds, and the ranking that turns candidates into at most three rows.
 */

/** Ranked in this order. */
export type HomeKind = 'waiting' | 'resume' | 'moved' | 'followUp' | 'tidyUp' | 'automated'

export const HOME_KINDS: ReadonlyArray<HomeKind> = ['waiting', 'resume', 'moved', 'followUp', 'tidyUp', 'automated']

/** Moved a lot: a followed topic with at least this many new messages. */
export const MOVED_A_LOT_MIN = 8
/** Pick up where you left off: the topic was open at least this long. */
export const VISIT_MIN_MILLIS = 60_000
/** Tidy up: a settled score at least this high, on at least this many topics. */
export const SETTLED_MIN_SCORE = 0.8
export const TIDY_UP_MIN_TOPICS = 2
/** At most this many rows; on a window shorter than `HOME_SHORT_WINDOW` px, `HOME_SHORT_LIMIT`. */
export const HOME_LIMIT = 3
export const HOME_SHORT_LIMIT = 2
export const HOME_SHORT_WINDOW = 600

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
 * Tidy up drops the topics already shown and needs `TIDY_UP_MIN_TOPICS`
 * left), at most `limit` rows.
 */
export function rankHomeItems<T>(candidates: ReadonlyArray<HomeCandidate<T>>, limit = HOME_LIMIT): ReadonlyArray<HomeCandidate<T>> {
  const shown = new Set<string>()
  const out: Array<HomeCandidate<T>> = []
  for (const kind of HOME_KINDS) {
    if (out.length >= limit) break
    for (const candidate of candidates) {
      if (candidate.kind !== kind) continue
      if (kind === 'tidyUp') {
        const topicIds = candidate.topicIds.filter((id) => !shown.has(id))
        if (topicIds.length < TIDY_UP_MIN_TOPICS) continue
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
