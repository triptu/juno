import { useEffect, useRef, useState } from 'react'
import type { HomeItem, UndoCommand } from '@juno/contract'
import { actOnSettled, registry, resolveAllTopics, undoOne, undoStackAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { SettledReview, SheetLayer, type SettledStatus } from '@juno/views'
import { openSettings, openTopic } from './navigation'

/**
 * Tidy up's review in a sheet: Resolve and Keep open per row, each with
 * the usual toast, and Undo on the row itself, which puts back just that
 * topic. Opening a topic closes the sheet; ⌘ opens it in a new tab and
 * keeps the review. Closing it with nothing left open retires Home's row.
 */
export function TidyUpReview({ item, now, onClose }: { readonly item: HomeItem; readonly now: number; readonly onClose: (allDone: boolean) => void }) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, SettledStatus>>(new Map())
  // Per row: the undo on the stack that covers it, and the one that puts back just this topic.
  const undos = useRef(new Map<string, { readonly entry: UndoCommand; readonly own: UndoCommand }>())
  const stack = useAtomValue(undoStackAtom)
  const set = (entries: ReadonlyArray<readonly [string, SettledStatus]>) => setStatuses((before) => new Map([...before, ...entries]))
  // ⌘Z and the toast's Undo replay the newest undo: a row whose undo left the stack is open again.
  useEffect(() => {
    const undone = [...undos.current].filter(([, { entry }]) => !stack.includes(entry)).map(([id]) => id)
    for (const id of undone) undos.current.delete(id)
    if (undone.length > 0) set(undone.map((id) => [id, 'open'] as const))
  }, [stack])
  const open = item.topics.filter((topic) => (statuses.get(topic.id) ?? 'open') === 'open')
  const act = async (id: string, action: 'resolve' | 'keep') => {
    const topic = item.topics.find((candidate) => candidate.id === id)
    if (topic === undefined || (statuses.get(id) ?? 'open') !== 'open') return
    set([[id, action === 'resolve' ? 'resolved' : 'kept']])
    const undo = await actOnSettled(registry, topic, action)
    if (undo === undefined) return set([[id, 'open']])
    undos.current.set(id, { entry: undo, own: undo })
  }
  const undo = async (id: string) => {
    const kept = undos.current.get(id)
    undos.current.delete(id)
    set([[id, 'open']])
    if (kept !== undefined) await undoOne(registry, kept.own)
  }
  const resolveRest = async () => {
    const ids = open.map((topic) => topic.id)
    set(ids.map((id) => [id, 'resolved'] as const))
    const restores = await resolveAllTopics(registry, ids)
    const entry = registry.get(undoStackAtom).at(-1)
    for (const restore of restores) undos.current.set(restore.id, { entry: entry ?? restore, own: restore })
    const failed = ids.filter((id) => !restores.some((restore) => restore.id === id))
    if (failed.length > 0) set(failed.map((id) => [id, 'open'] as const))
  }
  const close = () => onClose(open.length === 0)
  return (
    <SheetLayer onClose={close}>
      <SettledReview
        topics={item.topics}
        statuses={statuses}
        now={now}
        autoFocus
        onOpen={(topicId, event) => {
          if (!event.metaKey) close()
          openTopic(topicId, { newTab: event.metaKey })
        }}
        onResolve={(id) => void act(id, 'resolve')}
        onKeep={(id) => void act(id, 'keep')}
        onUndo={(id) => void undo(id)}
        onResolveAll={() => void resolveRest()}
        onSettings={() => {
          close()
          openSettings('tidy-up')
        }}
        onClose={close}
      />
    </SheetLayer>
  )
}
