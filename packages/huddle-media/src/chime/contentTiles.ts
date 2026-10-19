/**
 * Others' shared screens as Chime video tiles. Chime makes a tile for each
 * received content stream (`isContent`, its attendee `<owner>#content`); this
 * binds each to the element `showShare` gave for it, and pauses a tile no
 * element shows, so a share nobody looks at is neither sent nor decoded
 * (`pauseVideoTile` asks Chime's server to stop the stream).
 */
import type { AudioVideoFacade, VideoTileState } from 'amazon-chime-sdk-js'
import { watchFirstFrame } from '../firstFrame.ts'

interface Shown {
  readonly element: HTMLVideoElement
  readonly unwatch: () => void
}

export class ContentTiles {
  readonly #av: AudioVideoFacade
  readonly #onReady: (attendeeId: string, ready: boolean) => void
  /** Each share's tile, by the share's attendee id. */
  readonly #tiles = new Map<string, number>()
  readonly #shown = new Map<string, Shown>()

  constructor(av: AudioVideoFacade, onReady: (attendeeId: string, ready: boolean) => void) {
    this.#av = av
    this.#onReady = onReady
  }

  /** From the observer's `videoTileDidUpdate`, which also fires for this class's own binds and pauses. */
  tileDidUpdate(state: VideoTileState): void {
    const { tileId, boundAttendeeId: attendeeId } = state
    if (!state.isContent || state.localTile || tileId === null || attendeeId === null) return
    if (this.#tiles.get(attendeeId) === tileId) return
    this.#tiles.set(attendeeId, tileId)
    this.#apply(attendeeId)
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
    this.#apply(attendeeId)
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
    if (tileId === undefined) return
    this.#av.unbindVideoElement(tileId)
    this.#av.pauseVideoTile(tileId)
  }

  #apply(attendeeId: string): void {
    const tileId = this.#tiles.get(attendeeId)
    if (tileId === undefined) return
    const shown = this.#shown.get(attendeeId)
    if (shown === undefined) return this.#av.pauseVideoTile(tileId)
    this.#av.bindVideoElement(tileId, shown.element)
    this.#av.unpauseVideoTile(tileId)
  }
}
