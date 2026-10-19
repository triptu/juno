/**
 * What the engine knows of the renderer pages' media, as current state
 * rather than a stream of events (specs/huddle.qnt).
 *
 * - Main's report of the live page generations is the authority on whether
 *   a page lives. A generation main has never listed is `pending`: it gets
 *   no credentials and is not refused. Once listed, a generation is `live`
 *   while listed and `gone` after.
 * - Each page reports its whole media state (`HuddlePageReport`) on every
 *   change and whenever its connection to the engine opens. The latest
 *   report per generation is kept; reports are idempotent and may arrive in
 *   any order with respect to everything else.
 * - Hand-offs are numbered in this process, so a report can be placed after
 *   or before the hand-off of a given attendee by its `received`.
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
  readonly live: ReadonlySet<string>
  /** Every generation main has listed in this process. */
  readonly seen: ReadonlySet<string>
}

export interface MediaView {
  readonly pages: Pages
  /** The latest report per generation. */
  readonly reports: ReadonlyMap<string, HuddlePageReport>
  /** The hand-offs of this process, by attendee, in order. */
  readonly handed: ReadonlyMap<string, number>
}

export const noMedia: MediaView = { pages: { reported: false, live: new Set(), seen: new Set() }, reports: new Map(), handed: new Map() }

export type PageState = 'pending' | 'live' | 'gone'

export const pageState = (view: MediaView, generation: string): PageState =>
  view.pages.live.has(generation) ? 'live' : view.pages.seen.has(generation) ? 'gone' : 'pending'

/**
 * Whether the page holding `record` has gone. A record handed out in an
 * earlier process names a page that registered before this process
 * started, so main's first report lists it if it lives.
 */
const holderGone = (view: MediaView, record: Stored & { readonly generation: string }) =>
  pageState(view, record.generation) === 'gone' ||
  (!view.handed.has(record.attendeeId) && view.pages.reported && !view.pages.live.has(record.generation))

/** The latest report of the holding page, if it was sent after the hand-off of `attendeeId`. */
const reportAfterHandOff = (view: MediaView, generation: string, attendeeId: string): HuddlePageReport | undefined => {
  const report = view.reports.get(generation)
  if (report === undefined) return undefined
  const handedAt = view.handed.get(attendeeId)
  // Handed out by an earlier process: every report this process has came after it.
  if (handedAt === undefined) return report
  const received = report.received === null ? undefined : view.handed.get(report.received)
  return received !== undefined && received >= handedAt ? report : undefined
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
  const ended = view.reports.get(record.generation)?.ended
  return ended !== null && ended !== undefined && ended.attendeeId === record.attendeeId ? ended.reason : 'failed'
}

/** The holding page's report while it holds the attendee's session. */
export const holding = (view: MediaView, generation: string, attendeeId: string): HuddlePageReport | undefined => {
  const report = view.reports.get(generation)
  return report !== undefined && report.holds === attendeeId ? report : undefined
}
