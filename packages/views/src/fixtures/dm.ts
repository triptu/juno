/** Conversations in the DM with Maya, for pages that need a DM's real-looking messages. */
import { link, me, p, reaction, window } from './messages'
import { NOW, people } from './topics'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** A DM thread with Maya about the offsite: short messages, a link and a reaction. */
export const dmThread = window([
  { ago: 5 * HOUR / MINUTE, from: people.maya, root: true, text: 'For the offsite, can we keep Wednesday afternoon free for the roadmap review? Morning is already full with the customer panel.' },
  { ago: 5 * HOUR / MINUTE - 6, from: me, text: 'Yes. 2 to 5pm works for me. Should we invite Leo and Priya too?' },
  { ago: 5 * HOUR / MINUTE - 9, from: people.maya, text: 'Leo yes. Priya is out that week, so I will send her the notes after.' },
  { ago: 4 * HOUR / MINUTE, from: people.maya, blocks: [p('Draft agenda is here: ', link('https://example.com/docs/offsite-agenda', 'offsite agenda'), '. Comments welcome before Friday.')], reactions: [reaction('eyes', '👀', 1, true)] },
  { ago: 3 * HOUR / MINUTE, from: me, blocks: [p('Left two comments. The main one: the hiring plan section needs 30 minutes, not 15.')] },
  { ago: 2 * HOUR / MINUTE, from: people.maya, text: 'Fair. I moved the break to 3:45 so we have room.' },
  { ago: 26, from: people.maya, text: 'Also booked the small room on the 4th floor. The big one has the projector issue again.' },
  { ago: 7, from: me, text: 'Perfect, thanks. I will put it in the calendar.' },
])

/** The Main of the DM with Maya: day-to-day messages. */
export const dmMain = window([
  { ago: 7 * HOUR / MINUTE, from: people.maya, text: 'Morning! Did the vendor send the new contract?' },
  { ago: 7 * HOUR / MINUTE - 4, from: me, text: 'Not yet. They said by noon.' },
  { ago: 5 * HOUR / MINUTE, from: people.maya, text: 'For the offsite, can we keep Wednesday afternoon free for the roadmap review?', thread: { id: 'D0MAYA:1759990000.000500', replyCount: 7, label: '7 replies', title: 'Offsite: Wednesday afternoon slot', titleSource: 'manual', lastReplyAt: NOW - 7 * MINUTE } },
  { ago: 3 * HOUR / MINUTE, from: me, blocks: [p('Contract is in: ', link('https://example.com/docs/vendor-contract-v3', 'vendor contract v3'), '. Section 4 changed the renewal terms.')] },
  { ago: 3 * HOUR / MINUTE - 12, from: people.maya, text: 'Reading it now.', reactions: [reaction('+1', '👍', 1, true)] },
  { ago: 95, from: people.maya, text: 'Section 4 looks fine to me. The notice period went from 60 to 90 days, which finance already agreed to.' },
  { ago: 40, from: me, text: 'Great, I will sign it this afternoon.' },
  { ago: 12, from: people.maya, text: 'Quick call about the hiring plan before your 3pm?' },
])
