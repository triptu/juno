import type { ReactNode } from 'react'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { Button, Page, PageHeader, Section, Surface, Text, type AccentName, type DensityName, type ThemePreference } from '@juno/ui'
import type { IgnoredChannel } from '@juno/contract'
import { AppearanceSettings } from './AppearanceSettings'
import { IgnoredChannels } from './IgnoredChannels'
import { PeekKeySetting, type PeekKeyName } from './PeekKeySetting'

export interface PreferencesPageProps {
  readonly about?: ReactNode
  readonly theme: ThemePreference
  readonly accent: AccentName
  readonly density: DensityName
  readonly onThemeChange: (theme: ThemePreference) => void
  readonly onAccentChange: (accent: AccentName) => void
  readonly onDensityChange: (density: DensityName) => void
  readonly peekKey: PeekKeyName
  readonly onPeekKeyChange: (key: PeekKeyName) => void
  /** The ignore list; undefined until it arrives. */
  readonly ignored: ReadonlyArray<IgnoredChannel> | undefined
  readonly onStopIgnoring: (channel: IgnoredChannel) => void
  readonly onOpenNotifications: () => void
}

/**
 * Preferences (SPEC 14, inventory 14): the Appearance group, the peek key,
 * the ignore list, and the way to the notification settings. Anything Juno can do from the owner's words
 * belongs in the chat, not here.
 */
export function PreferencesPage({ about, theme, accent, density, onThemeChange, onAccentChange, onDensityChange, peekKey, onPeekKeyChange, ignored, onStopIgnoring, onOpenNotifications }: PreferencesPageProps) {
  return (
    <Page width="settings">
      <PageHeader title="Preferences" />
      <Section heading="Appearance">
        <Surface kind="group" padding="md">
          <AppearanceSettings theme={theme} accent={accent} density={density} onThemeChange={onThemeChange} onAccentChange={onAccentChange} onDensityChange={onDensityChange} />
        </Surface>
      </Section>
      <Section heading="Peek" sub="Hold the key over a topic in the sidebar to read it without marking it read.">
        <Surface kind="group" padding="md">
          <PeekKeySetting value={peekKey} onChange={onPeekKeyChange} />
        </Surface>
      </Section>
      <Section heading="Ignored channels" sub="Hidden from your topics, search and All topics, and they never notify you. Nothing changes in Slack.">
        <Surface kind="group" padding="md">
          <IgnoredChannels channels={ignored} onStopIgnoring={onStopIgnoring} />
        </Surface>
        <Text variant="meta" tone="muted" as="p">
          Right-click a channel to ignore it.
        </Text>
      </Section>
      <Section heading="Notifications" sub="Your hours, and what Juno lets through.">
        <div>
          <Button variant="outline" size="md" iconStart={Bell} onClick={onOpenNotifications}>
            Open notification settings
          </Button>
        </div>
      </Section>
      {about === undefined ? null : <Section heading="About"><Surface kind="group" padding="md">{about}</Surface></Section>}
    </Page>
  )
}
