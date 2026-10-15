import * as stylex from '@stylexjs/stylex'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
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
