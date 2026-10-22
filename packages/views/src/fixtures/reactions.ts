/** A message's reactions with many people, for the reactions dialog and the who-reacted card. */
import type { Person } from '@juno/contract'
import { hueFor } from '../look'
import type { Reactor } from '../ReactorsCard'
import { me } from './messages'
import { people } from './topics'

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`)}`

/** Three workspace emoji, drawn as small pictures. */
export const customEmoji = {
  'party-blob': svg('<circle cx="16" cy="16" r="14" fill="#E39A3B"/><circle cx="11" cy="13" r="2" fill="#2B1E00"/><circle cx="21" cy="13" r="2" fill="#2B1E00"/><path d="M10 20c3 4 9 4 12 0" stroke="#2B1E00" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  shipit: svg('<path d="M4 20h24l-4 7H8Z" fill="#3B6EA8"/><rect x="15" y="5" width="2" height="15" fill="#5A4632"/><path d="M17 6l9 10h-9Z" fill="#F2EFE6"/><path d="M15 8l-8 9h8Z" fill="#D9D3C4"/>'),
  'this-is-fine': svg('<rect x="2" y="2" width="28" height="28" rx="6" fill="#F3C64B"/><path d="M6 26c2-6 4-9 6-9s2 4 4 4 3-6 5-6 3 5 5 11Z" fill="#E2632F"/><circle cx="16" cy="12" r="5" fill="#F7E2B5"/><rect x="11" y="10" width="10" height="2" fill="#2B1E00"/>'),
} as const

const extra: ReadonlyArray<readonly [string, string]> = [
  ['U0AMEY', 'Amey Kulkarni'],
  ['U0KRITHIK', 'Krithik Suvarna'],
  ['U0KRISH', 'Krish Goel'],
  ['U0RAJA', 'Raja Singh'],
  ['U0ADRIAN', 'Adrian Gehr'],
  ['U0GUSTAVO', 'Gustavo Graña'],
  ['U0ANTON', 'Anton Holub'],
  ['U0DAVID', 'David Oyelaran'],
  ['U0LONG', 'Maximilian-Alexander Fitzgerald-Montgomery-Rutherford'],
  ['U0SIOBHAN', 'Siobhán Ní Bhriain'],
  ['U0WEI', 'Wei Zhang'],
  ['U0NOOR', 'Noor Al-Hassan'],
  ['U0HANNA', 'Hanna Lindqvist'],
  ['U0TOMAS', 'Tomás Herrera'],
  ['U0AIKO', 'Aiko Tanaka'],
  ['U0OLU', 'Oluwaseun Adebayo-Williams'],
  ['U0MARTA', 'Marta Kowalczyk'],
  ['U0RAVI', 'Ravi Shankar Venkataraman'],
  ['U0LUCA', 'Luca Bianchi'],
  ['U0FREYA', 'Freya Olsen'],
  ['U0KOFI', 'Kofi Mensah'],
  ['U0ISABEL', 'Isabel Fontaine-Durand'],
  ['U0YUSUF', 'Yusuf Demir'],
  ['U0CHLOE', 'Chloé Martin'],
  ['U0ARJUN', 'Arjun Mehta'],
  ['U0NADIA', 'Nadia Petrova'],
  ['U0EMEKA', 'Emeka Okonkwo'],
  ['U0SOFIA', 'Sofía Castillo'],
  ['U0BEN', 'Ben Abernathy'],
  ['U0LENA', 'Lena Vogel'],
]
const colours = ['claret', 'midnight', 'cyan', 'emeraldDark', 'plum', 'rose', 'emerald', 'jordy'] as const

/** Everyone in the fixtures, you first: 41 people. */
export const crowd: ReadonlyArray<Person> = [
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
  ...extra.map(([id, name], index): Person => ({ id, name, color: colours[index % colours.length]! })),
]

export const asReactor = (person: Person): Reactor => ({
  id: person.id,
  name: person.name,
  you: person.id === me.id,
  hue: hueFor(person.color, person.id),
  ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }),
})

/** One reaction as the dialog takes it: who reacted, you first. */
export interface ReactionFixture {
  readonly name: string
  readonly emoji: string
  readonly url?: string
  readonly count: number
  readonly me: boolean
  readonly people: ReadonlyArray<Reactor>
}

const pick = (from: number, count: number, withMe = false): ReadonlyArray<Reactor> => {
  const others = crowd.slice(1)
  const chosen = Array.from({ length: withMe ? count - 1 : count }, (_, index) => others[(from + index) % others.length]!)
  return (withMe ? [me, ...chosen] : chosen).map(asReactor)
}

const standard = (name: string, emoji: string, count: number, from: number, withMe = false): ReactionFixture => ({ name, emoji, count, me: withMe, people: pick(from, count, withMe) })
const custom = (name: keyof typeof customEmoji, count: number, from: number, withMe = false): ReactionFixture => ({ name, emoji: `:${name}:`, url: customEmoji[name], count, me: withMe, people: pick(from, count, withMe) })

/** Twelve reactions on one message, three of them workspace emoji; 40 people on the first. */
export const manyReactions: ReadonlyArray<ReactionFixture> = [
  standard('tada', '🎉', 40, 0, true),
  standard('+1', '👍', 12, 4),
  custom('party-blob', 9, 9, true),
  standard('heart', '❤️', 7, 13),
  standard('raised_hands', '🙌', 6, 2),
  custom('shipit', 5, 20),
  standard('eyes', '👀', 4, 27),
  standard('fire', '🔥', 3, 31),
  standard('rocket', '🚀', 2, 6),
  custom('this-is-fine', 2, 35),
  standard('100', '💯', 1, 17),
  standard('white_check_mark', '✅', 1, 0, true),
]
