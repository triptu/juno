import { Sparkles } from 'lucide-react'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { Icon } from './Icon'
import { Surface } from './Surface'
import { Text } from './Text'

function CatchUp() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 480 }}>
      <Row gap="sm">
        <Icon icon={Sparkles} size={13} />
        <Text role="meta" weight="medium" tone="muted">
          Catch up
        </Text>
      </Row>
      <Text role="bodySmall" tone="subtle">
        Dev will run the staging dry run Thursday 2–4pm and Leo is pairing. Results go in this thread. Nothing needed from you.
      </Text>
    </div>
  )
}

export default defineFixtures(Surface, {
  card: fixture({ kind: 'card', padding: 'md', children: <CatchUp /> }),
  popover: fixture({ kind: 'popover', children: <div style={{ width: 224, height: 120 }} /> }),
  toolbar: fixture({ kind: 'toolbar', padding: 'xs', children: <div style={{ width: 180, height: 28 }} /> }),
  group: fixture({ kind: 'group', children: <div style={{ width: 480, height: 96 }} /> }),
  inset: fixture({ kind: 'inset', children: <Text role="code">add a dry-run flag and tests for the selection logic</Text> }),
  toast: fixture({ kind: 'toast', padding: 'md', children: <Text role="ui">Resolved · Postgres 16 migration plan</Text> }),
  'all-kinds': scene(() => (
    <Row gap="lg">
      <Surface kind="card">
        <Text role="ui">card</Text>
      </Surface>
      <Surface kind="popover" padding="md">
        <Text role="ui">popover</Text>
      </Surface>
      <Surface kind="toolbar" padding="sm">
        <Text role="ui">toolbar</Text>
      </Surface>
      <Surface kind="group" padding="md">
        <Text role="ui">group</Text>
      </Surface>
      <Surface kind="inset">
        <Text role="ui">inset</Text>
      </Surface>
      <Surface kind="toast" padding="md">
        <Text role="ui">toast</Text>
      </Surface>
    </Row>
  )),
})
