import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
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

/** The peek key preference (inventory, Preferences): one row, "Hold to peek" over a segmented control. */
export function PeekKeySetting({ value, onChange }: PeekKeySettingProps) {
  return (
    <div {...stylex.props(styles.row)}>
      <Text variant="ui" tone="default" weight="medium">
        Hold to peek
      </Text>
      <Segmented options={options} value={value} onChange={onChange} label="Hold to peek" />
    </div>
  )
}

const styles = stylex.create({
  row: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
  },
})
