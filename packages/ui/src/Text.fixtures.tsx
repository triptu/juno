import { defineFixtures, fixture, scene } from './fixtures/define'
import { Stack } from './fixtures/layout'
import { Text, type TextVariant } from './Text'

const sample: ReadonlyArray<[TextVariant, string]> = [
  ['display', 'What do you need?'],
  ['pageTitle', 'Notifications'],
  ['pageTitleCompact', 'All topics'],
  ['emptyTitle', 'Nothing open'],
  ['topicTitle', 'Postgres 16 migration plan'],
  ['heading', 'Your rules'],
  ['rowTitle', 'Q4 roadmap cuts'],
  ['messageName', 'Leo Park'],
  ['body', 'Draft plan is in the doc. Short version: logical replication to the new cluster, cut over behind the read-only flag.'],
  ['bodySmall', 'Dev will run the staging dry run Thursday 2–4pm and Leo is pairing. Results go in this thread.'],
  ['ui', 'All topics'],
  ['preview', 'Maya: Draft is up. Cross-posting to #leadership once @Tushar has looked.'],
  ['pill', 'eng · Public channel'],
  ['buttonSmall', 'Group into topic'],
  ['meta', 'Yesterday'],
  ['tagSmall', 'Resolve'],
  ['tag', 'Main'],
  ['divider', '3 new'],
  ['tableHeader', 'Updated'],
  ['sectionLabel', 'Pinned'],
  ['kbd', '⌘K'],
  ['code', 'In infra/preview-envs, add a reaper that deletes preview environments'],
]

export default defineFixtures(Text, {
  Roles: {
    body: fixture({ variant: 'body', tone: 'default', selectable: true, children: 'We keep the old primary warm for 48h. Flip DNS back and replay from the WAL position we logged.' }),
    'page-title': fixture({ variant: 'pageTitle', tone: 'default', children: 'Notifications' }),
    'row-title-unread': fixture({ variant: 'rowTitle', tone: 'default', weight: 'semibold', truncate: true, children: 'Rina Sato · Staff backend' }),
    'preview-clamped': fixture(
      { variant: 'preview', tone: 'muted', clamp: 2, children: 'Elena: @Tushar she has a competing offer with a Friday deadline. Can you do a 30 min close call tomorrow? She was positive on systems design.' },
      { width: 240 },
    ),
    'meta-numeric': fixture({ variant: 'meta', tone: 'muted', numeric: true, children: '10:05' }),
  },
  Overview: {
    'all-roles': scene(() => (
      <Stack gap="sm" width={560}>
        {sample.map(([variant, copy]) => (
          <Text key={variant} variant={variant} tone="default" title={variant}>
            {copy}
          </Text>
        ))}
      </Stack>
    )),
    tones: scene(() => (
      <Stack gap="sm">
        <Text variant="ui" tone="default">
          Default: body text and titles
        </Text>
        <Text variant="ui" tone="subtle">
          Subtle: icons, secondary text, unread previews
        </Text>
        <Text variant="ui" tone="muted">
          Muted: meta, times, placeholders
        </Text>
        <Text variant="ui" tone="accent">
          Accent: the new divider
        </Text>
      </Stack>
    )),
  },
})
