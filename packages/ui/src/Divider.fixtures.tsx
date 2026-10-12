import { Divider, LabelledRule } from './Divider'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Stack } from './fixtures/layout'

export default defineFixtures(
  Divider,
  {
    default: fixture({}),
    subtle: fixture({ tone: 'subtle' }),
    'labelled-new': scene(() => (
      <Stack width={480}>
        <LabelledRule label="3 new" />
      </Stack>
    )),
    'labelled-muted': scene(() => (
      <Stack width={480}>
        <LabelledRule label="Earlier" tone="muted" />
      </Stack>
    )),
  },
  { width: 480 },
)
