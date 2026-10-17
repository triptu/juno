/** The follow-ups that look done and the old drafts, for the fixtures: made-up topics in the fake workspace. */
import type { HomeItem, HomeTopic } from '@juno/contract'
import { art, NOW, people } from './topics'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const ts = (millis: number) => `${Math.floor(millis / 1000)}.000100`

const promised = (id: string, title: string, place: string, promise: string, hoursAgo: number, laterHours: number, kind: 'file' | 'link' | 'said', text: string, picture?: string): HomeTopic => ({
  id,
  title,
  place,
  ...(picture === undefined ? {} : { art: picture }),
  at: NOW - hoursAgo * HOUR,
  followUp: { promiseTs: ts(NOW - hoursAgo * HOUR), promise, ts: ts(NOW - (hoursAgo - laterHours) * HOUR), kind, text },
})

export const doneFollowUpTopics: ReadonlyArray<HomeTopic> = [
  promised('t:C0DESIGNREV:1759980000.001200', 'Onboarding deck for Thursday', 'design-review', "You said you'd send the deck before Thursday", 26, 3, 'file', 'File: onboarding-deck-v3.pdf', art.calendar),
  promised('m:D0PRIYA', 'Priya Raman', 'Priya Raman', "You said you'd share the hiring rubric", 50, 20, 'link', 'Link: docs.example.com/hiring/rubric'),
  promised('t:C0ENG:1759980000.001300', 'Flaky checkout spec', 'eng', "You said you'd look at the retry logic", 8, 6, 'said', "Done, the retry now waits for the cart to load. Merged in #4182.", art.database),
]

export const oldDraftTopics: ReadonlyArray<HomeTopic> = [
  { id: 't:C0FINANCE:1759980000.001400', title: 'Q4 vendor invoices', place: 'finance', art: art.coins, draft: { text: 'I think we should hold the Northwind invoice until', at: NOW - 23 * DAY, since: 14 } },
  { id: 'm:D0JONAS', title: 'Jonas Weber', place: 'Jonas Weber', main: true, person: people.jonas, draft: { text: 'Thanks for the notes on the offsite plan, one thing', at: NOW - 16 * DAY, since: 3 } },
  { id: 't:C0HIRING:1759980000.001500', title: 'Onsite loop for the staff designer role', place: 'hiring', art: art.people, draft: { text: 'Can we move the portfolio review to', at: NOW - 40 * DAY, since: 50, more: true } },
]

export const doneFollowUpsItem: HomeItem = { id: 'doneFollowUps', kind: 'doneFollowUps', title: '3 follow-ups look done', topics: doneFollowUpTopics }
export const oldDraftsItem: HomeItem = { id: 'oldDrafts', kind: 'oldDrafts', title: '3 old drafts', topics: oldDraftTopics }
