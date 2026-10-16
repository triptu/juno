import { defineFixtures, fixture } from '@juno/ui'
import { hueFor } from './look'
import { me } from './fixtures/messages'
import { people } from './fixtures/topics'
import type { Person } from '@juno/contract'
import { ReactorsCard, type Reactor } from './ReactorsCard'

const reactor = (person: Person, you = false): Reactor => ({
  id: person.id,
  name: person.name,
  you,
  hue: hueFor(person.color, person.id),
  ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }),
})

const crowd: ReadonlyArray<Person> = [
  me,
  people.maya,
  people.leo,
  people.dev,
  people.sam,
  people.priya,
  people.jonas,
  people.elena,
  people.mohammed,
  people.unicorn,
]

const blob = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#E39A3B"/><circle cx="11" cy="13" r="2" fill="#2B1E00"/><circle cx="21" cy="13" r="2" fill="#2B1E00"/><path d="M10 20c3 4 9 4 12 0" stroke="#2B1E00" stroke-width="2" fill="none" stroke-linecap="round"/></svg>')}`

export default defineFixtures(ReactorsCard, {
  // Who reacted, from the reaction chip under a message.
  Reactors: {
    one: fixture({ name: 'eyes', emoji: '👀', reactors: [reactor(people.maya)], others: 0 }),
    three: fixture({ name: '+1', emoji: '👍', reactors: [reactor(me, true), reactor(people.leo), reactor(people.sam)], others: 0 }),
    // Fifteen: ten named, you first, then the rest of the count.
    fifteen: fixture({ name: 'tada', emoji: '🎉', reactors: crowd.map((person, i) => reactor(person, i === 0)), others: 5 }),
  },
  Data: {
    // Slack listed fewer people than its count.
    partial: fixture({ name: 'white_check_mark', emoji: '✅', reactors: [reactor(people.dev), reactor(people.priya)], others: 4 }),
    'nobody-listed': fixture({ name: 'rocket', emoji: '🚀', reactors: [], others: 3 }),
    custom: fixture({ name: 'party-blob', emoji: ':party-blob:', url: blob, reactors: [reactor(people.elena), reactor(people.jonas)], others: 1 }),
    'long-name': fixture({ name: 'face_with_open_eyes_and_hand_over_mouth', emoji: '🫢', reactors: [reactor({ id: 'U0LONG', name: 'Maximilian-Alexander Fitzgerald-Montgomery-Rutherford', color: 'jordy' })], others: 0 }),
  },
})
