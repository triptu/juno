import { Component } from 'react'
import { Player, type Snapshot } from './reorderPlayer'
import type { ReorderMotionProps } from './ReorderMotion'

/** Reads drawn positions before React mutates the sibling rows; all motion code loads on idle. */
export class ReorderSnapshot extends Component<ReorderMotionProps> {
  private readonly player = new Player()
  private readonly onVisibility = () => { if (document.hidden) this.player.stop() }

  override componentDidMount(): void {
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  override getSnapshotBeforeUpdate(before: ReorderMotionProps): Snapshot | null {
    return this.player.capture(before, this.props)
  }

  override componentDidUpdate(_before: ReorderMotionProps, _state: unknown, snapshot: Snapshot | null): void {
    if (snapshot !== null) this.player.play(this.props, snapshot)
  }

  override componentWillUnmount(): void {
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.player.stop()
  }

  override render(): null { return null }
}
