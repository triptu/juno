/**
 * The reactions dialog's data (SPEC 7, "Reactions dialog"): every reaction
 * on one message and everyone who reacted, from `reactions.who`, which asks
 * Slack for the full lists when the store has only some of the people. Until
 * its first value arrives the dialog shows what the message's window already
 * has, so it opens at once. Its own chunk, loaded when idle.
 */
import type { MessageView, Person, WhoReacted } from '@juno/contract'
import { whoReactedAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { hueFor, ReactionsPopover, type ReactionsDialogEntry, type Reactor } from '@juno/views'
import type { SeeingReactions } from './topic/messageCommands'

export interface ReactionsDialogPanelProps {
  readonly channel: string
  readonly seeing: SeeingReactions
  /** The message as the list shows it; the dialog closes when it is gone. */
  readonly message: MessageView | undefined
  /** The window's people, for the first frame. */
  readonly people: ReadonlyMap<string, Person>
  readonly onSelect: (name: string) => void
  readonly onClose: () => void
}

export function ReactionsDialogPanel({ channel, seeing, message, people, onSelect, onClose }: ReactionsDialogPanelProps) {
  const result = useAtomValue(whoReactedAtom(channel, seeing.ts))
  const who = result._tag === 'Success' ? result.value : undefined
  if (message === undefined || who === null) return null
  const { reactions, loading } = who === undefined ? fromWindow(message, people) : fromEngine(who)
  if (reactions.length === 0) return null
  return <ReactionsPopover anchor={seeing.anchor} reactions={reactions} selected={seeing.name} onSelect={onSelect} loading={loading} onClose={onClose} />
}

function reactor(id: string, person: Person | undefined, you: boolean): ReadonlyArray<Reactor> {
  if (person === undefined) return []
  return [{ id, name: person.name, you, hue: hueFor(person.color, id), ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }) }]
}

function entry(reaction: { readonly name: string; readonly count: number; readonly unicode?: string; readonly url?: string }, reactors: ReadonlyArray<Reactor>): ReactionsDialogEntry {
  return { name: reaction.name, emoji: reaction.unicode ?? `:${reaction.name}:`, ...(reaction.url === undefined ? {} : { url: reaction.url }), count: Math.max(reaction.count, reactors.length), reactors }
}

/** The engine's lists: you first when you reacted, then Slack's order. */
function fromEngine(who: WhoReacted): { readonly reactions: ReadonlyArray<ReactionsDialogEntry>; readonly loading: boolean } {
  const known = new Map(who.people.map((person) => [person.id, person]))
  const reactions = who.reactions.map((reaction) => entry(reaction, reaction.users.flatMap((id, index) => reactor(id, known.get(id), reaction.me && index === 0))))
  const unnamed = who.reactions.some((reaction) => reaction.users.some((id) => !known.has(id)))
  return { reactions, loading: who.loading || unnamed }
}

/** The first frame, from the window: up to ten people a reaction, the rest waiting for the engine. */
function fromWindow(message: MessageView, people: ReadonlyMap<string, Person>): { readonly reactions: ReadonlyArray<ReactionsDialogEntry>; readonly loading: boolean } {
  const reactions = message.reactions.map((reaction) => entry(reaction, (reaction.users ?? []).flatMap((id, index) => reactor(id, people.get(id), reaction.me && index === 0))))
  return { reactions, loading: true }
}
