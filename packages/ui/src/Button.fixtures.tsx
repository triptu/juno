import { ArrowUp, Bell, Check, CircleCheck, LayoutList, Lightbulb, Sparkles } from 'lucide-react'
import { Button } from './Button'
import { Chip } from './Chip'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row, Stack } from './fixtures/layout'

export default defineFixtures(Button, {
  primary: fixture({ variant: 'primary', size: '2xl', children: 'Send' }),
  secondary: fixture({ variant: 'secondary', size: '2xl', children: 'Discard' }),
  outline: fixture({ variant: 'outline', size: 'lg', iconStart: CircleCheck, children: 'Resolve' }),
  ghost: fixture({ variant: 'ghost', size: 'md', tone: 'subtle', children: 'Open topic' }),
  raised: fixture({ variant: 'raised', size: 'sm', kbd: '↵', children: 'Fix and send' }),
  'small-action': fixture({ variant: 'secondary', size: 'sm', children: 'Group into topic' }),
  'row-resolve': fixture({ variant: 'outline', size: 'xs', iconStart: Check, children: 'Resolve', title: 'Resolve and hide until there is new activity' }),
  disabled: fixture({ variant: 'primary', size: '2xl', disabled: true, children: 'Send' }),
  dimmed: fixture({ variant: 'primary', size: '2xl', dimmed: true, children: 'Send' }),
  nav: scene(
    () => (
      <Stack gap="sm" width={260}>
        <Button variant="ghost" size="lg" radius="md-plus" iconStart={LayoutList} iconSize={15} fullWidth align="start" pressed>
          All topics
        </Button>
        <Button
          variant="ghost"
          size="lg"
          radius="md-plus"
          iconStart={Lightbulb}
          iconSize={15}
          fullWidth
          align="start"
          trailing={
            <Chip variant="strong" numeric>
              5
            </Chip>
          }
        >
          For you
        </Button>
        <Button variant="ghost" size="lg" radius="md-plus" iconStart={Sparkles} iconSize={15} fullWidth align="start" kbd="⌘J">
          Juno
        </Button>
      </Stack>
    ),
    { surface: 'subtle' },
  ),
  filters: scene(
    () => (
      <Row gap="sm">
        <Button variant="ghost" size="sm" radius="md-plus" text="ui" tone="muted" pressed strong>
          All
        </Button>
        <Button variant="ghost" size="sm" radius="md-plus" text="ui" tone="muted">
          Channels
        </Button>
        <Button variant="ghost" size="sm" radius="md-plus" text="ui" tone="muted">
          DMs
        </Button>
        <Button variant="ghost" size="sm" radius="md-plus" text="ui" tone="muted" aria-label="Show unread only">
          Unread
        </Button>
      </Row>
    ),
    { surface: 'subtle' },
  ),
  'all-sizes': scene(() => (
    <Row>
      <Button size="xs" variant="outline" iconStart={Check}>
        Resolve
      </Button>
      <Button size="sm">Group into topic</Button>
      <Button size="md">Open topic</Button>
      <Button size="lg" variant="outline" iconStart={CircleCheck}>
        Resolve
      </Button>
      <Button size="xl" variant="outline" iconStart={Bell}>
        Open notification settings
      </Button>
      <Button size="2xl" variant="primary">
        Send
      </Button>
    </Row>
  )),
  'all-variants': scene(() => (
    <Stack>
      <Row>
        <Button variant="primary" iconStart={ArrowUp}>
          Primary
        </Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="raised">Raised</Button>
      </Row>
      <Row>
        <Button variant="primary" disabled>
          Primary
        </Button>
        <Button variant="secondary" disabled>
          Secondary
        </Button>
        <Button variant="outline" disabled>
          Outline
        </Button>
        <Button variant="ghost" disabled>
          Ghost
        </Button>
        <Button variant="raised" disabled>
          Raised
        </Button>
      </Row>
      <Row>
        <Button variant="secondary" pressed>
          Pressed
        </Button>
        <Button variant="ghost" pressed>
          Pressed ghost
        </Button>
        <Button variant="ghost" tone="subtle">
          Subtle ghost
        </Button>
        <Button variant="ghost" tone="muted">
          Muted ghost
        </Button>
      </Row>
    </Stack>
  )),
})
