import type { PickConversation } from '@juno/contract'
import { Avatar, GroupAvatar, TopicArt } from '@juno/ui'
import { hueFor, initials, stackPerson } from './look'

/**
 * A conversation's mark wherever Home names it as a destination (Recent, the
 * destination list, the "Send to" list): a face, a group's pair of faces
 * (initials until its members are known) or a channel's Main art, at 20px,
 * so one conversation looks the same in each and as its Main row does in
 * the sidebar.
 */
export function DestinationMark({ conversation }: { readonly conversation: PickConversation }) {
  const person = conversation.person
  if (person !== undefined) return <Avatar size={20} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
  const members = conversation.members ?? []
  if (members.length >= 2) return <GroupAvatar people={members.map((member) => stackPerson(member))} size={20} />
  if (conversation.kind === 'mpim') return <Avatar kind="group" size={20} label={initials(conversation.name)} hue={hueFor('', conversation.key)} />
  return <TopicArt topicId={conversation.mainId ?? conversation.key} {...(conversation.art === undefined ? {} : { recipe: conversation.art })} size={20} />
}
