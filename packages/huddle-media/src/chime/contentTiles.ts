/**
 * Others' shared screens as Chime video tiles. The policy receives only the
 * shares an element shows (`ContentOnlyDownlinkPolicy`); Chime makes a tile
 * for each received stream (`isContent`, its attendee `<owner>#content`), and
 * this binds it to the element `showShare` gave for it. Hiding a share drops
 * it from the policy, and Chime removes its tile.
 */
import type { AudioVideoFacade, VideoTileState } from 'amazon-chime-sdk-js'
import { watchFirstFrame } from '../firstFrame.ts'
import type { ContentOnlyDownlinkPolicy } from './contentPolicy.ts'

interface Shown {
  readonly element: HTMLVideoElement
  readonly unwatch: () => void
}

export class ContentTiles {
  readonly #av: AudioVideoFacade
  readonly #policy: ContentOnlyDownlinkPolicy
  readonly #onReady: (attendeeId: string, ready: boolean) => void
  /** Each share's tile, by the share's attendee id. */
  readonly #tiles = new Map<string, number>()
  readonly #shown = new Map<string, Shown>()

  constructor(av: AudioVideoFacade, policy: ContentOnlyDownlinkPolicy, onReady: (attendeeId: string, ready: boolean) => void) {
    this.#av = av
    this.#policy = policy
    this.#onReady = onReady
  }

  /** From the observer's `videoTileDidUpdate`, which also fires for this class's own binds. */
  tileDidUpdate(state: VideoTileState): void {
    const { tileId, boundAttendeeId: attendeeId } = state
    if (!state.isContent || state.localTile || tileId === null || attendeeId === null) return
    if (this.#tiles.get(attendeeId) === tileId) return
    this.#tiles.set(attendeeId, tileId)
    const shown = this.#shown.get(attendeeId)
    if (shown !== undefined) this.#av.bindVideoElement(tileId, shown.element)
  }

  tileWasRemoved(tileId: number): void {
    for (const [attendeeId, id] of this.#tiles) {
      if (id !== tileId) continue
      this.#tiles.delete(attendeeId)
      this.#onReady(attendeeId, false)
    }
  }

  show(attendeeId: string, element: HTMLVideoElement): () => void {
    this.#hide(attendeeId)
    const shown: Shown = { element, unwatch: watchFirstFrame(element, (ready) => this.#onReady(attendeeId, ready)) }
    this.#shown.set(attendeeId, shown)
    const tileId = this.#tiles.get(attendeeId)
    if (tileId !== undefined) this.#av.bindVideoElement(tileId, element)
    this.#policy.show(new Set(this.#shown.keys()))
    return () => {
      if (this.#shown.get(attendeeId) === shown) this.#hide(attendeeId)
    }
  }

  /** The call ended: let go of every element. Chime removes the tiles itself. */
  stop(): void {
    for (const attendeeId of this.#shown.keys()) this.#hide(attendeeId)
    this.#tiles.clear()
  }

  #hide(attendeeId: string): void {
    const shown = this.#shown.get(attendeeId)
    if (shown === undefined) return
    this.#shown.delete(attendeeId)
    shown.unwatch()
    this.#onReady(attendeeId, false)
    const tileId = this.#tiles.get(attendeeId)
    if (tileId !== undefined) this.#av.unbindVideoElement(tileId)
    this.#policy.show(new Set(this.#shown.keys()))
  }
}
