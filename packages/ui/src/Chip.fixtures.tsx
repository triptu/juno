import { EyeOff, Sparkles } from 'lucide-react'
import { Button } from './Button'
import { Chip } from './Chip'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row, Stack } from './fixtures/layout'

export default defineFixtures(Chip, {
  main: fixture({ variant: 'outline', size: 18, title: 'Messages posted in this channel or DM outside any thread', children: 'Main' }),
  reopened: fixture({ variant: 'filled', size: 18, title: 'New activity after it was resolved', children: 'Reopened' }),
  'unread-count': fixture({ variant: 'strong', size: 18, numeric: true, children: '9' }),
  'read-count': fixture({ variant: 'filled', size: 18, numeric: true, children: '3' }),
  mention: fixture({ variant: 'soft', size: 18, title: 'Mentions you', children: '@' }),
  'mention-accent': fixture({ variant: 'accent', size: 18, children: '@' }),
  'status-open': fixture({ variant: 'filled', size: 22, children: 'Open' }),
  'status-resolved': fixture({ variant: 'success', size: 22, children: 'Resolved' }),
  'status-quiet': fixture({ variant: 'quiet', size: 22, children: 'Quiet' }),
  'decision-now': fixture({ variant: 'accent', size: 22, children: 'Now' }),
  confidence: fixture({ variant: 'filled', size: 20, icon: Sparkles, title: "Juno's read of what you typed", children: '95%' }),
  reaction: fixture({ variant: 'outline', size: 24, interactive: true, 'aria-label': 'React 👍, 2 reactions', children: '👍 2' }),
  'reaction-mine': fixture({ variant: 'outline', size: 24, interactive: true, pressed: true, 'aria-label': 'React 👍, 2 reactions, including you', children: '👍 2' }),
  scope: fixture({ variant: 'filled', size: 26, onRemove: () => {}, removeLabel: 'Show everything', children: 'eng' }),
  'digest-time': fixture({ variant: 'filled', size: 28, onRemove: () => {}, children: '10am' }),
  stealth: scene(() => (
    <Chip variant="dashed" size={26} icon={EyeOff} iconSize={13}>
      Stealth. Not marking as read.
      <Button size="xs" variant="secondary" radius="md">
        Mark read
      </Button>
    </Chip>
  )),
  summary: scene(() => (
    <Row gap="sm">
      <Chip variant="accent" size={24} numeric>
        <b>4</b> interrupted you
      </Chip>
      <Chip variant="filled" size={24} numeric>
        <b>5</b> waited for a digest
      </Chip>
      <Chip variant="surface" size={24} numeric>
        <b>3</b> stayed silent
      </Chip>
    </Row>
  )),
  'all-variants': scene(() => (
    <Stack>
      <Row gap="sm">
        <Chip variant="outline">Main</Chip>
        <Chip variant="filled">Reopened</Chip>
        <Chip variant="strong" numeric>
          12
        </Chip>
        <Chip variant="soft">@</Chip>
        <Chip variant="accent">@</Chip>
        <Chip variant="filled" size={20} icon={Sparkles}>
          95%
        </Chip>
      </Row>
      <Row gap="sm">
        <Chip variant="filled" size={22}>
          Open
        </Chip>
        <Chip variant="success" size={22}>
          Resolved
        </Chip>
        <Chip variant="quiet" size={22}>
          Quiet
        </Chip>
        <Chip variant="quiet" size={22}>
          Unsubscribed
        </Chip>
        <Chip variant="accent" size={22}>
          Now
        </Chip>
        <Chip variant="filled" size={22}>
          1pm
        </Chip>
        <Chip variant="quiet" size={22}>
          Silent
        </Chip>
      </Row>
      <Row gap="sm">
        <Chip variant="outline" size={24} interactive aria-label="React 👍, 2 reactions">
          👍 2
        </Chip>
        <Chip variant="outline" size={24} interactive pressed aria-label="React 🙏, 1 reaction, including you">
          🙏 1
        </Chip>
        <Chip variant="filled" size={26} onRemove={() => {}} removeLabel="Show everything">
          eng
        </Chip>
        <Chip variant="filled" size={28} onRemove={() => {}}>
          4:30pm
        </Chip>
      </Row>
    </Stack>
  )),
})
