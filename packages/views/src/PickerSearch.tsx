import * as stylex from '@stylexjs/stylex'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import type { KeyboardEvent } from 'react'
import { colors, spacing, text } from '@juno/tokens/tokens.stylex'
import { Icon, Text } from '@juno/ui'

export interface PickerSearchProps {
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly placeholder: string
  /** Drives the list under it (`useOptionListKeys`). */
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  readonly activeId: string | undefined
}

/**
 * The search field at the top of a searchable list in a popover: New
 * chat's pickers and the header's topic switcher. It takes focus when the
 * list opens and keeps it while the arrows move the highlight.
 */
export function PickerSearch({ query, onQuery, placeholder, onKeyDown, activeId }: PickerSearchProps) {
  return (
    <label {...stylex.props(styles.search)}>
      <span {...stylex.props(styles.searchIcon)}>
        <Icon icon={MagnifyingGlass} size={14} />
      </span>
      <input
        autoFocus
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-activedescendant={activeId}
        onChange={(event) => onQuery(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        {...stylex.props(styles.searchInput)}
      />
    </label>
  )
}

/** The line a searchable list shows when nothing matches. */
export function PickerNoMatch() {
  return (
    <Text variant="ui" tone="muted" as="div" sx={styles.noMatch}>
      No match.
    </Text>
  )
}

const styles = stylex.create({
  search: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    cursor: 'text',
  },
  searchIcon: {
    display: 'inline-flex',
    color: colors['--foreground-muted'],
  },
  searchInput: {
    flexGrow: 1,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors['--foreground-default'],
    fontFamily: text['--text-ui-family'],
    fontSize: text['--text-ui-size'],
    outline: 'none',
    '::placeholder': { color: colors['--foreground-muted'], opacity: 1 },
  },
  noMatch: {
    paddingBlock: spacing['--space-3-5'],
    paddingInline: spacing['--space-2-5'],
  },
})
