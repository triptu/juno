/** Home's items for the fixtures: what the fake workspace would show. */
import type { HomeItem } from '@juno/contract'
import { art, NOW, people } from './topics'

const MINUTE = 60_000

const hiring = { id: 't:C0HIRING:1759990000.000300', title: 'Rina finished the onsite. Panel notes…', place: 'hiring', art: art.people }
const postgres = { id: 't:C0ENG:1759990000.000100', title: 'Postgres 16 migration plan', place: 'eng', art: art.database }
const proposal = { id: 't:C0PRODUCT:1759990000.000200', title: 'Proposal: cut offline mode and public API v3 from Q4', place: 'product', art: art.calendar }
const packet = { id: 'm:D0SAM', title: 'Sam Okafor', place: 'Sam Okafor', main: true, person: people.sam }
const releases = { id: 'm:C0RELEASES', title: '#releases', place: 'releases', main: true }
const vendorStatus = { id: 'm:C0VENDORSTATUSUPDATES', title: '#vendor-status-updates', place: 'vendor-status-updates', main: true }
// Mains of a DM, a group DM and a channel: the tile is the person, the pair, or the channel's art, as in the sidebar.
const mayaMain = { id: 'm:D0MAYA', title: 'Maya Chen', place: 'Maya Chen', main: true, person: people.maya }
const devMain = { id: 'm:D0DEV', title: 'Dev Patel', place: 'Dev Patel', main: true, person: people.dev }
const offsiteMain = { id: 'm:G0OFFSITE', title: 'Maya, Leo', place: 'Maya, Leo', main: true, members: [people.maya, people.leo] }
const engMain = { id: 'm:C0ENG', title: '#eng', place: 'eng', main: true, art: art.database }

export const homeItems = {
  waiting: { id: `waiting:${hiring.id}`, kind: 'waiting', title: 'Elena asked you something', topics: [hiring], at: NOW - 12 * MINUTE },
  resume: { id: `resume:${postgres.id}`, kind: 'resume', title: 'Pick up where you left off', topics: [postgres], at: NOW - 26 * 60 * MINUTE },
  moved: { id: `moved:${proposal.id}`, kind: 'moved', title: 'Moved a lot since you looked', topics: [proposal], newCount: 14 },
  followUp: {
    id: `followUp:${packet.id}:1759990000.000400`,
    kind: 'followUp',
    title: "You said you'd review Dev's packet this week",
    topics: [packet],
    at: NOW - 3 * 60 * MINUTE,
    messageTs: '1759990000.000400',
  },
  tidyUp: {
    id: 'tidyUp',
    kind: 'tidyUp',
    title: '3 topics look settled',
    topics: [
      { id: 't:C0ENG:1759980000.000500', title: 'Checkout spec flaky on CI', place: 'eng' },
      { id: 't:C0INCIDENTS:1759980000.000600', title: 'p95 regression on search', place: 'incidents' },
      { id: 't:C0DESIGNREV:1759980000.000700', title: 'Icon refresh', place: 'design-review' },
    ],
  },
  automated: {
    id: 'automated:C0RELEASES',
    kind: 'automated',
    title: 'Move #releases?',
    topics: [releases],
    at: NOW - 35 * MINUTE,
    channel: { id: 'C0RELEASES', kind: 'public', name: 'releases', label: '#releases', tint: 'public', icon: 'rocket', color: 'cyan' },
    reason: 'Apps wrote 18 of the last 30 top-level messages',
  },
  /** Asked after Juno judged it: Juno's reason, on a long channel name. */
  automatedByJuno: {
    id: 'automated:C0VENDORSTATUSUPDATES',
    kind: 'automated',
    title: 'Move #vendor-status-updates?',
    topics: [vendorStatus],
    at: NOW - 3 * 60 * MINUTE,
    channel: { id: 'C0VENDORSTATUSUPDATES', kind: 'public', name: 'vendor-status-updates', label: '#vendor-status-updates', tint: 'public', icon: 'hash', color: 'midnight' },
    reason: 'Status updates from an app, a few replies',
  },
  /** A question in a DM: the person's photo, and their name once on the meta line. */
  dm: { id: 'waiting:m:D0MAYA', kind: 'waiting', title: 'Maya asked you something', topics: [mayaMain], at: NOW - 7 * 60 * MINUTE },
  /** A DM with someone who has no photo: their colour and initials. */
  dmNoPhoto: { id: 'resume:m:D0DEV', kind: 'resume', title: 'Pick up where you left off', topics: [devMain], at: NOW - 2 * 60 * MINUTE },
  /** A group DM: two members' photos in a pair, and the group named once. */
  groupDm: { id: 'waiting:m:G0OFFSITE', kind: 'waiting', title: 'Leo asked you something', topics: [offsiteMain], at: NOW - 40 * MINUTE },
  /** A channel's Main: its art, and the channel named once. */
  channelMain: { id: 'moved:m:C0ENG', kind: 'moved', title: 'Moved a lot since you looked', topics: [engMain], newCount: 23 },
} satisfies Record<string, HomeItem>

/** The same items with the assistant's title lines. The meta lines are the same. */
export const rewritten = {
  waiting: { ...homeItems.waiting, aiTitle: "Elena wants a call on Rina's competing offer by Friday" },
  resume: { ...homeItems.resume, aiTitle: 'Pick up where you left off: Dev wants the Postgres 16 cutover window' },
  moved: { ...homeItems.moved, aiTitle: "Maya's proposal grew 14 replies, leaning toward cutting offline mode" },
} satisfies Record<string, HomeItem>
