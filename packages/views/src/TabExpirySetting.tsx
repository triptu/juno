import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Segmented, Text } from '@juno/ui'

/** How long a tab can go unseen before it closes by itself (SPEC 6). */
export type TabExpiryName = 'never' | '1d' | '3d' | '7d'

export interface TabExpirySettingProps {
  readonly value: TabExpiryName
  readonly onChange: (expiry: TabExpiryName) => void
}

const expiryOptions: ReadonlyArray<{ readonly value: TabExpiryName; readonly label: string }> = [
  { value: 'never', label: 'Never' },
  { value: '1d', label: '1 day' },
  { value: '3d', label: '3 days' },
  { value: '7d', label: '7 days' },
]

/** "Close tabs not viewed in" (Settings › General, Tabs). */
export function TabExpirySetting({ value, onChange }: TabExpirySettingProps) {
  return (
    <div {...stylex.props(styles.row)}>
      <Text variant="ui" tone="default" weight="medium" sx={styles.label}>
        Close tabs not viewed in
      </Text>
      <Segmented options={expiryOptions} value={value} onChange={onChange} label="Close tabs not viewed in" />
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
