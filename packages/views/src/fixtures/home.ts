/** Home's items for the fixtures: what the fake workspace would show. */
import type { HomeItem } from '@juno/contract'
import type { HomeProps } from '../Home'
import { art, NOW } from './topics'

const MINUTE = 60_000

const hiring = { id: 't:C0HIRING:1759990000.000300', title: 'Rina finished the onsite. Panel notes…', place: 'hiring', art: art.people }
const postgres = { id: 't:C0ENG:1759990000.000100', title: 'Postgres 16 migration plan', place: 'eng', art: art.database }
const proposal = { id: 't:C0PRODUCT:1759990000.000200', title: 'Proposal: cut offline mode and public API v3 from Q4', place: 'product', art: art.calendar }
const packet = { id: 'm:D0SAM', title: 'Sam Okafor', place: 'Sam Okafor' }
const releases = { id: 'm:C0RELEASES', title: '#releases', place: 'releases' }
const vendorStatus = { id: 'm:C0VENDORSTATUSUPDATES', title: '#vendor-status-updates', place: 'vendor-status-updates' }

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
    reason: 'Apps wrote 18 of the last 30 messages',
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
} satisfies Record<string, HomeItem>

/** The same items with the assistant's title lines. The meta lines are the same. */
export const rewritten = {
  waiting: { ...homeItems.waiting, aiTitle: "Elena wants a call on Rina's competing offer by Friday" },
  resume: { ...homeItems.resume, aiTitle: 'Pick up where you left off: Dev wants the Postgres 16 cutover window' },
  moved: { ...homeItems.moved, aiTitle: "Maya's proposal grew 14 replies, leaning toward cutting offline mode" },
} satisfies Record<string, HomeItem>

const noop = () => {}

/** Home's props for the merged Home proposals: the morning greeting and three rows, overridable. */
export const homeProps = (props: Partial<Omit<HomeProps, 'onAsk' | 'below'>> = {}): Omit<HomeProps, 'onAsk' | 'below'> => ({
  scene: 'morning',
  title: 'Morning, Tushar.',
  line: 'Three things want you.',
  items: [homeItems.waiting, homeItems.resume, homeItems.moved],
  now: NOW,
  enter: false,
  onOpen: noop,
  onMarkDone: noop,
  onResolveAll: noop,
  onSort: noop,
  onItemMenu: noop,
  ...props,
})
