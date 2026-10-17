/** Home's Unfollow and Ignore proposals, and a mention in an ignored channel, for the fixtures: made-up topics in the fake workspace. */
import type { HomeItem, HomeTopic } from '@juno/contract'
import { art, NOW } from './topics'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

export const unfollowTopics: ReadonlyArray<HomeTopic> = [
  { id: 't:C0PLATFORM:1758000000.000100', title: 'Rollout plan for the new billing queue', place: 'platform', art: art.coins, at: NOW - 5 * HOUR, unopened: { count: 14, atLeast: false } },
  { id: 't:C0ENG:1758000000.000200', title: 'Flaky checkout spec on CI', place: 'eng', art: art.database, at: NOW - 2 * DAY, unopened: { count: 9, atLeast: false, lastRead: NOW - 19 * DAY } },
  { id: 't:C0PRODUCT:1758000000.000300', title: 'Pricing page copy, round three', place: 'product', art: art.calendar, at: NOW - 26 * HOUR, unopened: { count: 31, atLeast: true, lastRead: NOW - 24 * DAY } },
]

export const ignoreTopics: ReadonlyArray<HomeTopic> = [
  { id: 'm:C0DEPLOYS', title: '#deploys', place: 'deploys', main: true, at: NOW - 40 * 60_000, unopened: { count: 312, atLeast: true, lastRead: NOW - 36 * DAY } },
  { id: 'm:C0ALERTSPROD', title: '#alerts-prod', place: 'alerts-prod', main: true, art: art.bell, at: NOW - 3 * HOUR, unopened: { count: 58, atLeast: false, lastRead: NOW - 45 * DAY } },
]

export const unfollowItem: HomeItem = { id: 'unfollow', kind: 'unfollow', title: '3 threads you never open', topics: unfollowTopics }
export const ignoreItem: HomeItem = { id: 'ignore', kind: 'ignore', title: '2 channels you never read', topics: ignoreTopics }

/** Maya named the user in #deploys, which they ignore: the one way it reaches Home. */
export const mentionedItem: HomeItem = {
  id: 'mentioned:m:C0DEPLOYS',
  kind: 'mentioned',
  title: 'Maya mentioned you in #deploys',
  topics: [{ id: 'm:C0DEPLOYS', title: '#deploys', place: 'deploys' }],
  at: NOW - 8 * 60_000,
  channel: { id: 'C0DEPLOYS', kind: 'public', name: 'deploys', label: '#deploys', tint: 'public', icon: 'rocket', color: 'cyan' },
}
