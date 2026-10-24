/**
 * The Search reader's controls in the topic header (SPEC 10a, inventory
 * 9a): Back to results at the start of the left island in the one-column
 * page, "2 of 5" with the arrows in an island of their own, and Open in new
 * tab beside Resolve. Under 480px Back is its icon, the count goes to the
 * arrows' tooltips, and Open in new tab, Resolve and Juno give way to ⋯.
 */
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretUp } from '@phosphor-icons/react/dist/icons/CaretUp'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { focusRing, Icon, IconButton } from '@juno/ui'

export interface TopicHeaderReader {
  /** The one-column page: Back to results leads the left island (Esc does the same). */
  readonly onBack?: () => void
  /** The matches in the topic, counted in its reading order: "2 of 5" with ⌘↑ and ⌘↓. Absent with one match or none. */
  readonly step?: { readonly index: number; readonly count: number; readonly onPrevious: () => void; readonly onNext: () => void }
  /** Open in new tab, beside Resolve. */
  readonly onOpenInNewTab: () => void
}

const NARROW = '@container (width < 480px)'

/** A right-island control that gives way to ⋯ under 480px. */
export function WideOnly({ children }: { readonly children: ReactNode }) {
  return children === null ? null : <span {...stylex.props(styles.wideOnly)}>{children}</span>
}

export function ReaderBack({ onBack }: { readonly onBack: () => void }) {
  return (
    <button type="button" aria-label="Back to results" title="Back to results (Esc)" onClick={onBack} {...stylex.props(styles.back, focusRing.outside)}>
      <span {...stylex.props(styles.backIcon)}>
        <Icon icon={CaretLeft} size={16} />
      </span>
      <span {...stylex.props(styles.backLabel)}>Back to results</span>
    </button>
  )
}

export function ReaderStep({ step }: { readonly step: NonNullable<TopicHeaderReader['step']> }) {
  const where = ` (${step.index} of ${step.count})`
  return (
    <>
      <span aria-live="polite" data-match-count="" {...stylex.props(styles.count, styles.wideOnly)}>{`${step.index} of ${step.count}`}</span>
      <IconButton icon={CaretUp} label={`Previous match${where}`} shortcut="⌘↑" size={28} iconSize={16} radius="full" variant="island" onClick={step.onPrevious} />
      <IconButton icon={CaretDown} label={`Next match${where}`} shortcut="⌘↓" size={28} iconSize={16} radius="full" variant="island" onClick={step.onNext} />
    </>
  )
}

export function ReaderOpen({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <WideOnly>
      <IconButton icon={ArrowSquareOut} label="Open in new tab" shortcut="⌘↵" size={28} iconSize={16} radius="full" variant="island" onClick={onOpen} />
    </WideOnly>
  )
}

const styles = stylex.create({
  wideOnly: {
    display: { default: 'flex', [NARROW]: 'none' },
  },
  // A 28px pill in the left island; under 480px its icon alone, named by its label.
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1'],
    flexShrink: 0,
    height: sizes['--control-28'],
    margin: 0,
    paddingInlineStart: spacing['--space-1-5'],
    paddingInlineEnd: { default: spacing['--space-2-5'], [NARROW]: spacing['--space-1-5'] },
    borderWidth: 0,
    borderRadius: radii['--radius-full'],
    backgroundColor: { default: 'transparent', ':hover': { default: null, '@media (hover: hover)': colors['--secondary-default'] } },
    color: colors['--foreground-default'],
    fontFamily: 'inherit',
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    whiteSpace: 'nowrap',
    cursor: 'default',
  },
  backIcon: {
    display: 'flex',
    color: colors['--foreground-subtle'],
  },
  backLabel: {
    display: { default: 'inline', [NARROW]: 'none' },
  },
  // "2 of 5", before its arrows.
  count: {
    alignItems: 'center',
    paddingInlineStart: spacing['--space-2'],
    paddingInlineEnd: spacing['--space-1'],
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    color: colors['--foreground-subtle'],
  },
})
