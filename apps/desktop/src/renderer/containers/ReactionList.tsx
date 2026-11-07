import { memo, useEffect, useRef, useState } from 'react'
import type { ReactionRow } from '@juno/contract'
import { nowAtom, reactionIdsAtom, reactionRowAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { ReactionList as ReactionListView, ReactionRow as ReactionRowView, relativeTime, type ActivateEvent } from '@juno/views'
import { openTopicAt } from './navigation'

/** How long the list keeps its order after the pointer and keyboard focus have left it, as the topic list does. */
const HOLD_GRACE_MS = 400

/**
 * The last contents of each row drawn, so a row that leaves while the list
 * holds its order keeps its place and still opens. Cleared when the list
 * unmounts.
 */
const drawn = new Map<string, ReactionRow>()

/** Mouse down on a row, or Enter: the topic at the message, which flashes, as a search result opens. ⌘ opens a new tab. */
function open(id: string, event: ActivateEvent): void {
  const row = drawn.get(id)
  if (row === undefined) return
  openTopicAt(row.topicId, row.ts, { flash: true, newTab: event.metaKey })
}

const Row = memo(function Row({ id, tabbable }: { readonly id: string; readonly tabbable: boolean }) {
  const live = useAtomValue(reactionRowAtom(id))
  if (live !== undefined) drawn.set(id, live)
  const row = live ?? drawn.get(id)
  const at = row?.at ?? 0
  // The minute tick re-renders a row only when its label changes.
  const time = useAtomValue(nowAtom, (now) => relativeTime(at, now))
  if (row === undefined) return null
  return <ReactionRowView row={row} time={time} tabbable={tabbable} onOpen={open} />
})

/**
 * The Reactions view's list (SPEC 5, "Reactions"). Subscribes to the rows'
 * order; each row reads its own atom. While the pointer or keyboard focus
 * is in the list the order holds: no row moves, none is added, and one that
 * leaves stays with its last contents, until 400 ms after both have left.
 */
export const ReactionList = memo(function ReactionList() {
  const live = useAtomValue(reactionIdsAtom)
  const [held, setHeld] = useState<ReadonlyArray<string> | undefined>(undefined)
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const ids = held ?? live ?? []

  useEffect(
    () => () => {
      clearTimeout(release.current)
      drawn.clear()
    },
    [],
  )

  const engage = (engaged: boolean) => {
    clearTimeout(release.current)
    if (engaged) setHeld((current) => current ?? ids)
    else release.current = setTimeout(() => setHeld(undefined), HOLD_GRACE_MS)
  }

  return (
    <ReactionListView
      ids={ids}
      renderRow={(id) => <Row key={id} id={id} tabbable={id === ids[0]} />}
      {...(live === undefined ? {} : { empty: live.length === 0 })}
      onEngagedChange={engage}
    />
  )
})
