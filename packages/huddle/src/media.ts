/**
 * What the engine knows of the renderer pages' media, as current state
 * rather than a stream of events (specs/huddle.qnt).
 *
 * - Main gives out page generations in rising order and reports which are
 *   live and the highest it gave out (`maxIssued`). A generation at or below
 *   it that is not live is gone; one above it is `pending`: it gets no
 *   credentials and is not refused.
 * - Each page reports its whole media state (`HuddlePageReport`) on every
 *   change and whenever its connection to the engine opens. The report with
 *   the highest `seq` per generation is kept, with the engine connection it
 *   came on; reports may arrive in any order.
 * - Each hand-off is recorded with the connection its Start came on. A
 *   report places itself after the hand-off of an attendee when it came on
 *   a later connection of that page (the earlier one is closed, so nothing
 *   more comes on it), or on the same connection and names the attendee as
 *   `received`.
 *
 * An attendee's media counts as stopped if and only if no page was handed
 * its credentials, its page is gone, or its page's latest report, sent
 * after the hand-off, does not hold it. That is computed whenever it is
 * needed, so a report that came before the stored leaves were loaded still
 * counts once they are.
 */
import type { HuddleMediaEnd, HuddlePageReport } from '@juno/contract'
import type { Stored } from './lifecycle'

export interface Pages {
  /** Main has reported at least once in this process. */
  readonly reported: boolean
  readonly live: ReadonlySet<number>
  /** The highest generation main has given out, as of its last report; 0 before any. */
  readonly maxIssued: number
}

/** A page's report and the engine connection it came on. */
export interface Received {
  readonly report: HuddlePageReport
  readonly connection: number
}

export interface MediaView {
  readonly pages: Pages
  /** The latest report per generation. */
  readonly reports: ReadonlyMap<number, Received>
  /** The hand-offs of this process, by attendee: the connection the Start came on. */
  readonly handed: ReadonlyMap<string, number>
}

export const noMedia: MediaView = { pages: { reported: false, live: new Set(), maxIssued: 0 }, reports: new Map(), handed: new Map() }

export type PageState = 'pending' | 'live' | 'gone'

export const pageState = (view: MediaView, generation: number): PageState =>
  view.pages.live.has(generation) ? 'live' : generation <= view.pages.maxIssued ? 'gone' : 'pending'

/**
 * Whether the page holding `record` has gone. A record handed out in an
 * earlier process names a page that registered before this process
 * started, so main's first report lists it if it lives.
 */
const holderGone = (view: MediaView, record: Stored & { readonly generation: number }) =>
  pageState(view, record.generation) === 'gone' ||
  (!view.handed.has(record.attendeeId) && view.pages.reported && !view.pages.live.has(record.generation))

/** The latest report of the holding page, if it was sent after the hand-off of `attendeeId`. */
const reportAfterHandOff = (view: MediaView, generation: number, attendeeId: string): HuddlePageReport | undefined => {
  const latest = view.reports.get(generation)
  if (latest === undefined) return undefined
  const handedOn = view.handed.get(attendeeId)
  // Handed out by an earlier process: every report this process has came after it.
  if (handedOn === undefined) return latest.report
  return latest.connection > handedOn || (latest.connection === handedOn && latest.report.received === attendeeId) ? latest.report : undefined
}

/** Whether no media session can be running for `record`. */
export const mediaStopped = (view: MediaView, record: Stored): boolean => {
  if (record.generation === null) return true
  if (holderGone(view, { ...record, generation: record.generation })) return true
  const report = reportAfterHandOff(view, record.generation, record.attendeeId)
  return report !== undefined && report.holds !== record.attendeeId
}

/** Why the media of `record` ended, once `mediaStopped` holds. */
export const endReason = (view: MediaView, record: Stored): HuddleMediaEnd => {
  if (record.generation === null || holderGone(view, { ...record, generation: record.generation })) return 'connectionLost'
  const ended = view.reports.get(record.generation)?.report.ended
  return ended !== null && ended !== undefined && ended.attendeeId === record.attendeeId ? ended.reason : 'failed'
}

/** The holding page's report while it holds the attendee's session. */
export const holding = (view: MediaView, generation: number, attendeeId: string): HuddlePageReport | undefined => {
  const report = view.reports.get(generation)?.report
  return report !== undefined && report.holds === attendeeId ? report : undefined
}
