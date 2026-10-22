import { Component, type ReactNode, type RefObject } from 'react'
import type { Player, Snapshot } from './reorderPlayer'

/**
 * Rows that slide to their new places when a list reorders. React keeps
 * the rows' DOM nodes by key; before a change is written this reads where
 * each row is drawn (`getSnapshotBeforeUpdate`), and after it each row
 * eases from there to its new place (`reorderPlayer.ts`). Only changes
 * marked `animate` move, and only while the scroller is at its top; the
 * rest, and every change before the motion has loaded on idle after the
 * first paint, take their places in one frame.
 */
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
  readonly children: ReactNode
}

let loaded: typeof import('./reorderPlayer') | undefined

export class ReorderMotion extends Component<ReorderMotionProps> {
  private player: Player | undefined

  override componentDidMount(): void {
    if (loaded === undefined) requestIdleCallback(() => void import('./reorderPlayer').then((module) => (loaded = module)), { timeout: 2_000 })
  }

  override getSnapshotBeforeUpdate(before: ReorderMotionProps): Snapshot | null {
    return loaded === undefined ? null : (this.player ??= new loaded.Player()).capture(before, this.props)
  }

  override componentDidUpdate(_before: ReorderMotionProps, _state: unknown, snapshot: Snapshot | null): void {
    if (snapshot !== null) this.player!.play(this.props, snapshot)
  }

  override componentWillUnmount(): void {
    this.player?.stop()
  }

  override render(): ReactNode {
    return this.props.children
  }
}
