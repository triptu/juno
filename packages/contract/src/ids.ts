/**
 * Topic ids the renderer builds itself: a channel's Main, for the header's
 * topic switcher. A `@juno/domain` rule, reached here as the other domain
 * rules are.
 */
import { ChannelId, mainTopicId } from '@juno/domain'

/** The topic id of a channel's Main. */
export const mainTopicOf = (channel: string): string => mainTopicId(ChannelId.make(channel))
