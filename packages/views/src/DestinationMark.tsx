import type { PickConversation } from '@juno/contract'
import { Avatar, ChannelIcon } from '@juno/ui'
import { channelIconFor, hueFor, initials } from './look'

/**
 * A conversation's mark wherever Home names it as a destination (Recent, the
 * destination list, the "Send to" list): a face, a group's initials or a
 * channel's art, at 20px, so one conversation looks the same in each.
 */
export function DestinationMark({ conversation }: { readonly conversation: PickConversation }) {
  const person = conversation.person
  if (person !== undefined) return <Avatar size={20} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
  if (conversation.kind === 'mpim') return <Avatar kind="group" size={20} label={initials(conversation.name)} hue={hueFor('', conversation.key)} />
  const icon = conversation.icon === undefined ? undefined : channelIconFor(conversation.icon)
  return <ChannelIcon name={conversation.name} id={conversation.channelId ?? conversation.key} size={20} {...(icon === undefined ? {} : { icon })} {...(conversation.color === undefined ? {} : { color: hueFor(conversation.color, conversation.key) })} />
}
