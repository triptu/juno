import { code, link, list, p, picture, quote, t, window } from './messages'
import { people } from './topics'

/**
 * One message with every block that wraps text, as people write them: two
 * bare links, a bulleted list with long items, a nested list, a quote, a long
 * URL with no break in it, a code block, and the first link's preview card
 * with its picture, as Slack unfurls it. Every block must wrap inside the
 * message's text column at any pane width, and the picture shrinks to fit it.
 */
export const richText = window([
  {
    ago: 8,
    from: people.priya,
    blocks: [
      p(link('https://x.com/toruai/status/2112593925114634603?s=20', 'x.com/toruai/status/2112593925114634603?s=20')),
      p(link('https://shogunai.si/?lang=en', 'shogunai.si/?lang=en')),
      list('bullet', [
        'very similar to us but runs on local memory',
        'similar messaging - all your work in one place, completes your work for you, waits for your approval - "An AI assistant that remembers your work and helps with what comes next."',
        'Interface is different, they are banking on the notch above - might be sticky?',
        'Action cards look similar too?',
      ]),
      list('bullet', ['the onboarding asks for calendar, mail and docs access before it shows anything, which feels like a lot for a first run'], 1),
      list('bullet', ['pricing is per seat, with a free tier capped at fifty actions a month and no team plan yet'], 2),
      quote('They say the assistant drafts replies for you and waits for your approval before anything is sent, which is close to how our review cards work today.'),
      p('Their changelog: ', link('https://shogunai.si/changelog/2026/10/assistant-memory-and-approvals-release-notes-with-every-detail-of-the-rollout')),
      code(`curl -s "https://api.shogunai.si/v1/assistant/memory?workspace=team-research&include=approvals,drafts,history" | jq '.items[] | {id, kind, created_at}'`),
      {
        kind: 'attachment',
        tint: 'neutral',
        author: { name: 'Toru (@toruai)' },
        title: [link('https://x.com/toruai/status/2112593925114634603', 'Toru on X')],
        blocks: [p('Your work, remembered. Toru keeps track of what you are doing and finishes it for you.'), { kind: 'image', url: picture(1200, 675, '#8A9BB0'), alt: 'Toru preview', width: 1200, height: 675 }],
        footer: [t('X')],
      },
    ],
  },
])
