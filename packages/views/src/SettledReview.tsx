import * as stylex from '@stylexjs/stylex'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { useId, useState } from 'react'
import type { HomeTopic } from '@juno/contract'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, IconButton, Kbd, ringRoom, Surface, Text } from '@juno/ui'
import { settledCopy, type SettledStatus } from './settled'
import { SettledList, type SettledRowProps } from './SettledList'

export interface ResolveExplainerProps {
  readonly onSettings: () => void
}

/** What Resolve does, in four lines, and the way to Settings › Tidy up. */
export function ResolveExplainer({ onSettings }: ResolveExplainerProps) {
  return (
    <Surface kind="inset" padding="md" sx={styles.explainer} data-settled-explainer="">
      <Text variant="ui" weight="medium">
        {settledCopy.about}
      </Text>
      <ul {...stylex.props(styles.points)}>
        {settledCopy.explain.map((line) => (
          <li key={line} {...stylex.props(styles.point)}>
            <Text variant="bodySmall" tone="subtle" as="span">
              {line}
            </Text>
          </li>
        ))}
      </ul>
      <span>
        <Button variant="secondary" size="sm" onClick={onSettings} data-settled-settings="">
          {settledCopy.settings}
        </Button>
      </span>
    </Surface>
  )
}

export interface SettledReviewProps {
  readonly topics: ReadonlyArray<HomeTopic>
  readonly statuses: ReadonlyMap<string, SettledStatus>
  readonly now: number
  /** Start with What Resolve does open; the gallery shows it. */
  readonly initialAbout?: boolean
  readonly initialActive?: string
  readonly autoFocus?: boolean
  readonly onOpen: SettledRowProps['onOpen']
  readonly onResolve: SettledRowProps['onResolve']
  readonly onKeep: SettledRowProps['onKeep']
  readonly onUndo: SettledRowProps['onUndo']
  /** Resolves every proposal still open. */
  readonly onResolveAll: () => void
  readonly onSettings: () => void
  readonly onClose: () => void
}

/**
 * Tidy up's review (SPEC 12): a sheet with every topic that looks settled,
 * why, and Resolve or Keep open for each; Resolve all and Done at the
 * bottom, as a Mac sheet has its buttons. The info button says what
 * Resolve does and leads to Settings › Tidy up. A panel for `SheetLayer`,
 * which closes it on Esc and keeps Tab inside.
 */
export function SettledReview({ topics, statuses, now, initialAbout = false, initialActive, autoFocus = false, onOpen, onResolve, onKeep, onUndo, onResolveAll, onSettings, onClose }: SettledReviewProps) {
  const titleId = useId()
  const aboutId = useId()
  const [about, setAbout] = useState(initialAbout)
  const left = topics.filter((topic) => (statuses.get(topic.id) ?? 'open') === 'open').length
  return (
    <Surface kind="popover" as="section" role="dialog" aria-labelledby={titleId} aria-modal padding="none" sx={styles.sheet} data-sheet="settled">
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.titleLine)}>
          <Text variant="heading" as="h2" id={titleId} truncate>
            {settledCopy.title(topics.length)}
          </Text>
          <IconButton icon={Info} label={settledCopy.about} size={28} pressed={about} expanded={about} aria-controls={aboutId} onClick={() => setAbout(!about)} data-settled-about="" />
        </span>
        <Text variant="bodySmall" tone="subtle" as="p" sx={styles.lead}>
          {settledCopy.lead}
        </Text>
        <div id={aboutId}>{about ? <ResolveExplainer onSettings={onSettings} /> : null}</div>
      </div>
      <div {...stylex.props(styles.scroll, ringRoom.inline)}>
        <SettledList topics={topics} statuses={statuses} now={now} label={settledCopy.title(topics.length)} initialActive={initialActive} autoFocus={autoFocus} onOpen={onOpen} onResolve={onResolve} onKeep={onKeep} onUndo={onUndo} />
      </div>
      <div {...stylex.props(styles.foot)}>
        <span {...stylex.props(styles.keys)} aria-hidden>
          <Kbd>↑↓</Kbd>
          <Text variant="meta" tone="muted">Move</Text>
          <Kbd>↵</Kbd>
          <Text variant="meta" tone="muted">Open</Text>
          <Kbd>R</Kbd>
          <Text variant="meta" tone="muted">Resolve</Text>
          <Kbd>K</Kbd>
          <Text variant="meta" tone="muted">Keep open</Text>
        </span>
        <span {...stylex.props(styles.buttons)}>
          <Button variant="secondary" size="md" onClick={onClose} data-settled-close="">
            {settledCopy.done}
          </Button>
          <Button variant="primary" size="md" dimmed={left === 0} onClick={left === 0 ? undefined : onResolveAll} data-settled-resolve-all="">
            {settledCopy.resolveAll}
          </Button>
        </span>
      </div>
    </Surface>
  )
}


// The same width as SettledList's: under it the key hints go.
const SETTLED_NARROW = '@container settled (width < 460px)'

const styles = stylex.create({
  sheet: {
    containerType: 'inline-size',
    containerName: 'settled',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: layout['--palette-width'],
    // The layer pads the window by 24 on each side; the list scrolls inside what is left.
    maxHeight: '100%',
    minHeight: 0,
    boxSizing: 'border-box',
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    paddingTop: spacing['--space-5'],
    paddingInline: spacing['--space-5'],
    paddingBottom: spacing['--space-3'],
  },
  titleLine: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    minWidth: 0,
  },
  lead: {
    margin: 0,
  },
  explainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    marginTop: spacing['--space-2'],
  },
  points: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
    margin: 0,
    paddingInlineStart: spacing['--space-4'],
  },
  point: {
    color: colors['--foreground-muted'],
  },
  scroll: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    paddingInline: spacing['--space-2'],
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing['--space-3'],
    paddingBlock: spacing['--space-3'],
    paddingInline: spacing['--space-5'],
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors['--border-subtle'],
  },
  keys: {
    display: { default: 'inline-flex', [SETTLED_NARROW]: 'none' },
    alignItems: 'center',
    gap: spacing['--space-1'],
    columnGap: spacing['--space-1-5'],
  },
  buttons: {
    display: 'inline-flex',
    gap: spacing['--space-2'],
    marginInlineStart: 'auto',
  },
})
