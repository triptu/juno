/** Automated's record for the fixtures: made-up channels Juno moved in and back out, each with the counts that decided it. */
import type { ChannelRef, HomeItem, HomeTopic } from '@juno/contract'
import { art, NOW } from './topics'

const HOUR = 60 * 60_000

const ref = (id: string, name: string, icon: ChannelRef['icon'], color: ChannelRef['color']): ChannelRef => ({ id, kind: 'public', name, label: `#${name}`, tint: 'public', icon, color })

export const movedIn: ReadonlyArray<HomeTopic> = [
  {
    id: 'm:C0CIBUILDS',
    title: '#ci-builds',
    place: 'ci-builds',
    art: art.database,
    at: NOW - 3 * HOUR,
    moved: { channel: ref('C0CIBUILDS', 'ci-builds', 'wrench', 'emerald'), change: 'in', reason: 'Apps wrote 28 of the last 30 top-level messages' },
  },
  {
    id: 'm:C0VENDORSTATUS',
    title: '#vendor-status',
    place: 'vendor-status',
    art: art.bell,
    at: NOW - 20 * HOUR,
    moved: { channel: ref('C0VENDORSTATUS', 'vendor-status', 'globe', 'claret'), change: 'in', reason: 'Apps wrote 24 of the last 30 top-level messages', detail: 'Juno: status updates from an app, a few replies' },
  },
]

export const movedOut: HomeTopic = {
  id: 'm:C0ENGAGENTS',
  title: '#eng-agents',
  place: 'eng-agents',
  art: art.people,
  at: NOW - 5 * HOUR,
  moved: { channel: ref('C0ENGAGENTS', 'eng-agents', 'code', 'jordy'), change: 'out', reason: 'Moved back: people start most conversations here', detail: 'People wrote 19 of the last 30 top-level messages' },
}

export const movedTopics: ReadonlyArray<HomeTopic> = [...movedIn, movedOut]

/** Home's card: two moved in, one moved back. */
export const automatedMovesItem: HomeItem = { id: 'automatedMoves', kind: 'automatedMoves', title: 'Juno moved 2 channels to Automated and 1 back', topics: movedTopics }
/** Only moves in, as the owner described it. */
export const automatedMovesInItem: HomeItem = { id: 'automatedMoves', kind: 'automatedMoves', title: 'Juno moved 2 channels to Automated', topics: movedIn }
