import * as stylex from '@stylexjs/stylex'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { useId, useState, type ReactNode } from 'react'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { IconButton, Kbd, ringRoom, Surface, Text } from '@juno/ui'

export interface ReviewExplainerProps {
  readonly title: string
  readonly lines: ReadonlyArray<string>
  /** A button under the lines, such as the way to Settings. */
  readonly action?: ReactNode
}

/** What a review's action does, in a few lines: the info button's panel. */
export function ReviewExplainer({ title, lines, action }: ReviewExplainerProps) {
  return (
    <Surface kind="inset" padding="md" sx={styles.explainer} data-settled-explainer="">
      <Text variant="ui" weight="medium">
        {title}
      </Text>
      <ul {...stylex.props(styles.points)}>
        {lines.map((line) => (
          <li key={line} {...stylex.props(styles.point)}>
            <Text variant="bodySmall" tone="subtle" as="span">
              {line}
            </Text>
          </li>
        ))}
      </ul>
      {action === undefined ? null : <span>{action}</span>}
    </Surface>
  )
}

export interface ReviewSheetProps {
  /** `data-sheet`, so a test can tell one review from another. */
  readonly sheet: string
  readonly title: string
  readonly lead: string
  /** The info button's label and tooltip. */
  readonly aboutLabel: string
  /** The info button's panel (`ReviewExplainer`). */
  readonly about: ReactNode
  /** Start with the panel open; the gallery shows it. */
  readonly initialAbout?: boolean
  /** The key hints at the bottom left: the key, then what it does. */
  readonly keys: ReadonlyArray<readonly [key: string, label: string]>
  /** The buttons at the bottom right, as a Mac sheet has them. */
  readonly buttons: ReactNode
  /** The rows (`SettledList`). */
  readonly children: ReactNode
}

/**
 * The frame every review sheet shares (Tidy up, Automated's record): the
 * title with the info button, a line on what the list is, the rows in a
 * scrolling middle, and the key hints and buttons at the bottom. A panel for
 * `SheetLayer`, which closes it on Esc and keeps Tab inside.
 */
export function ReviewSheet({ sheet, title, lead, aboutLabel, about, initialAbout = false, keys, buttons, children }: ReviewSheetProps) {
  const titleId = useId()
  const aboutId = useId()
  const [open, setOpen] = useState(initialAbout)
  return (
    <Surface kind="popover" as="section" role="dialog" aria-labelledby={titleId} aria-modal padding="none" sx={styles.sheet} data-sheet={sheet}>
      {/* The info button opens its panel in place and the sheet grows with it, on purpose. */}
      <div data-expands-in-place="" {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.titleLine)}>
          <Text variant="heading" as="h2" id={titleId} truncate>
            {title}
          </Text>
          <IconButton icon={Info} label={aboutLabel} size={28} pressed={open} expanded={open} aria-controls={aboutId} onClick={() => setOpen(!open)} data-settled-about="" />
        </span>
        <Text variant="bodySmall" tone="subtle" as="p" sx={styles.lead}>
          {lead}
        </Text>
        <div id={aboutId} {...stylex.props(styles.about)}>{open ? about : null}</div>
      </div>
      <div {...stylex.props(styles.scroll, ringRoom.inline)}>{children}</div>
      <div {...stylex.props(styles.foot)}>
        <span {...stylex.props(styles.keys)} aria-hidden>
          {keys.map(([key, label]) => (
            <span key={key} {...stylex.props(styles.key)}>
              <Kbd>{key}</Kbd>
              <Text variant="meta" tone="muted">{label}</Text>
            </span>
          ))}
        </span>
        <span {...stylex.props(styles.buttons)}>{buttons}</span>
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
    // On a short window the info panel scrolls, so the rows and the buttons keep their place in the sheet.
    minHeight: 0,
    flexShrink: 1,
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
  about: {
    minHeight: 0,
    overflowY: 'auto',
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
    flexShrink: 2,
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
  // A key and its label: inside a pair the gap is the keys' own, so the hints read as before.
  key: {
    display: 'contents',
  },
  buttons: {
    display: 'inline-flex',
    gap: spacing['--space-2'],
    marginInlineStart: 'auto',
  },
})
