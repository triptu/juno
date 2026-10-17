import * as stylex from '@stylexjs/stylex'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { useId, useState } from 'react'
import { colors, layout, spacing, z } from '@juno/tokens/tokens.stylex'

// The list's least height: room for the info's lines and its button over a short list. The minimum window still fits the head, this and the foot.
const ABOUT_ROOM = '176px' // tokens-allow: the info panel's usual height
import { Button, IconButton, Kbd, ringRoom, Surface, Text } from '@juno/ui'
import { ReviewList, type ReviewRowProps } from './ReviewList'
import { reviewCopy, type ReviewEntry, type ReviewStatus, type ReviewVerbs } from './reviewModel'

/**
 * The review sheet every self-managing Home card opens
 * (`docs/design/settled-suggestions/`, "More self-management"): Tidy up,
 * follow-ups that look done, old drafts. Each card gives its rows, its
 * words and its two verbs; the sheet, the rows and the keys are the same.
 */

// A sheet narrower than this (the minimum window) drops the key hints; `ReviewList` puts a row's buttons under its text.
const NARROW = '@container review (width < 460px)'

/** The info button's panel: what the action does, line by line, and the way to the card's settings. */
export interface ReviewAbout {
  /** "What Resolve does". */
  readonly label: string
  readonly lines: ReadonlyArray<string>
  /** "Tidy up settings". */
  readonly settings: string
}

export interface ReviewExplainerProps {
  readonly about: ReviewAbout
  readonly onSettings: () => void
  /** Over the list, under the sheet's head: the sheet keeps its size, so nothing moves when it opens. */
  readonly floating?: boolean
}

/** What the action does, and the way to its settings. */
export function ReviewExplainer({ about, onSettings, floating = false }: ReviewExplainerProps) {
  return (
    <Surface kind={floating ? 'popover' : 'inset'} padding="md" sx={[styles.explainer, floating && styles.floating]} data-review-explainer="">
      <Text variant="ui" weight="medium">
        {about.label}
      </Text>
      <ul {...stylex.props(styles.points)}>
        {about.lines.map((line) => (
          <li key={line} {...stylex.props(styles.point)}>
            <Text variant="bodySmall" tone="subtle" as="span">
              {line}
            </Text>
          </li>
        ))}
      </ul>
      <span>
        <Button variant="secondary" size="sm" onClick={onSettings} data-review-settings="">
          {about.settings}
        </Button>
      </span>
    </Surface>
  )
}

export interface ReviewSheetProps {
  /** The card, for `data-sheet`: "settled", "followUps", "drafts". */
  readonly name: string
  readonly title: string
  readonly lead: string
  readonly about: ReviewAbout
  readonly verbs: ReviewVerbs
  readonly entries: ReadonlyArray<ReviewEntry>
  readonly statuses: ReadonlyMap<string, ReviewStatus>
  /** The bottom button that acts on every row still open: "Resolve all". Absent for a card without one. */
  readonly all?: string
  /** Start with the info open; the gallery shows it. */
  readonly initialAbout?: boolean
  readonly initialActive?: string
  readonly autoFocus?: boolean
  readonly onOpen: ReviewRowProps['onOpen']
  readonly onAct: ReviewRowProps['onAct']
  readonly onDecline: ReviewRowProps['onDecline']
  readonly onUndo: ReviewRowProps['onUndo']
  readonly onAll?: () => void
  readonly onSettings: () => void
  readonly onClose: () => void
}

/**
 * A card's review (SPEC 12): a sheet with every proposal, why, and the
 * "no" and the action for each; the bulk action, when the card has one,
 * and Done at the bottom, as a Mac sheet has its buttons. The info button
 * says what the action does and leads to the card's settings. A panel for
 * `SheetLayer`, which closes it on Esc and keeps Tab inside.
 */
export function ReviewSheet({ name, title, lead, about, verbs, entries, statuses, all, initialAbout = false, initialActive, autoFocus = false, onOpen, onAct, onDecline, onUndo, onAll, onSettings, onClose }: ReviewSheetProps) {
  const titleId = useId()
  const aboutId = useId()
  const [showAbout, setShowAbout] = useState(initialAbout)
  const left = entries.filter((entry) => (statuses.get(entry.id) ?? 'open') === 'open').length
  return (
    <Surface kind="popover" as="section" role="dialog" aria-labelledby={titleId} aria-modal padding="none" sx={styles.sheet} data-sheet={name}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.titleLine)}>
          <Text variant="heading" as="h2" id={titleId} truncate data-review-heading="">
            {title}
          </Text>
          <IconButton icon={Info} label={about.label} size={28} pressed={showAbout} expanded={showAbout} aria-controls={aboutId} onClick={() => setShowAbout(!showAbout)} data-review-about="" />
        </span>
        <Text variant="bodySmall" tone="subtle" as="p" sx={styles.lead}>
          {lead}
        </Text>
      </div>
      <div {...stylex.props(styles.scroll, ringRoom.inline)}>
        {/* The info opens over the list, not above it, so the sheet keeps its size and nothing moves. */}
        <div id={aboutId} {...stylex.props(styles.aboutLayer)}>{showAbout ? <ReviewExplainer about={about} onSettings={onSettings} floating /> : null}</div>
        <ReviewList entries={entries} statuses={statuses} verbs={verbs} label={title} initialActive={initialActive} autoFocus={autoFocus} onOpen={onOpen} onAct={onAct} onDecline={onDecline} onUndo={onUndo} />
      </div>
      <div {...stylex.props(styles.foot)}>
        <span {...stylex.props(styles.keys)} aria-hidden>
          <Kbd>↑↓</Kbd>
          <Text variant="meta" tone="muted">{reviewCopy.move}</Text>
          <Kbd>↵</Kbd>
          <Text variant="meta" tone="muted">{reviewCopy.open}</Text>
          <Kbd>{verbs.actKey}</Kbd>
          <Text variant="meta" tone="muted">{verbs.act}</Text>
          <Kbd>{verbs.declineKey}</Kbd>
          <Text variant="meta" tone="muted">{verbs.decline}</Text>
        </span>
        <span {...stylex.props(styles.buttons)}>
          <Button variant={all === undefined ? 'primary' : 'secondary'} size="md" onClick={onClose} data-review-close="">
            {reviewCopy.close}
          </Button>
          {all === undefined ? null : (
            <Button variant="primary" size="md" dimmed={left === 0} onClick={left === 0 ? undefined : onAll} data-review-all="">
              {all}
            </Button>
          )}
        </span>
      </div>
    </Surface>
  )
}

const styles = stylex.create({
  sheet: {
    containerType: 'inline-size',
    containerName: 'review',
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
  floating: {
    marginTop: 0,
  },
  // Over the top of the list, inset as the head's text is; a tall one scrolls with the list.
  aboutLayer: {
    position: 'absolute',
    top: 0,
    insetInline: spacing['--space-3'],
    zIndex: z['--z-header'],
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
    position: 'relative',
    flexGrow: 1,
    minHeight: ABOUT_ROOM,
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
    display: { default: 'inline-flex', [NARROW]: 'none' },
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
