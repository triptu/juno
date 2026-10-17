/** Tidy up's proposals for the fixtures: made-up topics in the fake workspace, each with why it looks settled. */
import type { HomeItem, HomeTopic } from '@juno/contract'
import { art, NOW } from './topics'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

export const settledTopics: ReadonlyArray<HomeTopic> = [
  { id: 't:C0ENG:1759980000.000500', title: 'Checkout spec flaky on CI', place: 'eng', art: art.database, at: NOW - 2 * DAY, settled: { kind: 'thanks', by: 'Maya' } },
  { id: 't:C0INCIDENTS:1759980000.000600', title: 'p95 regression on search', place: 'incidents', art: art.bell, at: NOW - 6 * DAY, settled: { kind: 'afterYou' } },
  { id: 't:C0DESIGNREV:1759980000.000700', title: 'Icon refresh for the settings rail', place: 'design-review', art: art.calendar, at: NOW - 26 * HOUR, settled: { kind: 'done', by: 'Dev' } },
  { id: 'm:D0PRIYA', title: 'Priya Raman', place: 'Priya Raman', at: NOW - 5 * HOUR, settled: { kind: 'agreed', by: 'Priya' } },
  { id: 't:C0FINANCE:1759980000.000800', title: 'Q4 vendor invoices', place: 'finance', art: art.coins, at: NOW - 3 * DAY, settled: { kind: 'quiet', juno: 'the invoices were approved and filed' } },
]

/** A long week: enough rows that the sheet's list scrolls. */
export const manySettled: ReadonlyArray<HomeTopic> = [
  ...settledTopics,
  { id: 't:C0HIRING:1759980000.000900', title: 'Onsite loop for the staff designer role', place: 'hiring', art: art.people, at: NOW - 4 * DAY, settled: { kind: 'thanks' } },
  { id: 't:C0ENG:1759980000.001000', title: 'Bump the Electron version on the release branch', place: 'eng', art: art.database, at: NOW - 30 * HOUR, settled: { kind: 'done', by: 'Sam' } },
  { id: 't:C0PRODUCT:1759980000.001100', title: 'Rename "Spaces" to "Views" in the onboarding copy', place: 'product', art: art.calendar, at: NOW - 8 * DAY, settled: { kind: 'quiet' } },
  { id: 'm:D0JONAS', title: 'Jonas Weber', place: 'Jonas Weber', at: NOW - 2 * DAY, settled: { kind: 'afterYou' } },
]

/** Today's card: the titles joined in the meta line, as the owner saw it. */
export const tidyUpItem: HomeItem = { id: 'tidyUp', kind: 'tidyUp', title: '5 topics look settled', topics: settledTopics }
