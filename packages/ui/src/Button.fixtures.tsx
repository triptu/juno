import { ArrowUp, Bell, Check, CircleCheck } from 'lucide-react'
import { Button } from './Button'
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
  hover: scene(
    () => (
      <Row>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="raised">Raised</Button>
        <Button variant="filter">Filter</Button>
      </Row>
    ),
    { hover: 'button' },
  ),
  'hover-secondary': fixture({ variant: 'secondary', size: '2xl', children: 'Discard' }, { hover: 'button' }),
  'hover-outline': fixture({ variant: 'outline', size: 'lg', iconStart: CircleCheck, children: 'Resolve' }, { hover: 'button' }),
  'hover-ghost': fixture({ variant: 'ghost', size: 'md', tone: 'subtle', children: 'Open topic' }, { hover: 'button' }),
  'hover-raised': fixture({ variant: 'raised', size: 'sm', kbd: '↵', children: 'Fix and send' }, { hover: 'button' }),
  'active-press': fixture({ variant: 'primary', size: '2xl', children: 'Send' }, { press: 'button' }),
  'active-press-secondary': fixture({ variant: 'secondary', size: '2xl', children: 'Discard' }, { press: 'button' }),
  'active-press-disabled': fixture({ variant: 'primary', size: '2xl', disabled: true, children: 'Send' }, { press: 'button' }),
  filters: scene(
    () => (
      <Row gap="sm">
        <Button variant="filter" pressed>
          All
        </Button>
        <Button variant="filter">Channels</Button>
        <Button variant="filter">DMs</Button>
        <Button variant="filter" aria-label="Show unread only">
          Unread
        </Button>
      </Row>
    ),
    { surface: 'subtle' },
  ),
  'filters-hover': scene(
    () => (
      <Row gap="sm">
        <Button variant="filter" pressed>
          All
        </Button>
        <Button variant="filter">Channels</Button>
      </Row>
    ),
    { surface: 'subtle', hover: 'button:nth-of-type(2)' },
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
        <Button variant="filter">Filter</Button>
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
        <Button variant="filter" disabled>
          Filter
        </Button>
      </Row>
      <Row>
        <Button variant="secondary" pressed>
          Pressed
        </Button>
        <Button variant="ghost" pressed>
          Pressed ghost
        </Button>
        <Button variant="filter" pressed>
          Pressed filter
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
