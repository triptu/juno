/**
 * The Search tab's empty field (SPEC 10a, "Empty field"): the last 10
 * searches with their chips (× on the hovered row removes one), a line on
 * the operators, and a line pointing to ⌘K for quick navigation, whose key
 * cap opens it. Never over results.
 */
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/icons/ClockCounterClockwise'
import { X } from '@phosphor-icons/react/dist/icons/X'
import * as stylex from '@stylexjs/stylex'
import { colors, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, IconButton, Kbd } from '@juno/ui'
import { chipOperator, type SearchChipView } from './model'

export interface RecentSearchView {
  readonly chips: ReadonlyArray<SearchChipView>
  readonly text: string
}

export interface SearchRecentProps {
  readonly recent: ReadonlyArray<RecentSearchView>
  readonly onRecent: (index: number) => void
  readonly onForgetRecent: (index: number) => void
  readonly onPalette: () => void
}

export function SearchRecent({ recent, onRecent, onForgetRecent, onPalette }: SearchRecentProps) {
  return (
    <>
      {recent.length === 0 ? null : (
        <>
          <p {...stylex.props(styles.label)}>Recent searches</p>
          <ul aria-label="Recent searches" {...stylex.props(styles.list)}>
            {recent.map((search, index) => (
              <li key={index} {...stylex.props(styles.item, stylex.defaultMarker())}>
                <button type="button" data-recent-search="" onClick={() => onRecent(index)} {...stylex.props(styles.row, focusRing.inset)}>
                  <span {...stylex.props(styles.clock)}>
                    <Icon icon={ClockCounterClockwise} size={14} />
                  </span>
                  <span data-sensitive="" {...stylex.props(styles.query)}>
                    {search.chips.map((chip) => (
                      <span key={chip.key} {...stylex.props(styles.chip)}>
                        {chipOperator[chip.op] === undefined ? null : <span {...stylex.props(styles.operator)}>{`${chip.negated === true ? '-' : ''}${chipOperator[chip.op]}`}</span>}
                        {chip.label}
                      </span>
                    ))}
                    {search.text === '' ? null : <span {...stylex.props(styles.words)}>{search.text}</span>}
                  </span>
                </button>
                <span {...stylex.props(styles.forget)}>
                  <IconButton icon={X} label="Remove from recent searches" size={22} iconSize={12} onClick={() => onForgetRecent(index)} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p {...stylex.props(styles.hint)}>Narrow with from:, in:, has: or a date.</p>
      <p data-palette-hint="" {...stylex.props(styles.hint, styles.palette)}>
        To jump to a conversation, topic or command, press
        <button type="button" aria-label="Open ⌘K" onClick={onPalette} {...stylex.props(styles.key, focusRing.outside)}>
          <Kbd look="key">⌘K</Kbd>
        </button>
        .
      </p>
    </>
  )
}

const styles = stylex.create({
  label: {
    margin: 0,
    paddingTop: spacing['--space-2-5'],
    paddingBottom: spacing['--space-1'],
    paddingInline: spacing['--space-2-5'],
    fontSize: text['--text-section-label-size'],
    fontWeight: weights['--weight-medium'],
    color: colors['--foreground-muted'],
  },
  list: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  item: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    borderRadius: radii['--radius-lg'],
    backgroundColor: { default: 'transparent', ':hover': { default: null, '@media (hover: hover)': colors['--surface-hover'] } },
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    flexGrow: 1,
    minWidth: 0,
    height: sizes['--control-32'],
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: spacing['--space-2-5'],
    // Room for × at the end, so a long search never runs under it.
    paddingInlineEnd: sizes['--control-28'],
    borderWidth: 0,
    borderRadius: radii['--radius-lg'],
    backgroundColor: 'transparent',
    color: colors['--foreground-default'],
    fontFamily: 'inherit',
    fontSize: text['--text-ui-size'],
    textAlign: 'start',
    cursor: 'default',
  },
  clock: {
    display: 'flex',
    flexShrink: 0,
    color: colors['--foreground-muted'],
  },
  query: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  words: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
    height: sizes['--control-20'],
    paddingInline: spacing['--space-1-5'],
    borderRadius: radii['--radius-sm'],
    backgroundColor: colors['--secondary-default'],
    fontSize: text['--text-tag-small-size'],
    fontWeight: weights['--weight-medium'],
  },
  operator: {
    color: colors['--foreground-muted-on-fill'],
    fontWeight: weights['--weight-regular'],
  },
  // × shows on the hovered row, or while it has focus.
  forget: {
    position: 'absolute',
    insetInlineEnd: spacing['--space-1-5'],
    display: 'flex',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      ':focus-within': 1,
    },
  },
  hint: {
    margin: 0,
    paddingInline: spacing['--space-2-5'],
    paddingTop: spacing['--space-3'],
    fontSize: text['--text-meta-size'],
    color: colors['--foreground-muted'],
  },
  palette: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: spacing['--space-1'],
    paddingTop: spacing['--space-1'],
  },
  key: {
    display: 'inline-flex',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-xs'],
    backgroundColor: 'transparent',
    cursor: 'default',
  },
})
