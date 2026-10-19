/**
 * Which video Chime receives: others' shared screens and nothing else. A
 * share is a `#content` attendee's stream; cameras someone turns on in Slack
 * are never received (video is out of scope). Modelled on the SDK's
 * `AllHighestVideoBandwidthPolicy`: the best stream of each sending source,
 * filtered to content. Slack allows two shares at once, so the total stays
 * small and no bandwidth cap is needed.
 */
import { DefaultVideoStreamIdSet, type VideoDownlinkBandwidthPolicy, type VideoStreamIdSet, type VideoStreamIndex } from 'amazon-chime-sdk-js'
import { CONTENT_SUFFIX } from '../externalUserId.ts'

/** Another attendee's content share; the user's own (`<self>#content`) is not received. */
const isOthersShare = (attendeeId: string, self: string) => attendeeId.endsWith(CONTENT_SUFFIX) && attendeeId !== `${self}${CONTENT_SUFFIX}`

export class ContentOnlyDownlinkPolicy implements VideoDownlinkBandwidthPolicy {
  readonly #self: string
  #optimal: VideoStreamIdSet = new DefaultVideoStreamIdSet()
  #subscribed: VideoStreamIdSet = new DefaultVideoStreamIdSet()

  constructor(selfAttendeeId: string) {
    this.#self = selfAttendeeId
  }

  reset(): void {
    this.#optimal = new DefaultVideoStreamIdSet()
    this.#subscribed = new DefaultVideoStreamIdSet()
  }

  updateIndex(index: VideoStreamIndex): void {
    const best = index.highestQualityStreamFromEachGroupExcludingSelf(this.#self)
    const sending = new Set(index.allVideoSendingSourcesExcludingSelf(this.#self).map((source) => source.attendee.attendeeId))
    const chosen = new DefaultVideoStreamIdSet()
    for (const stream of index.remoteStreamDescriptions()) {
      if (best.contain(stream.streamId) && sending.has(stream.attendeeId) && isOthersShare(stream.attendeeId, this.#self)) chosen.add(stream.streamId)
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
