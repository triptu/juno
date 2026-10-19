/**
 * The user's own shared screen or window as Chime content share (SPEC 20;
 * research `slack-huddles.md` section 3). Slack's desktop client captures
 * with `getUserMedia` and `chromeMediaSource: 'desktop'`, the id coming from
 * the shell's `desktopCapturer`; so does this. No sound is captured.
 *
 * Chime runs the share as a second attendee, `<self>#content`, with its own
 * connection, and stops the capture's tracks itself when that connection
 * stops (`ContentShareMediaStreamBroker.cleanup`). So a new share starts only
 * once Chime has said the last one stopped (`contentShareDidStop`), or its
 * cleanup would stop the new capture. Chime also stops the share when the
 * captured track ends: the window closed, or macOS stopped the capture.
 */
import { VideoQualitySettings, type AudioVideoFacade, type ContentShareObserver } from 'amazon-chime-sdk-js'
import type { OwnPreviews } from '../ownPreview.ts'
import type { LocalShare, ShareEndReason, ShareSource } from '../types.ts'

/** The research does not record Slack's limits, so these: full HD at most, 15 frames a second, as Slack's browser path caps it. */
export const CAPTURE_LIMITS = { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 15 } as const
/** How long a stop waits for Chime to say it stopped before it lets go anyway. */
const STOP_TIMEOUT_MS = 5_000

/** Chromium's desktop capture constraints, which the DOM's types do not name. */
export function captureConstraints(sourceId: string): MediaStreamConstraints {
  const mandatory = { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, ...CAPTURE_LIMITS }
  return { audio: false, video: { mandatory } as MediaTrackConstraints }
}

/** A share from its capture to Chime's stop. `reason` is set by whoever stops it first; `replaced` reports nothing. */
interface Running {
  readonly source: ShareSource
  readonly stream: MediaStream
  live: boolean
  reason: ShareEndReason | 'replaced' | undefined
  readonly stopped: Promise<void>
  readonly resolveStopped: () => void
  readonly unwatch: () => void
}

export type OwnShareChange = (share: LocalShare | undefined, ended?: { readonly kind: ShareSource['kind']; readonly reason: ShareEndReason }) => void

export class OwnShare {
  readonly #av: AudioVideoFacade
  readonly #previews: OwnPreviews
  readonly #onChange: OwnShareChange
  /** The meeting allows no content share (Chime would then start nothing and say nothing). */
  readonly #disabled: boolean
  #current: Running | undefined
  /** Rises with each start and with close, so an older start that finishes late lets go of its capture. */
  #attempt = 0
  #closed = false
  readonly #observer: ContentShareObserver = {
    contentShareDidStart: () => {
      const running = this.#current
      if (running === undefined || running.live) return
      running.live = true
      this.#publish(running)
    },
    contentShareDidStop: () => {
      const running = this.#current
      if (running !== undefined) this.#finish(running, running.reason ?? 'failed')
    },
  }

  constructor(av: AudioVideoFacade, previews: OwnPreviews, contentMaxResolution: VideoQualitySettings, onChange: OwnShareChange) {
    this.#av = av
    this.#previews = previews
    this.#onChange = onChange
    this.#disabled = contentMaxResolution === VideoQualitySettings.VideoDisabled
    av.addContentShareObserver(this.#observer)
  }

  async start(source: ShareSource): Promise<void> {
    if (this.#closed) return
    const attempt = ++this.#attempt
    await this.#stop('replaced')
    if (attempt !== this.#attempt) return
    if (this.#disabled) return this.#onChange(undefined, { kind: source.kind, reason: 'failed' })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia(captureConstraints(source.sourceId))
    } catch {
      if (attempt === this.#attempt) this.#onChange(undefined, { kind: source.kind, reason: 'failed' })
      return
    }
    // Stopped or replaced meanwhile: whoever did it says what shows now.
    if (attempt !== this.#attempt) return stopTracks(stream)
    const track = stream.getVideoTracks()[0]
    // Chime stops the share on the same event; this only says why.
    const onEnded = () => {
      if (this.#current === running && running.reason === undefined) running.reason = 'source-ended'
    }
    track?.addEventListener('ended', onEnded)
    let resolveStopped = () => {}
    const stopped = new Promise<void>((resolve) => (resolveStopped = resolve))
    const running: Running = { source, stream, live: false, reason: undefined, stopped, resolveStopped, unwatch: () => track?.removeEventListener('ended', onEnded) }
    this.#current = running
    this.#previews.set(stream)
    this.#publish(running)
    if (track === undefined || track.readyState === 'ended') return this.#finish(running, 'source-ended')
    try {
      await this.#av.startContentShare(stream)
    } catch {
      running.reason ??= 'failed'
      this.#av.stopContentShare()
    }
  }

  /** The user's Stop sharing. While a new capture is starting, that start is dropped too. */
  stop(): void {
    this.#attempt++
    if (this.#current === undefined) this.#onChange(undefined)
    else void this.#stop('stopped')
  }

  /** The call ended: stop the share without a word, and take no more. */
  close(): void {
    this.#closed = true
    this.#attempt++
    const running = this.#current
    if (running !== undefined) {
      running.reason = 'replaced'
      this.#av.stopContentShare()
      this.#finish(running, 'replaced')
    }
    this.#av.removeContentShareObserver(this.#observer)
  }

  async #stop(reason: ShareEndReason | 'replaced'): Promise<void> {
    const running = this.#current
    if (running === undefined || this.#closed) return
    running.reason ??= reason
    this.#av.stopContentShare()
    const timer = setTimeout(() => this.#finish(running, running.reason ?? reason), STOP_TIMEOUT_MS)
    await running.stopped
    clearTimeout(timer)
  }

  #publish(running: Running): void {
    this.#onChange({ ...running.source, live: running.live })
  }

  /**
   * Once per share: lets go of its capture and says why it stopped. A
   * replaced share says nothing, so the share shows on until the next one
   * takes its place (or fails, which says so).
   */
  #finish(running: Running, reason: ShareEndReason | 'replaced'): void {
    if (this.#current !== running) return
    this.#current = undefined
    running.unwatch()
    stopTracks(running.stream)
    this.#previews.set(undefined)
    if (reason !== 'replaced') this.#onChange(undefined, { kind: running.source.kind, reason })
    running.resolveStopped()
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}
