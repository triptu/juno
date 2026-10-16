import * as stylex from '@stylexjs/stylex'
import { useId, type KeyboardEvent } from 'react'
import { accent, colors, layout, motion, radii, shadows, sizes, spacing, text, themed } from '@juno/tokens/tokens.stylex'
import { Button, Surface, Text } from '@juno/ui'
import { tourCopy, tourSteps, type TourStep } from './tour/copy'
import { TourFooter } from './tour/TourFooter'
import { tourShots, type TourShot } from './tour/shots/manifest'

export interface TourSheetProps {
  /** The step on screen, 0 to `tourSteps.length - 1`. */
  readonly step: number
  /** No model provider is set up: the last step says so and offers Add a provider. */
  readonly needsProvider: boolean
  readonly onStep: (step: number) => void
  /** Skip tour, Esc, or Done on the last step. Either way the tour counts as seen. */
  readonly onClose: () => void
  readonly onAddProvider: () => void
}

/**
 * The tour (SPEC 4.1): five steps that move a Slack user's picture of
 * their workspace from channels to topics, each a product screenshot with
 * numbered callouts over it, a heading, a line or two and the callouts'
 * labels. The container puts it in a `SheetLayer`, like a macOS sheet:
 * it dims the window, keeps Tab inside, and Esc closes it.
 *
 * Nothing moves between steps. Every step's picture and text are in the
 * page at once, stacked in one cell, and only the current one is visible,
 * so the sheet is as tall as its tallest step and the images are already
 * loaded when a step shows. Both themes' pictures are in the page too; the
 * `themed` tokens show the one for the theme in use.
 *
 * Keys: ← and → move a step and Enter goes on. Esc (the layer) skips, and
 * ⌘[ and ⌘] are the app menu's Back and Forward, which the container turns
 * into steps.
 */
export function TourSheet({ step, needsProvider, onStep, onClose, onAddProvider }: TourSheetProps) {
  const id = useId()
  const total = tourSteps.length
  const last = step === total - 1
  const current = tourSteps[step] ?? tourSteps[0]!
  const next = () => (last ? onClose() : onStep(step + 1))
  const back = () => onStep(Math.max(0, step - 1))
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      if (!last) onStep(step + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      back()
    } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      // A focused button takes Enter as its own press.
      event.preventDefault()
      next()
    }
  }
  return (
    <Surface
      kind="popover"
      as="section"
      role="dialog"
      aria-modal
      aria-label={tourCopy.label}
      aria-describedby={`${id}-${current.id}`}
      padding="none"
      sx={styles.sheet}
      data-tour=""
      data-tour-step={current.id}
      onKeyDown={onKeyDown}
    >
      <div {...stylex.props(styles.stage)}>
        {tourSteps.map((entry, index) => (
          <Picture key={entry.id} step={entry} shot={tourShots[entry.id]} shown={index === step} />
        ))}
      </div>
      <div {...stylex.props(styles.stack)}>
        {tourSteps.map((entry, index) => (
          <StepText key={entry.id} id={`${id}-${entry.id}`} step={entry} shown={index === step} provider={index === total - 1 && needsProvider ? onAddProvider : undefined} />
        ))}
      </div>
      <TourFooter step={step} onStep={onStep} onBack={back} onNext={next} onSkip={onClose} />
      {/* What VoiceOver says when the step changes; focus stays on the button that moved it. */}
      <p role="status" aria-live="polite" {...stylex.props(styles.announce)}>
        {`${tourCopy.step(step, total)}: ${current.heading}`}
      </p>
    </Surface>
  )
}

/** A fraction of the picture as a CSS percentage, so a mark scales with the picture. */
const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`

/** One step's screenshot in both themes, with its callouts numbered over it. */
function Picture({ step, shot, shown }: { readonly step: TourStep; readonly shot: TourShot; readonly shown: boolean }) {
  return (
    <figure {...stylex.props(styles.layer, styles.figure, !shown && styles.hidden)} data-tour-picture={step.id}>
      <img src={shot.light} alt={step.alt} width={shot.width} height={shot.height} draggable={false} {...stylex.props(styles.image, styles.light)} />
      <img src={shot.dark} alt={step.alt} width={shot.width} height={shot.height} draggable={false} {...stylex.props(styles.image, styles.dark)} />
      {step.callouts.map((callout, index) => {
        const box = shot.anchors[callout.anchor]
        return box === undefined ? null : (
          <span key={callout.anchor} aria-hidden data-tour-callout={callout.anchor} {...stylex.props(styles.mark(percent(box[0]), percent(box[1]), percent(box[2]), percent(box[3])))}>
            <span {...stylex.props(styles.badge, styles.badgeOnPicture)}>{index + 1}</span>
          </span>
        )
      })}
    </figure>
  )
}

function StepText({ id, step, shown, provider }: { readonly id: string; readonly step: TourStep; readonly shown: boolean; readonly provider: (() => void) | undefined }) {
  return (
    <div {...stylex.props(styles.layer, styles.text, !shown && styles.hidden)} id={id}>
      <Text variant="heading" tone="default" as="h2">
        {step.heading}
      </Text>
      <Text variant="body" tone="subtle" as="p" sx={styles.body}>
        {step.body}
      </Text>
      <ol {...stylex.props(styles.callouts)}>
        {step.callouts.map((callout, index) => (
          <li key={callout.anchor} {...stylex.props(styles.callout)}>
            <span aria-hidden {...stylex.props(styles.badge)}>
              {index + 1}
            </span>
            <Text variant="ui" tone="default">
              {callout.label}
            </Text>
          </li>
        ))}
      </ol>
      {provider === undefined ? null : (
        <span {...stylex.props(styles.provider)}>
          <Text variant="ui" tone="subtle">
            {tourCopy.needsProvider}
          </Text>
          <Button variant="secondary" size="xs" onClick={provider}>
            {tourCopy.addProvider}
          </Button>
        </span>
      )}
    </div>
  )
}

const styles = stylex.create({
  sheet: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-5'],
    width: '100%',
    maxWidth: layout['--tour-width'],
    maxHeight: '100%',
    boxSizing: 'border-box',
    padding: spacing['--space-5'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    animationName: stylex.keyframes({
      from: { opacity: 0, transform: `scale(${motion['--appear-scale']})` },
      to: { opacity: 1, transform: 'scale(1)' },
    }),
    animationDuration: motion['--duration-appear'],
    animationTimingFunction: motion['--ease-out'],
    animationFillMode: 'both',
  },
  // The window's minimum size at 1x. On a short window it shrinks by its
  // aspect ratio (720 / 480 = 1.5) and leaves the rest of the sheet its room.
  stage: {
    position: 'relative',
    display: 'grid',
    alignSelf: 'center',
    flexShrink: 0,
    width: `min(100%, ${layout['--tour-shot-width']}, calc((100vh - ${layout['--tour-chrome-height']}) * 1.5))`,
    aspectRatio: '3 / 2',
    borderRadius: radii['--radius-lg'],
    overflow: 'hidden',
    // A hairline that reads on both themes' screenshots, and stays in forced colours.
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--border-strong'],
    backgroundColor: colors['--background-subtle'],
  },
  // Steps share one cell, so the tallest sets the size and a step change moves nothing.
  stack: {
    display: 'grid',
  },
  layer: {
    gridArea: '1 / 1',
    transitionProperty: 'opacity, visibility',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
  },
  hidden: {
    opacity: 0,
    visibility: 'hidden',
  },
  figure: {
    position: 'relative',
    margin: 0,
  },
  image: {
    width: '100%',
    height: '100%',
    userSelect: 'none',
  },
  light: {
    display: themed['--show-light'],
  },
  dark: {
    display: themed['--show-dark'],
  },
  // Around the thing a callout names, in fractions of the picture, so it scales with it.
  mark: (left: string, top: string, width: string, height: string) => ({
    position: 'absolute',
    left,
    top,
    width,
    height,
    boxSizing: 'border-box',
    borderWidth: spacing['--space-0-5'],
    borderStyle: 'solid',
    borderColor: accent['--hl'],
    borderRadius: radii['--radius-lg'],
    pointerEvents: 'none',
  }),
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: sizes['--control-20'],
    height: sizes['--control-20'],
    borderRadius: radii['--radius-full'],
    backgroundColor: accent['--hl'],
    color: accent['--hl-fg'],
    fontFamily: text['--text-tag-family'],
    fontSize: text['--text-tag-size'],
    fontWeight: text['--text-tag-weight'],
    lineHeight: text['--text-tag-leading'],
    fontVariantNumeric: 'tabular-nums',
  },
  // On the mark's top-left corner, outside the thing it marks.
  badgeOnPicture: {
    position: 'absolute',
    top: `calc(-1 * ${sizes['--control-20']} / 2)`,
    left: `calc(-1 * ${sizes['--control-20']} / 2)`,
    boxShadow: shadows['--shadow-sm'],
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  body: {
    textWrap: 'pretty',
  },
  callouts: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
    margin: 0,
    marginTop: spacing['--space-1'],
    padding: 0,
    listStyle: 'none',
  },
  callout: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
  provider: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing['--space-2'],
    marginTop: spacing['--space-1'],
  },
  announce: {
    position: 'absolute',
    width: '1px', // tokens-allow: the visually hidden pattern
    height: '1px', // tokens-allow: the visually hidden pattern
    margin: 0,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
})
