import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { Button } from './Button'
import { defineFixtures, scene } from './fixtures/define'
import { Icon } from './Icon'
import { ListRow } from './ListRow'
import { Page, PageHeader, Section } from './Page'
import { Surface } from './Surface'
import { Text } from './Text'
import { TextField } from './TextField'

export default defineFixtures(
  Page,
  {
    Pages: {
      notifications: scene(
        () => (
          <Page width="wide">
            <PageHeader
              title="Notifications"
              subtitle="Everything is in Juno whenever you open it. This only decides when your Mac interrupts you: right away, in a digest, or not at all."
            />
            <Section heading="Your rules" sub="Checked top to bottom. The first rule that matches wins.">
              <Surface kind="group">
                <ListRow leading={<Icon icon={Hash} size={16} />}>
                  <Text variant="body">
                    In <b>#incidents</b>
                  </Text>
                </ListRow>
                <ListRow leading={<Icon icon={Hash} size={16} />} divider={false}>
                  <Text variant="body">
                    In <b>#design-review</b>
                  </Text>
                </ListRow>
              </Surface>
            </Section>
            <Section heading="Everything else" sub="When no rule matches.">
              <Surface kind="group">
                <ListRow divider={false}>
                  <Text variant="body">Digest times</Text>
                </ListRow>
              </Surface>
            </Section>
          </Page>
        ),
        { width: 960, height: 560, padded: false },
      ),
      'new-message': scene(
        () => (
          <Page width="narrow" padding="form">
            <PageHeader title="New message" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button size="2xl" variant="secondary">
                Discard
              </Button>
              <Button size="2xl" variant="primary" dimmed>
                Send
              </Button>
            </div>
          </Page>
        ),
        { width: 760, height: 260, padded: false },
      ),
    },
    'Header widths': {
      'all-topics-header': scene(
        () => (
          <Page width="wide">
            <PageHeader
              title="All topics"
              size="compact"
              subtitle="Everything you're part of, including quiet, resolved and unsubscribed topics."
              trailing={<TextField size={34} leadingIcon={MagnifyingGlass} placeholder="Filter by title or message" width="search" label="Filter topics" />}
            />
          </Page>
        ),
        { width: 960, height: 200, padded: false },
      ),
      'all-topics-header-narrow': scene(
        () => (
          <Page width="wide">
            <PageHeader
              title="All topics"
              size="compact"
              subtitle="Everything you're part of, including quiet, resolved and unsubscribed topics."
              trailing={<TextField size={34} leadingIcon={MagnifyingGlass} placeholder="Filter by title or message" width="search" label="Filter topics" />}
            />
          </Page>
        ),
        { width: 480, height: 260, padded: false },
      ),
      'all-topics-header-wide': scene(
        () => (
          <Page width="wide">
            <PageHeader
              title="All topics"
              size="compact"
              subtitle="Everything you're part of, including quiet, resolved and unsubscribed topics."
              trailing={<TextField size={34} leadingIcon={MagnifyingGlass} placeholder="Filter by title or message" width="search" label="Filter topics" />}
            />
          </Page>
        ),
        { width: 1400, height: 200, padded: false },
      ),
    },
  },
  { padded: false },
)
