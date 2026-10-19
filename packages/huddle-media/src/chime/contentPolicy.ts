/**
 * Which video Chime receives: the shared screens the page shows, and nothing
 * else. A share is a `#content` attendee's stream; cameras someone turns on in
 * Slack are never received (video is out of scope), and neither is a share no
 * tab shows, so it costs no bandwidth or decoding. Modelled on the SDK's
 * `AllHighestVideoBandwidthPolicy`: the best stream of each sending source,
 * filtered. Slack allows two shares at once, so no bandwidth cap is needed.
 *
 * A change to what is shown takes effect at Chime's next check: its
 * `MonitorTask` asks `wantsResubscribe` on every metrics report (about once a
 * second) and resubscribes, as it does for `chooseRemoteVideoSources`.
 */
import { DefaultVideoStreamIdSet, type VideoDownlinkBandwidthPolicy, type VideoStreamIdSet, type VideoStreamIndex } from 'amazon-chime-sdk-js'
import { CONTENT_SUFFIX } from '../externalUserId.ts'

/** Another attendee's content share; the user's own (`<self>#content`) is not received. */
const isOthersShare = (attendeeId: string, self: string) => attendeeId.endsWith(CONTENT_SUFFIX) && attendeeId !== `${self}${CONTENT_SUFFIX}`

export class ContentOnlyDownlinkPolicy implements VideoDownlinkBandwidthPolicy {
  readonly #self: string
  #index: VideoStreamIndex | undefined
  /** The share attendees an element shows. */
  #shown: ReadonlySet<string> = new Set()
  #optimal: VideoStreamIdSet = new DefaultVideoStreamIdSet()
  #subscribed: VideoStreamIdSet = new DefaultVideoStreamIdSet()

  constructor(selfAttendeeId: string) {
    this.#self = selfAttendeeId
  }

  reset(): void {
    this.#index = undefined
    this.#optimal = new DefaultVideoStreamIdSet()
    this.#subscribed = new DefaultVideoStreamIdSet()
  }

  updateIndex(index: VideoStreamIndex): void {
    this.#index = index
    this.#choose()
  }

  /** The shares to receive from now on. */
  show(attendeeIds: ReadonlySet<string>): void {
    this.#shown = attendeeIds
    this.#choose()
  }

  #choose(): void {
    const index = this.#index
    if (index === undefined) return
    const best = index.highestQualityStreamFromEachGroupExcludingSelf(this.#self)
    const sending = new Set(index.allVideoSendingSourcesExcludingSelf(this.#self).map((source) => source.attendee.attendeeId))
    const chosen = new DefaultVideoStreamIdSet()
    for (const stream of index.remoteStreamDescriptions()) {
      if (best.contain(stream.streamId) && sending.has(stream.attendeeId) && this.#shown.has(stream.attendeeId) && isOthersShare(stream.attendeeId, this.#self)) chosen.add(stream.streamId)
    }
    this.#optimal = chosen
  }

  updateMetrics(): void {}

  wantsResubscribe(): boolean {
    return !this.#subscribed.equal(this.#optimal)
  }

  chooseSubscriptions(): VideoStreamIdSet {
    this.#subscribed = this.#optimal.clone()
    return this.#subscribed.clone()
  }
}
