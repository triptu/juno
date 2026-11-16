import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Segmented, systemWords, Text } from '@juno/ui'

/** ⌥ Option, the default, or Space. Fn is not offered: macOS does not report it to apps reliably. */
export type PeekKeyName = 'option' | 'space'

export interface PeekKeySettingProps {
  readonly value: PeekKeyName
  readonly onChange: (key: PeekKeyName) => void
}

const options: ReadonlyArray<{ readonly value: PeekKeyName; readonly label: string }> = [
  { value: 'option', label: systemWords.optionKey },
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
  // The same row as Appearance's Theme and Density: the label at the start, the control at the trailing edge, as System Settings.
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
  label: {
    flexShrink: 0,
  },
})
