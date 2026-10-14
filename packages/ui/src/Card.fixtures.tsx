import { CalendarCheck } from '@phosphor-icons/react/dist/icons/CalendarCheck'
import { ChatCircleDots } from '@phosphor-icons/react/dist/icons/ChatCircleDots'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { Terminal } from '@phosphor-icons/react/dist/icons/Terminal'
import { Button } from './Button'
import { Card } from './Card'
import { CodeBlock } from './CodeBlock'
import { defineFixtures, fixture } from './fixtures/define'

const prompt = `In infra/preview-envs, add a reaper that deletes preview environments with no deploys in the last 48 hours.
- Run hourly as a scheduled job
- Skip environments labeled keep=true`

export default defineFixtures(
  Card,
  {
    Kind: {
      'coding-agent': fixture({
        kindIcon: Terminal,
        kind: 'Coding agent',
        sourceIcon: Hash,
        source: 'Staging bill doubled since August',
        title: 'Hand the preview-env reaper to a coding agent',
        body: 'Jonas offered to add a 48h TTL to preview environments. Here is a prompt you could paste into Claude Code or Cursor.',
        children: <CodeBlock>{prompt}</CodeBlock>,
        actions: (
          <>
            <Button size="md" variant="secondary">
              Copy prompt
            </Button>
            <Button size="md" variant="ghost" tone="subtle">
              Refine with Juno
            </Button>
            <Button size="md" variant="ghost" tone="subtle">
              Open topic
            </Button>
          </>
        ),
        onDismiss: () => {},
      }),
      'waiting-on-you': fixture({
        kindIcon: ChatCircleDots,
        kind: 'Waiting on you',
        sourceIcon: Lock,
        source: 'Rina Sato · Staff backend',
        title: 'Elena needs a time for the Rina close call',
        body: "Rina's competing offer expires Friday. Elena asked for a 30 minute slot tomorrow.",
        actions: (
          <>
            <Button size="md" variant="ghost" tone="subtle">
              Ask Juno
            </Button>
            <Button size="md" variant="ghost" tone="subtle">
              Open topic
            </Button>
          </>
        ),
        onDismiss: () => {},
      }),
      'follow-up': fixture({
        kindIcon: CalendarCheck,
        kind: 'Follow-up',
        sourceIcon: Hash,
        source: 'Q4 roadmap cuts',
        title: 'Tushar has not looked at the roadmap draft',
        body: 'Maya is waiting on your review before cross-posting to #leadership.',
        actions: (
          <>
            <Button size="md" variant="secondary">
              Mark done
            </Button>
            <Button size="md" variant="ghost" tone="subtle">
              Open topic
            </Button>
          </>
        ),
        onDismiss: () => {},
      }),
    },
    Interaction: {
      'dismiss-hover': fixture(
        {
          kindIcon: CalendarCheck,
          kind: 'Follow-up',
          sourceIcon: Hash,
          source: 'Q4 roadmap cuts',
          title: 'Tushar has not looked at the roadmap draft',
          body: 'Maya is waiting on your review before cross-posting to #leadership.',
          onDismiss: () => {},
        },
        { hover: 'button' },
      ),
    },
  },
  { width: 720 },
)
