import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { Button, Page, PageHeader, Section, Surface, type AccentName, type DensityName, type ThemePreference } from '@juno/ui'
import { AppearanceSettings } from './AppearanceSettings'

export interface PreferencesPageProps {
  readonly theme: ThemePreference
  readonly accent: AccentName
  readonly density: DensityName
  readonly onThemeChange: (theme: ThemePreference) => void
  readonly onAccentChange: (accent: AccentName) => void
  readonly onDensityChange: (density: DensityName) => void
  readonly onOpenNotifications: () => void
}

/**
 * Preferences (SPEC 14, inventory 14): the Appearance group, and the way to
 * the notification settings. Anything Juno can do from the owner's words
 * belongs in the chat, not here.
 */
export function PreferencesPage({ theme, accent, density, onThemeChange, onAccentChange, onDensityChange, onOpenNotifications }: PreferencesPageProps) {
  return (
    <Page width="settings">
      <PageHeader title="Preferences" />
      <Section heading="Appearance">
        <Surface kind="group" padding="md">
          <AppearanceSettings theme={theme} accent={accent} density={density} onThemeChange={onThemeChange} onAccentChange={onAccentChange} onDensityChange={onDensityChange} />
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
