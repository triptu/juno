import { useEffect, useRef, useState } from 'react'
import type { UndoCommand } from '@juno/contract'
import { registry, undoOne, undoStackAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import type { ReviewStatus } from '@juno/views'

/**
 * A review sheet's row states (`ReviewSheet`), shared by every Home card
 * that opens one. A row acts with the undo its command returned; its own
 * Undo replays just that undo, and ⌘Z or the toast's Undo, which replay
 * the newest, put back the row whose undo left the stack.
 */
export function useReview() {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ReviewStatus>>(new Map())
  // Per row: the undo on the stack that covers it, and the one that puts back just this row.
  const undos = useRef(new Map<string, { readonly entry: UndoCommand; readonly own: UndoCommand }>())
  const stack = useAtomValue(undoStackAtom)
  const set = (entries: ReadonlyArray<readonly [string, ReviewStatus]>) => setStatuses((before) => new Map([...before, ...entries]))
  useEffect(() => {
    const undone = [...undos.current].filter(([, { entry }]) => !stack.includes(entry)).map(([id]) => id)
    for (const id of undone) undos.current.delete(id)
    if (undone.length > 0) set(undone.map((id) => [id, 'open'] as const))
  }, [stack])
  const statusOf = (id: string) => statuses.get(id) ?? 'open'
  /** Marks the row, runs the command, and puts the row back when nothing changed. */
  const act = async (id: string, status: Exclude<ReviewStatus, 'open'>, run: () => Promise<UndoCommand | undefined>) => {
    if (statusOf(id) !== 'open') return
    set([[id, status]])
    const undo = await run()
    if (undo === undefined) return set([[id, 'open']])
    undos.current.set(id, { entry: undo, own: undo })
  }
  const undo = async (id: string) => {
    const kept = undos.current.get(id)
    undos.current.delete(id)
    set([[id, 'open']])
    if (kept !== undefined) await undoOne(registry, kept.own)
  }
  /** Several rows acted on at once: each keeps its own undo, and `entry`, the one on the stack, covers them all. */
  const actedTogether = (ids: ReadonlyArray<string>, status: Exclude<ReviewStatus, 'open'>) => {
    set(ids.map((id) => [id, status] as const))
    return (owns: ReadonlyArray<readonly [string, UndoCommand]>) => {
      const entry = registry.get(undoStackAtom).at(-1)
      for (const [id, own] of owns) undos.current.set(id, { entry: entry ?? own, own })
      const failed = ids.filter((id) => !owns.some(([done]) => done === id))
      if (failed.length > 0) set(failed.map((id) => [id, 'open'] as const))
    }
  }
  return { statuses, statusOf, act, undo, actedTogether }
}
