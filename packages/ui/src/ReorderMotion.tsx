import { useEffect, type RefObject } from 'react'
import { chunk } from './chunks'

/** Observes a keyed list without wrapping it, so idle loading never remounts its rows. */
export interface ReorderMotionProps {
  /** The ids of each group of rows, top to bottom. A new array is a change. */
  readonly groups: ReadonlyArray<ReadonlyArray<string>>
  /** Whether this change may move on screen. False puts every row in its place at once. */
  readonly animate: boolean
  /** The scrolling element the rows are in. */
  readonly scroller: RefObject<HTMLElement | null>
  /** Selects a row inside the scroller. */
  readonly row: string
  /** The attribute holding a row's id. */
  readonly rowKey: string
}

const motion = chunk(() => import('./ReorderSnapshot'))
const Snapshot = motion.component((module) => module.ReorderSnapshot)

export function ReorderMotion(props: ReorderMotionProps) {
  const ready = motion.useReady()
  useEffect(() => {
    const idle = requestIdleCallback(() => void motion.load(), { timeout: 2_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  return ready ? <Snapshot {...props} /> : null
}
