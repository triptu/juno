import { Button, defineFixtures, fixture, Text } from '@juno/ui'
import { AccountMenu } from './AccountMenu'
import { AppearanceSettings } from './AppearanceSettings'

const noop = () => {}

const base = { name: 'Tushar', initials: 'T', hue: 'cyan', workspace: 'juno-fake.slack.com' } as const

export default defineFixtures(
  AccountMenu,
  {
    Sections: {
      appearance: fixture({
        ...base,
        sections: [{ title: 'Appearance', content: <AppearanceSettings theme="light" accent="coral" layout="stack" onThemeChange={noop} onAccentChange={noop} /> }],
      }),
      'with-diagnostics': fixture({
        ...base,
        sections: [
          { title: 'Appearance', content: <AppearanceSettings theme="light" accent="coral" layout="stack" onThemeChange={noop} onAccentChange={noop} /> },
          {
            title: 'Session',
            content: (
              <>
                <Text variant="meta" tone="muted" as="p">
                  Signed in to Juno Fake as tushar
                </Text>
                <Button variant="ghost" size="sm" tone="muted">
                  Sign out
                </Button>
              </>
            ),
          },
        ],
      }),
    },
  },
  { width: 300, surface: 'surface' },
)
