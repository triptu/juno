/**
 * The Search list's rows, from the engine's groups (SPEC 10a, "Rows"). Flat,
 * the default, is one row per match in time order, and a title-only topic
 * as one line; a match from the same topic as the row before it is a match
 * line, so a run from one topic shows its topic line once. Grouped, a thread has its topic line, up to two match lines
 * and "N more in this thread" (all of them once expanded); Main matches sit
 * under one header line per run of a channel. The container and the list
 * read the same rows, so the arrows and the reader agree on what is next.
 */
import type { SearchGroup, SearchHit } from '@juno/contract'

export type SearchRowItem =
  /** Flat: a match with its topic's line. */
  | { readonly kind: 'flat'; readonly id: string; readonly group: SearchGroup; readonly hit: SearchHit }
  /** A topic whose title matched, with no message match. */
  | { readonly kind: 'title'; readonly id: string; readonly group: SearchGroup }
  /** Grouped: a thread's topic line. */
  | { readonly kind: 'topic'; readonly id: string; readonly group: SearchGroup }
  /** Grouped: the header over a run of Main matches. Not a stop for the arrows. */
  | { readonly kind: 'mainHeader'; readonly id: string; readonly group: SearchGroup }
  /** A match line under its topic or Main header; in flat, under the row before it from the same topic. */
  | { readonly kind: 'match'; readonly id: string; readonly group: SearchGroup; readonly hit: SearchHit; readonly flat?: true }
  /** Grouped: "3 more in this thread", which shows them in place. */
  | { readonly kind: 'more'; readonly id: string; readonly group: SearchGroup; readonly count: number }
  /** "Older matches on this Mac": the rows under it are local only, until Slack's pages reach them. */
  | { readonly kind: 'older'; readonly id: string }

/** Match lines a thread shows before "N more in this thread". */
export const THREAD_LINES = 2

export function searchRows(groups: ReadonlyArray<SearchGroup>, grouped: boolean, olderIndex: number, expanded: ReadonlySet<string>): ReadonlyArray<SearchRowItem> {
  const rows: SearchRowItem[] = []
  /** Flat: the topic of the match row just before, which a match from the same topic runs on from. */
  let previous: string | undefined
  groups.forEach((group, index) => {
    if (index === olderIndex) {
      rows.push({ kind: 'older', id: 'older' })
      previous = undefined
    }
    if (group.kind === 'topic' || group.messages.length === 0) {
      rows.push({ kind: 'title', id: group.id, group })
      previous = undefined
      return
    }
    if (!grouped) {
      for (const hit of group.messages) {
        rows.push(previous === group.topicId ? { kind: 'match', id: hit.id, group, hit, flat: true } : { kind: 'flat', id: hit.id, group, hit })
        previous = group.topicId
      }
      return
    }
    if (group.kind === 'main') {
      rows.push({ kind: 'mainHeader', id: `head:${group.id}`, group })
      for (const hit of group.messages) rows.push({ kind: 'match', id: hit.id, group, hit })
      return
    }
    rows.push({ kind: 'topic', id: group.id, group })
    const open = expanded.has(group.id)
    const shown = open ? group.messages : group.messages.slice(0, THREAD_LINES)
    for (const hit of shown) rows.push({ kind: 'match', id: hit.id, group, hit })
    if (!open && group.messages.length > THREAD_LINES) rows.push({ kind: 'more', id: `more:${group.id}`, group, count: group.messages.length - THREAD_LINES })
  })
  return rows
}

/** The rows the arrows stop on. */
export const isStop = (row: SearchRowItem): boolean => row.kind !== 'mainHeader' && row.kind !== 'older'

/** What the reader shows for a row: the topic, and the match it lands on. "More" shows nothing new. */
export function readerTarget(row: SearchRowItem): { readonly topicId: string; readonly ts?: string; readonly stored?: boolean } | undefined {
  switch (row.kind) {
    case 'flat':
    case 'match':
      return { topicId: row.hit.topicId, ts: row.hit.ts, stored: row.hit.stored }
    case 'topic':
      return row.group.messages[0] === undefined ? { topicId: row.group.topicId } : { topicId: row.group.topicId, ts: row.group.messages[0].ts, stored: row.group.messages[0].stored }
    case 'title':
      return { topicId: row.group.topicId }
    default:
      return undefined
  }
}
