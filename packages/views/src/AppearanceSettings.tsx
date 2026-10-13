import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { accentLabels, accentNames, Segmented, Swatch, Text, type AccentName, type ThemeName } from '@juno/ui'

export interface AppearanceSettingsProps {
  readonly theme: ThemeName
  readonly accent: AccentName
  readonly onThemeChange: (theme: ThemeName) => void
  readonly onAccentChange: (accent: AccentName) => void
  /** `row` puts the label beside the control (Preferences); `stack` puts it above (a narrow popover). Default `row`. */
  readonly layout?: 'row' | 'stack'
}

const themeOptions: ReadonlyArray<{ readonly value: ThemeName; readonly label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/**
 * The appearance block of Preferences: the theme as a segmented control and
 * the accent as a row of swatches. Following the OS theme is not offered
 * yet; main would have to resolve it before the window paints.
 */
export function AppearanceSettings({ theme, accent, onThemeChange, onAccentChange, layout = 'row' }: AppearanceSettingsProps) {
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
    </section>
  )
}

const styles = stylex.create({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3-5'],
  },
  row: {
    display: 'flex',
    alignItems: 'center',
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
    width: spacing['--space-18'],
    flexShrink: 0,
  },
  labelStacked: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing['--space-2'],
    width: 'auto',
  },
  swatches: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
})
