import { useFixtureAppearance, type ThemePreference } from '@juno/ui'
import { AppearanceSettings, type AppearanceSettingsProps } from '../AppearanceSettings'
import { SettingsAppearance, type SettingsAppearanceProps } from '../SettingsSections'

/** A state may pin the theme (System, say); the accent always follows the gallery. */
type Bound<P> = Omit<P, 'theme' | 'accent'> & { readonly theme?: ThemePreference }

/**
 * The appearance controls with the gallery's own theme and accent selected,
 * so the checked segment and swatch match the colours the frame is drawn in.
 */
export function GalleryAppearanceSettings({ theme, ...props }: Bound<AppearanceSettingsProps>) {
  const current = useFixtureAppearance()
  return <AppearanceSettings theme={theme ?? current.theme} accent={current.accent} {...props} />
}

export function GallerySettingsAppearance({ theme, ...props }: Bound<SettingsAppearanceProps>) {
  const current = useFixtureAppearance()
  return <SettingsAppearance theme={theme ?? current.theme} accent={current.accent} {...props} />
}
