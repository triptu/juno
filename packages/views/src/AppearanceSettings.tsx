import type { TopicTitleLines } from '@juno/contract'
import * as stylex from '@stylexjs/stylex'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { accentLabels, accentNames, Segmented, Swatch, Text, type AccentName, type DensityName, type ThemePreference } from '@juno/ui'

export interface AppearanceSettingsProps {
  readonly theme: ThemePreference
  readonly accent: AccentName
  readonly onThemeChange: (theme: ThemePreference) => void
  readonly onAccentChange: (accent: AccentName) => void
  /** With both, the Topic titles row. */
  readonly topicTitleLines?: TopicTitleLines
  readonly onTopicTitleLinesChange?: (lines: TopicTitleLines) => void
  /** With both, a Density row: Comfortable or Compact. */
  readonly density?: DensityName
  readonly onDensityChange?: (density: DensityName) => void
  /**
   * `row` puts the label beside the control (Settings); `stack` puts it above
   * (a narrow popover); `bar` is the theme and accent alone in one centred
   * row with no visible labels (the sign-in page's footer). Default `row`.
   */
  readonly layout?: 'row' | 'stack' | 'bar'
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
 * (System follows macOS), the accent as swatches, density, and the topic title line limit.
 */
export function AppearanceSettings({ theme, accent, onThemeChange, onAccentChange, density, onDensityChange, topicTitleLines, onTopicTitleLinesChange, layout = 'row' }: AppearanceSettingsProps) {
  if (layout === 'bar') {
    // The controls keep their names for assistive tech; only the visible labels go.
    return (
      <section {...stylex.props(styles.bar)} aria-label="Appearance">
        <Segmented options={themeOptions} value={theme} onChange={onThemeChange} label="Theme" />
        <span {...stylex.props(styles.barRule)} aria-hidden />
        <div role="group" aria-label="Accent" {...stylex.props(styles.swatches)}>
          {accentNames.map((name) => (
            <Swatch key={name} accent={name} label={accentLabels[name]} selected={name === accent} onClick={() => onAccentChange(name)} />
          ))}
        </div>
      </section>
    )
  }
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
      {topicTitleLines === undefined || onTopicTitleLinesChange === undefined ? null : (
        <div {...stylex.props(styles.row, stacked && styles.rowStacked)}>
          <Text variant="ui" tone="default" weight="medium">Topic titles</Text>
          <Segmented label="Topic titles" value={topicTitleLines} onChange={onTopicTitleLinesChange}
            options={[{ value: 'one', label: 'One line' }, { value: 'two', label: 'Two lines' }]} />
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
    // On a narrow page the control goes under the label, at the start.
    flexWrap: 'wrap',
    columnGap: spacing['--space-6'],
    rowGap: spacing['--space-2'],
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
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing['--space-5'],
    rowGap: spacing['--space-3'],
  },
  barRule: {
    width: '1px', // tokens-allow: a hairline divider
    height: spacing['--space-4'],
    backgroundColor: colors['--border-strongest'],
  },
  // On a narrow page the swatches wrap rather than run past the card.
  swatches: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
})
