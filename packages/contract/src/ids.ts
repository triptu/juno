/**
 * Topic ids the renderer builds itself: a channel's Main, for the header's
 * topic switcher, and a huddle's thread. A `@juno/domain` rule, reached here as the other domain
 * rules are.
 */
import { ChannelId, mainTopicId, threadTopicId, Ts } from '@juno/domain'

/** The topic id of a channel's Main. */
export const mainTopicOf = (channel: string): string => mainTopicId(ChannelId.make(channel))

/** The topic id of a thread. */
export const threadTopicOf = (channel: string, threadTs: string): string => threadTopicId(ChannelId.make(channel), Ts.make(threadTs))
