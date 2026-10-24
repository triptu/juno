/**
 * The Search list's rows, from the engine's groups (SPEC 10a, "Cards"): one
 * card per match in time order, and a topic whose title matched as a title
 * row. A card from the same topic as the card just before it is a `run`: it
 * leaves out the place line, so a run from one topic shows that line once.
 * The container and the list read the same rows, so the arrows and the
 * panel agree on what is next.
 */
import type { SearchGroup, SearchHit } from '@juno/contract'

export type SearchRowItem =
  /** A message match, drawn as its card. */
  | { readonly kind: 'card'; readonly id: string; readonly group: SearchGroup; readonly hit: SearchHit; readonly run: boolean }
  /** A topic whose title matched, with no message match. */
  | { readonly kind: 'title'; readonly id: string; readonly group: SearchGroup }
  /** "Older matches on this Mac": the rows under it are local only, until Slack's pages reach them. */
  | { readonly kind: 'older'; readonly id: string }

export function searchRows(groups: ReadonlyArray<SearchGroup>, olderIndex: number): ReadonlyArray<SearchRowItem> {
  const rows: SearchRowItem[] = []
  /** The topic of the card just before, which a card from the same topic runs on from. */
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
    for (const hit of group.messages) {
      rows.push({ kind: 'card', id: hit.id, group, hit, run: previous === group.topicId })
      previous = group.topicId
    }
  })
  return rows
}

/** The rows the arrows stop on. */
export const isStop = (row: SearchRowItem): boolean => row.kind !== 'older'

/** What the panel shows for a row: the topic, and the match it lands on. */
export function readerTarget(row: SearchRowItem): { readonly topicId: string; readonly ts?: string; readonly stored?: boolean } | undefined {
  switch (row.kind) {
    case 'card':
      return { topicId: row.hit.topicId, ts: row.hit.ts, stored: row.hit.stored }
    case 'title':
      return { topicId: row.group.topicId }
    default:
      return undefined
  }
}
