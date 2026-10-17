/** A row's tile, apart from how it looks (`PlaceTile`). */
import type { HomeTopic, Person } from '@juno/contract'

/** What a Home or review row's tile draws: the topic's art, or the people of a DM's or group DM's Main. */
export interface PlaceTileModel {
  readonly topicId: string
  readonly art?: string
  readonly person?: Person
  readonly members?: ReadonlyArray<Person>
}

/** The tile fields of a Home topic, for a row model that names its topic `topicId`. */
export const tileOf = (topic: HomeTopic): PlaceTileModel => ({
  topicId: topic.id,
  ...(topic.art === undefined ? {} : { art: topic.art }),
  ...(topic.person === undefined ? {} : { person: topic.person }),
  ...(topic.members === undefined ? {} : { members: topic.members }),
})
