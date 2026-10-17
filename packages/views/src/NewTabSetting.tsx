import * as stylex from '@stylexjs/stylex'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Segmented, Text } from '@juno/ui'

/** What a new tab opens: a New chat, the default, or Home. */
export type NewTabPageName = 'newChat' | 'home'

export interface NewTabSettingProps {
  readonly value: NewTabPageName
  readonly onChange: (page: NewTabPageName) => void
}

const options: ReadonlyArray<{ readonly value: NewTabPageName; readonly label: string }> = [
  { value: 'newChat', label: 'New chat' },
  { value: 'home', label: 'Home' },
]

/**
 * The new tab preference (Settings › General, SPEC 6): one row laid out as
 * Appearance's, "New tabs open" beside a segmented control. It covers "+",
 * ⌘T and the tab that replaces the last one closed.
 */
export function NewTabSetting({ value, onChange }: NewTabSettingProps) {
  return (
    <div {...stylex.props(styles.row)}>
      <Text variant="ui" tone="default" weight="medium" sx={styles.label}>
        New tabs open
      </Text>
      <Segmented options={options} value={value} onChange={onChange} label="New tabs open" />
    </div>
  )
}

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

/** "Close tabs not viewed in", the row under "New tabs open". */
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
