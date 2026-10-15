import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { Button, Page, PageHeader, Section, Surface, type AccentName, type DensityName, type ThemePreference } from '@juno/ui'
import { AppearanceSettings } from './AppearanceSettings'
import { PeekKeySetting, type PeekKeyName } from './PeekKeySetting'

export interface PreferencesPageProps {
  readonly theme: ThemePreference
  readonly accent: AccentName
  readonly density: DensityName
  readonly onThemeChange: (theme: ThemePreference) => void
  readonly onAccentChange: (accent: AccentName) => void
  readonly onDensityChange: (density: DensityName) => void
  readonly peekKey: PeekKeyName
  readonly onPeekKeyChange: (key: PeekKeyName) => void
  readonly onOpenNotifications: () => void
}

/**
 * Preferences (SPEC 14, inventory 14): the Appearance group, the peek key,
 * and the way to the notification settings. Anything Juno can do from the owner's words
 * belongs in the chat, not here.
 */
export function PreferencesPage({ theme, accent, density, onThemeChange, onAccentChange, onDensityChange, peekKey, onPeekKeyChange, onOpenNotifications }: PreferencesPageProps) {
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
      <Section heading="Notifications" sub="Your hours, and what Juno lets through.">
        <div>
          <Button variant="outline" size="md" iconStart={Bell} onClick={onOpenNotifications}>
            Open notification settings
          </Button>
        </div>
      </Section>
    </Page>
  )
}
