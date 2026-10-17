import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Segmented, Text } from '@juno/ui'

type WindowChoice = '1' | '3' | '7' | '14'

export interface QuietWindowSettingProps {
  readonly value: number
  readonly onChange: (days: number) => void
}

const options: ReadonlyArray<{ readonly value: WindowChoice; readonly label: string }> = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
]

export function QuietWindowSetting({ value, onChange }: QuietWindowSettingProps) {
  return (
    <div {...stylex.props(styles.row)}>
      <Text variant="ui" tone="default" weight="medium" sx={styles.label}>
        Show topics active in the last
      </Text>
      <Segmented options={options} value={String(value)} onChange={(days) => onChange(Number(days))} label="Show topics active in the last" />
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
