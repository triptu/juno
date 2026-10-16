import * as stylex from '@stylexjs/stylex'
import { accent, colors, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button } from '@juno/ui'
import { tourCopy, tourSteps } from './copy'

export interface TourFooterProps {
  readonly step: number
  readonly onStep: (step: number) => void
  readonly onBack: () => void
  readonly onNext: () => void
  readonly onSkip: () => void
}

/** Skip tour at the start, the step dots in the middle, Back and Next (Done on the last step) at the end. */
export function TourFooter({ step, onStep, onBack, onNext, onSkip }: TourFooterProps) {
  const total = tourSteps.length
  const last = step === total - 1
  return (
    <div {...stylex.props(styles.footer)}>
      <span {...stylex.props(styles.end)}>
        <Button variant="ghost" tone="subtle" size="md" onClick={onSkip} data-tour-skip="">
          {tourCopy.skip}
        </Button>
      </span>
      <div role="group" aria-label={tourCopy.dots} {...stylex.props(styles.dots)}>
        {tourSteps.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            aria-label={`${tourCopy.step(index, total)}: ${entry.heading}`}
            aria-current={index === step ? 'step' : undefined}
            onClick={() => onStep(index)}
            {...stylex.props(styles.dotButton)}
          >
            <span {...stylex.props(styles.dot, index === step && styles.dotCurrent)} />
          </button>
        ))}
      </div>
      <span {...stylex.props(styles.end, styles.actions)}>
        <Button variant="secondary" size="md" onClick={onBack} disabled={step === 0}>
          {tourCopy.back}
        </Button>
        {/* Next and Done share one width, so the last step moves nothing. */}
        <Button variant="primary" size="md" onClick={onNext} autoFocus data-tour-next="">
          <span {...stylex.props(styles.labels)}>
            <span {...stylex.props(styles.label, last && styles.hidden)} aria-hidden={last || undefined}>
              {tourCopy.next}
            </span>
            <span {...stylex.props(styles.label, !last && styles.hidden)} aria-hidden={!last || undefined}>
              {tourCopy.done}
            </span>
          </span>
        </Button>
      </span>
    </div>
  )
}

const styles = stylex.create({
  footer: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems: 'center',
    gap: spacing['--space-3'],
  },
  end: {
    display: 'flex',
    alignItems: 'center',
  },
  actions: {
    justifyContent: 'flex-end',
    gap: spacing['--space-2'],
  },
  dots: {
    display: 'flex',
    alignItems: 'center',
  },
  // A 24px target around an 8px dot (WCAG 2.5.8).
  dotButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: sizes['--control-24'],
    height: sizes['--control-24'],
    padding: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-full'],
    backgroundColor: 'transparent',
    cursor: 'default',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineColor: accent['--focus-ring'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
  },
  dot: {
    width: spacing['--space-2'],
    height: spacing['--space-2'],
    borderRadius: radii['--radius-full'],
    backgroundColor: {
      default: colors['--border-strongest'],
      ':hover': { default: null, '@media (hover: hover)': colors['--foreground-muted'] },
    },
    transitionProperty: 'background-color',
    transitionDuration: motion['--duration-fast'],
  },
  dotCurrent: {
    backgroundColor: {
      default: accent['--hl'],
      ':hover': { default: null, '@media (hover: hover)': accent['--hl'] },
    },
  },
  // Next and Done in one cell: the button keeps the wider label's width.
  labels: {
    display: 'grid',
    justifyItems: 'center',
  },
  label: {
    gridArea: '1 / 1',
  },
  hidden: {
    opacity: 0,
    visibility: 'hidden',
  },
})
