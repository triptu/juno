import { memo, useEffect, useRef, useState } from 'react'
import type { ReactionRow } from '@juno/contract'
import { nowAtom, reactionRowsAtom, reactionWatchAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { ReactionList as ReactionListView, ReactionRow as ReactionRowView, relativeTime } from '@juno/views'
import { openTopicAt } from './navigation'

/** How long the list keeps its order after the pointer and keyboard focus have left it, as the topic list does. */
const HOLD_GRACE_MS = 400

const Row = memo(function Row({ row, tabbable }: { readonly row: ReactionRow; readonly tabbable: boolean }) {
  // The minute tick re-renders a row only when its label changes.
  const time = useAtomValue(nowAtom, (now) => relativeTime(row.at, now))
  // Mouse down or Enter opens the topic at the message, which flashes, as a search result does. ⌘ opens a new tab.
  return <ReactionRowView row={row} time={time} tabbable={tabbable} onOpen={(_id, event) => openTopicAt(row.topicId, row.ts, { flash: true, newTab: event.metaKey })} />
})

/**
 * The Reactions view's list (SPEC 5, "Reactions"), from one subscription to
 * its rows. While the pointer or keyboard focus is in the list the order
 * holds: no row moves, none is added, and one that leaves stays with the
 * contents it had when the hold began, until 400 ms after both have left.
 * Rows still in the view show their current contents.
 */
export const ReactionList = memo(function ReactionList({ pillRoom }: { readonly pillRoom: boolean }) {
  const live = useAtomValue(reactionRowsAtom)
  // The view being open: Slack is read while it is mounted, and not after.
  useAtomValue(reactionWatchAtom)
  const [held, setHeld] = useState<ReadonlyArray<ReactionRow> | undefined>(undefined)
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const current = new Map((live ?? []).map((row) => [row.id, row]))
  const rows = held === undefined ? (live ?? []) : held.map((row) => current.get(row.id) ?? row)
  const shown = new Map(rows.map((row) => [row.id, row]))

  useEffect(() => () => clearTimeout(release.current), [])

  const engage = (engaged: boolean) => {
    clearTimeout(release.current)
    if (engaged) setHeld((before) => before ?? rows)
    else release.current = setTimeout(() => setHeld(undefined), HOLD_GRACE_MS)
  }

  return (
    <ReactionListView
      pillRoom={pillRoom}
      ids={[...shown.keys()]}
      renderRow={(id) => <Row key={id} row={shown.get(id)!} tabbable={id === rows[0]?.id} />}
      {...(live === undefined ? {} : { empty: live.length === 0 })}
      onEngagedChange={engage}
    />
  )
})
