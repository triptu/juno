import type { ReactionRow } from '@juno/contract'
import { channels, NOW, people } from './topics'

const MINUTE = 60_000

/** The Reactions view as it reads on an ordinary afternoon: a reply, one message several people liked, a DM, a long preview. */
export const reactionRows: ReadonlyArray<ReactionRow> = [
  {
    id: 'C0ENG:1759999000.000100',
    topicId: 't:C0ENG:1759990000.000100',
    ts: '1759999000.000100',
    at: NOW - 12 * MINUTE,
    reactors: [people.maya, people.sam],
    moreReactors: 2,
    who: 'Maya, Sam +2',
    emoji: [{ name: 'tada', unicode: '🎉' }, { name: '+1', unicode: '👍' }],
    preview: 'Shipped the fix for the stuck upload queue. Retries now back off properly.',
    channel: channels.eng,
    threadTitle: 'Upload queue stuck on retry',
  },
  {
    id: 'C0PRODUCT:1759998000.000100',
    topicId: 'm:C0PRODUCT',
    ts: '1759998000.000100',
    at: NOW - 48 * MINUTE,
    reactors: [people.priya],
    moreReactors: 0,
    who: 'Priya',
    emoji: [{ name: 'eyes', unicode: '👀' }],
    preview: "I'll take a look at the flaky checkout test after standup.",
    channel: channels.product,
  },
  {
    id: 'D0DEV:1759990000.000100',
    topicId: 'm:D0DEV',
    ts: '1759990000.000100',
    at: NOW - 3 * 60 * MINUTE,
    reactors: [people.dev],
    moreReactors: 0,
    who: 'Dev',
    emoji: [{ name: 'white_check_mark', unicode: '✅' }],
    preview: 'Booked the small room for Thursday at 3pm.',
    channel: channels.dev,
  },
  {
    id: 'C0HIRING:1759900000.000100',
    topicId: 't:C0HIRING:1759800000.000100',
    ts: '1759900000.000100',
    at: NOW - 26 * 60 * MINUTE,
    reactors: [people.elena, people.leo],
    moreReactors: 0,
    who: 'Elena, Leo',
    emoji: [{ name: 'pray', unicode: '🙏' }, { name: 'heart', unicode: '❤️' }],
    preview: "Here's the onboarding doc for Rina. Comments welcome before Monday, especially on the first week's schedule.",
    channel: channels.hiring,
    threadTitle: "Here's the onboarding plan for…",
    threadTitleSensitive: true,
  },
]
