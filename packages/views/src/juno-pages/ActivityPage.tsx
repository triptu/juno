import * as stylex from '@stylexjs/stylex'
import { memo, useCallback, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { chatCopy, type ActivityRun, type ActivityPage as ActivityPageModel } from '@juno/agent-contract'
import { colors, layout, motion, radii, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, EmptyState, focusRing, Icon, Page, PageHeader, Surface, Text } from '@juno/ui'
import { costLabel, decisionLabel, RunDetail } from './ActivityRunDetail'
import { clockLabel, dayLabel, fullTime } from '../time'

export interface ActivityPageProps {
  readonly page: ActivityPageModel
  readonly now: number
  /** "Copy details" on a failed action: the technical text goes to the clipboard. */
  readonly onCopyDetails: (details: string) => void
  /** Older runs exist: the button at the end asks for them. */
  readonly onLoadMore?: () => void
  /** Runs shown open when the page first draws, for the gallery. */
  readonly initiallyOpen?: ReadonlyArray<string>
}

const copy = chatCopy.pages.activity

/** Actions named on a run's closed row; the rest are counted. */
const ACTIONS_SHOWN = 2

/** What started the run: the owner's own words, or a schedule, a job, an answer or a reaction by name. */
function trigger(run: ActivityRun): { readonly kind?: string; readonly text: string; readonly removed?: true } {
  const t = run.trigger
  switch (t._tag) {
    case 'message':
      if (t.words !== '') return { text: t.words }
      return t.files > 0 ? { text: t.files === 1 ? 'An attached file' : `${t.files} attached files` } : { text: copy.trigger.removed, removed: true }
    case 'reaction':
      return { kind: copy.trigger.reaction, text: t.emoji }
    case 'schedule':
      return { kind: copy.trigger.schedule, text: t.name }
    case 'job':
      return { kind: copy.trigger.job, text: t.name }
    case 'answer':
      return { kind: copy.trigger.answer, text: t.question }
  }
}

/** What the run read, in plain words. A run that read outside content always says so, by name when it can. */
function readLine(run: ActivityRun): string | undefined {
  if (run.sources.length > 0) return `${copy.read} ${run.sources.join(', ')}`
  return run.tainted ? copy.readOutside : undefined
}

/** The closed row's second line: what it read, how it ended, and each decision. */
function summary(run: ActivityRun): string {
  const decided = run.actions.slice(0, ACTIONS_SHOWN).map((action) => `${action.label}: ${decisionLabel[action.decision]}`)
  const more = run.actions.length - decided.length
  return [readLine(run), copy.outcome[run.outcome], ...decided, ...(more > 0 ? [`${more} more`] : [])].filter((part) => part !== undefined).join(' · ')
}

/** Runs grouped by the day they started, newest first, as the agent sends them. */
function byDay(runs: ReadonlyArray<ActivityRun>, now: number): ReadonlyArray<{ readonly label: string; readonly runs: ReadonlyArray<ActivityRun> }> {
  const days: Array<{ label: string; runs: Array<ActivityRun> }> = []
  for (const run of runs) {
    const label = dayLabel(run.at, now)
    const last = days.at(-1)
    if (last?.label === label) last.runs.push(run)
    else days.push({ label, runs: [run] })
  }
  return days
}

/**
 * Every run Juno made (SPEC 13.9), newest first, by day under sticky day
 * labels. A run is one row that answers at a glance: what started it (your
 * words, or a schedule, a job or a card by name), what it read by name, how
 * it ended and what you decided, with its model and cost at the end. A click
 * opens the row in place: each step in order with what it was given and what
 * came back, the script's reads, and each action with its decision. A run
 * that read outside content says so in plain words, and that it asked before
 * acting. Failures have "Copy details"; the technical reason never shows.
 */
export function ActivityPage({ page, now, onCopyDetails, onLoadMore, initiallyOpen = [] }: ActivityPageProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen))
  const toggle = useCallback((id: string) => setOpen((ids) => {
    const next = new Set(ids)
    if (!next.delete(id)) next.add(id)
    return next
  }), [])
  return (
    <Page>
      <PageHeader title={chatCopy.pageTitles.activity} subtitle={copy.subtitle} />
      {page.runs.length === 0 ? (
        <EmptyState illustration="nothing-here" title={copy.empty.title} body={copy.empty.body} enter={false} />
      ) : (
        <div {...stylex.props(styles.days)}>
          {byDay(page.runs, now).map((day) => (
            <section key={day.label} aria-label={day.label} {...stylex.props(styles.day)}>
              <div {...stylex.props(styles.dayLabel)}>
                <Text variant="divider" tone="muted" numeric>
                  {day.label}
                </Text>
              </div>
              <Surface kind="group" padding="none" role="list" aria-label={`Runs, ${day.label}`}>
                {day.runs.map((run, index) => (
                  <Run key={run.id} run={run} open={open.has(run.id)} last={index === day.runs.length - 1} onToggle={toggle} onCopyDetails={onCopyDetails} />
                ))}
              </Surface>
            </section>
          ))}
        </div>
      )}
      {page.moreAbove && onLoadMore !== undefined ? (
        <div {...stylex.props(styles.more)}>
          <Button variant="secondary" size="md" onClick={onLoadMore}>
            {copy.older}
          </Button>
        </div>
      ) : null}
    </Page>
  )
}

interface RunProps {
  readonly run: ActivityRun
  readonly open: boolean
  readonly last: boolean
  readonly onToggle: (id: string) => void
  readonly onCopyDetails: (details: string) => void
}

const Run = memo(function Run({ run, open, last, onToggle, onCopyDetails }: RunProps) {
  const started = trigger(run)
  const detailId = `activity-run-${run.id}`
  const usage = [run.model, run.costUsd === undefined ? undefined : costLabel(run.costUsd)].filter((part) => part !== undefined).join(' · ')
  return (
    <div role="listitem" data-activity-run={run.outcome} data-activity-open={open ? '' : undefined} {...stylex.props(styles.run, !last && styles.divider, !open && styles.closed)}>
      <button type="button" aria-expanded={open} aria-controls={detailId} onClick={() => onToggle(run.id)} {...stylex.props(styles.head, focusRing.inset)}>
        <span {...stylex.props(styles.caret, open && styles.caretOpen)}>
          <Icon icon={CaretRight} size={12} weight="bold" />
        </span>
        <span {...stylex.props(styles.lines)}>
          <span {...stylex.props(styles.line)}>
            {started.kind === undefined ? null : (
              <Text variant="ui" tone="muted" sx={styles.fixed}>
                {started.kind}
              </Text>
            )}
            <Text variant="ui" tone={started.removed ? 'muted' : 'default'} truncate dir="auto" sx={styles.grow} data-activity-trigger={run.trigger._tag}>
              {started.text}
            </Text>
            <Text variant="meta" tone="muted" numeric as="time" title={fullTime(run.at)} sx={styles.fixed}>
              {clockLabel(run.at)}
            </Text>
          </span>
          <span {...stylex.props(styles.line)}>
            <Text variant="meta" tone="muted" truncate dir="auto" sx={styles.grow} data-activity-summary="">
              {summary(run)}
            </Text>
            {usage === '' ? null : (
              <Text variant="meta" tone="subtle" numeric sx={styles.usage} data-activity-usage="">
                {usage}
              </Text>
            )}
          </span>
        </span>
      </button>
      {open ? <RunDetail id={detailId} run={run} onCopyDetails={onCopyDetails} /> : null}
    </div>
  )
})

/** The page's own width (`Page`'s container) under which a closed row leaves out the model and cost. */
const NARROW = '@container page (width < 520px)'

/** A closed row's height before it is drawn: two lines and the row's padding. */
const RUN_ESTIMATE = `auto ${sizes['--row-52']}`

const styles = stylex.create({
  days: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-6'],
  },
  day: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
  },
  // Sticks below the header's band, on the page's own fill, so the rows pass under it.
  dayLabel: {
    position: 'sticky',
    top: layout['--header-band'],
    zIndex: 1,
    paddingBlock: spacing['--space-1'],
    paddingInline: spacing['--space-3'],
    backgroundColor: `var(--juno-page-fill, ${colors['--background']})`,
    userSelect: 'none',
  },
  run: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    contain: 'content',
  },
  // Closed rows off screen are skipped until they scroll near: 500 runs open as fast as 50.
  closed: {
    contentVisibility: 'auto',
    containIntrinsicSize: RUN_ESTIMATE,
  },
  divider: {
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  head: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-2'],
    width: '100%',
    minWidth: 0,
    margin: 0,
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-3'],
    borderWidth: 0,
    borderRadius: radii['--radius-3xl'],
    font: 'inherit',
    textAlign: 'start',
    color: colors['--foreground-default'],
    cursor: 'default',
    userSelect: 'none',
    backgroundColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--surface-hover'] },
    },
  },
  caret: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    height: sizes['--control-20'],
    color: colors['--foreground-muted'],
    transitionProperty: 'transform',
    transitionDuration: motion['--duration-fast'],
  },
  caretOpen: {
    transform: 'rotate(90deg)',
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    flexGrow: 1,
    minWidth: 0,
  },
  line: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  grow: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  fixed: {
    flexShrink: 0,
  },
  // Whole or not at all: in a narrow page (the panel) the open row still says it.
  usage: {
    display: { default: 'inline', [NARROW]: 'none' },
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  more: {
    display: 'flex',
    justifyContent: 'center',
  },
})
