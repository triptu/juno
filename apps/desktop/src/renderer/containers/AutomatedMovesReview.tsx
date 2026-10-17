import { useEffect, useRef, useState } from 'react'
import type { HomeItem, UndoCommand } from '@juno/contract'
import { actOnMove, registry, undoOne, undoStackAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { AutomatedReview, movedToast, SheetLayer, type SettledStatus } from '@juno/views'
import { openTopic } from './navigation'

/**
 * Automated's record in a sheet: Move back and Keep per row, each with the
 * usual toast, and Undo on the row itself, which gives that channel back
 * to where Juno had put it. Opening a row opens the channel's Main and
 * closes the sheet; ⌘ opens it in a new tab and keeps the sheet.
 */
export function AutomatedMovesReview({ item, now, onClose }: { readonly item: HomeItem; readonly now: number; readonly onClose: () => void }) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, SettledStatus>>(new Map())
  const undos = useRef(new Map<string, UndoCommand>())
  const stack = useAtomValue(undoStackAtom)
  const set = (entries: ReadonlyArray<readonly [string, SettledStatus]>) => setStatuses((before) => new Map([...before, ...entries]))
  // ⌘Z and the toast's Undo replay the newest undo: a row whose undo left the stack is open again.
  useEffect(() => {
    const undone = [...undos.current].filter(([, entry]) => !stack.includes(entry)).map(([id]) => id)
    for (const id of undone) undos.current.delete(id)
    if (undone.length > 0) set(undone.map((id) => [id, 'open'] as const))
  }, [stack])
  const act = async (id: string, action: 'act' | 'keep') => {
    const topic = item.topics.find((candidate) => candidate.id === id)
    if (topic === undefined || (statuses.get(id) ?? 'open') !== 'open') return
    set([[id, action === 'act' ? 'resolved' : 'kept']])
    const undo = await actOnMove(registry, topic, action, movedToast(topic, action))
    if (undo === undefined) return set([[id, 'open']])
    undos.current.set(id, undo)
  }
  const undo = async (id: string) => {
    const entry = undos.current.get(id)
    undos.current.delete(id)
    set([[id, 'open']])
    if (entry !== undefined) await undoOne(registry, entry)
  }
  return (
    <SheetLayer onClose={onClose}>
      <AutomatedReview
        title={item.title}
        topics={item.topics}
        statuses={statuses}
        now={now}
        autoFocus
        onOpen={(topicId, event) => {
          if (!event.metaKey) onClose()
          openTopic(topicId, { newTab: event.metaKey })
        }}
        onMoveBack={(id) => void act(id, 'act')}
        onKeep={(id) => void act(id, 'keep')}
        onUndo={(id) => void undo(id)}
        onClose={onClose}
      />
    </SheetLayer>
  )
}
