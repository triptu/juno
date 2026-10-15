import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { accentLabels, accentNames, Segmented, Swatch, Text, type AccentName, type DensityName, type ThemePreference } from '@juno/ui'

export interface AppearanceSettingsProps {
  readonly theme: ThemePreference
  readonly accent: AccentName
  readonly onThemeChange: (theme: ThemePreference) => void
  readonly onAccentChange: (accent: AccentName) => void
  /** With both, a Density row: Comfortable or Compact. */
  readonly density?: DensityName
  readonly onDensityChange?: (density: DensityName) => void
  /** `row` puts the label beside the control (Settings); `stack` puts it above (a narrow popover). Default `row`. */
  readonly layout?: 'row' | 'stack'
}

const themeOptions: ReadonlyArray<{ readonly value: ThemePreference; readonly label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const densityOptions: ReadonlyArray<{ readonly value: DensityName; readonly label: string }> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

/**
 * The Appearance group of Settings (SPEC 14, inventory 14): the theme
 * (System follows macOS), the accent as a row of swatches, and the density.
 */
export function AppearanceSettings({ theme, accent, onThemeChange, onAccentChange, density, onDensityChange, layout = 'row' }: AppearanceSettingsProps) {
  const stacked = layout === 'stack'
  return (
    <section {...stylex.props(styles.section)} aria-label="Appearance">
      <div {...stylex.props(styles.row, stacked && styles.rowStacked)}>
        <div {...stylex.props(styles.label, stacked && styles.labelStacked)}>
          <Text variant="ui" tone="default" weight="medium" id="appearance-theme">
            Theme
          </Text>
        </div>
        <Segmented options={themeOptions} value={theme} onChange={onThemeChange} label="Theme" />
      </div>
      <div {...stylex.props(styles.row, stacked && styles.rowStacked)}>
        <div {...stylex.props(styles.label, stacked && styles.labelStacked)}>
          <Text variant="ui" tone="default" weight="medium" id="appearance-accent">
            Accent
          </Text>
          <Text variant="meta" tone="muted" as="p">
            {accentLabels[accent]}
          </Text>
        </div>
        <div role="group" aria-labelledby="appearance-accent" {...stylex.props(styles.swatches)}>
          {accentNames.map((name) => (
            <Swatch key={name} accent={name} label={accentLabels[name]} selected={name === accent} onClick={() => onAccentChange(name)} />
          ))}
        </div>
      </div>
      {density === undefined || onDensityChange === undefined ? null : (
        <div {...stylex.props(styles.row, stacked && styles.rowStacked)}>
          <div {...stylex.props(styles.label, stacked && styles.labelStacked)}>
            <Text variant="ui" tone="default" weight="medium">
              Density
            </Text>
          </div>
          <Segmented options={densityOptions} value={density} onChange={onDensityChange} label="Density" />
        </div>
      )}
    </section>
  )
}

const styles = stylex.create({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3-5'],
  },
  // The label at the start, the control at the trailing edge, as System Settings.
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-6'],
    minHeight: spacing['--space-8'],
  },
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
  },
  labelStacked: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing['--space-2'],
  },
  swatches: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
})
