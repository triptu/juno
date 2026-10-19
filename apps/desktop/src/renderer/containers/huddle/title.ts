import type { TopicDetail } from '@juno/contract'

/** "eng · Huddle", "Maya Chen · Huddle": the huddle tab's title (SPEC 20), from its channel's Main. */
export const huddleTabTitle = (detail: TopicDetail | null | undefined): string => (detail == null ? 'Huddle' : `${detail.channel.name} · Huddle`)
