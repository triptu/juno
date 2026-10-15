import * as stylex from '@stylexjs/stylex'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Segmented, Text } from '@juno/ui'

/** ⌥ Option, the default, or Space. Fn is not offered: macOS does not report it to apps reliably. */
export type PeekKeyName = 'option' | 'space'

export interface PeekKeySettingProps {
  readonly value: PeekKeyName
  readonly onChange: (key: PeekKeyName) => void
}

const options: ReadonlyArray<{ readonly value: PeekKeyName; readonly label: string }> = [
  { value: 'option', label: '⌥ Option' },
  { value: 'space', label: 'Space' },
]

/** The peek key preference (inventory 14, Settings › General): one row laid out as Appearance's, "Hold to peek" beside a segmented control. */
export function PeekKeySetting({ value, onChange }: PeekKeySettingProps) {
  return (
    <div {...stylex.props(styles.row)}>
      <Text variant="ui" tone="default" weight="medium" sx={styles.label}>
        Hold to peek
      </Text>
      <Segmented options={options} value={value} onChange={onChange} label="Hold to peek" />
    </div>
  )
}

const styles = stylex.create({
  // The same row as Appearance's Theme and Density, so the controls share one edge.
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-6'],
    minHeight: spacing['--space-8'],
  },
  label: {
    width: layout['--settings-label-width'],
    flexShrink: 0,
  },
})
