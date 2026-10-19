import type { ComponentType } from 'react'
import type { TopicDetail } from '@juno/contract'
import { HuddleHeaderAction } from '../huddle/slots'

/**
 * Controls that features add to a Main's header, first in the right island
 * and in this order (the TopicHeader view's `actions` slot). Each is a
 * container that reads its own state from the Main's channel, so the topic
 * does not re-render for it. The huddle control goes here.
 */
export const topicHeaderActions: ReadonlyArray<ComponentType<{ readonly detail: TopicDetail }>> = [HuddleHeaderAction]
