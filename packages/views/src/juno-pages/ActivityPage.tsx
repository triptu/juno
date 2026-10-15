import * as stylex from '@stylexjs/stylex'
import { chatCopy, type ActivityAction, type ActivityRun, type ActivityPage as ActivityPageModel } from '@juno/agent-contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Chip, EmptyState, ListRow, Page, PageHeader, Surface, Text } from '@juno/ui'
import { cell } from './cell'
import { fullTime, messageTime } from '../time'

export interface ActivityPageProps {
  readonly page: ActivityPageModel
  readonly now: number
  /** "Copy details" on a failed action: the technical text goes to the clipboard. */
  readonly onCopyDetails: (details: string) => void
  /** Older runs exist: the button at the end asks for them. */
  readonly onLoadMore?: () => void
}

const decisionLabel: Record<ActivityAction['decision'], string> = {
  noClick: 'No click needed',
  approved: 'Approved',
  dismissed: 'Dismissed',
  expired: 'Expired',
  refused: 'Refused',
}

const outcomeLabel: Record<ActivityAction['outcome'], string | undefined> = {
  done: 'Done',
  failed: 'Failed',
  unknown: "Can't tell",
  pending: 'Pending',
  none: undefined,
}

/**
 * Every run (SPEC 13.9): who asked, when, the outcome, each action from
 * the Local tier up with the decision made about it, and one folded read
 * line. Only a run with actions has a card; the rest are their head line. Failures are in plain words with "Copy details"; the technical
 * reason lives behind that button and never in the chat.
 */
export function ActivityPage({ page, now, onCopyDetails, onLoadMore }: ActivityPageProps) {
  return (
    <Page>
      <PageHeader title="Activity" subtitle="Every run Juno made: what it read, what it did, and what you decided." />
      {page.runs.length === 0 ? (
        <EmptyState illustration="nothing-here" title="No runs yet" body="Runs show up here as Juno answers you or wakes on a schedule." enter={false} />
      ) : (
        page.runs.map((run) => <Run key={run.id} run={run} now={now} onCopyDetails={onCopyDetails} />)
      )}
      {page.moreAbove && onLoadMore !== undefined ? (
        <div {...stylex.props(styles.more)}>
          <Button variant="secondary" size="md" onClick={onLoadMore}>
            Show older runs
          </Button>
        </div>
      ) : null}
    </Page>
  )
}

function Run({ run, now, onCopyDetails }: { readonly run: ActivityRun; readonly now: number; readonly onCopyDetails: (details: string) => void }) {
  const copy = chatCopy.pages.activity
  const rows = run.actions
  return (
    <section aria-label={`${run.who}, ${fullTime(run.at)}`} data-activity-run={run.outcome} {...stylex.props(styles.run)}>
      <div {...stylex.props(styles.runHead)}>
        <Text variant="heading" tone="default" truncate dir="auto">
          {run.who}
        </Text>
        <Text variant="meta" tone="muted" numeric as="time" title={fullTime(run.at)}>
          {messageTime(run.at, now)}
        </Text>
        <Chip variant={run.outcome === 'replied' || run.outcome === 'stayedQuiet' ? 'filled' : 'outline'} size={20}>
          {copy.outcome[run.outcome]}
        </Chip>
        {run.tainted ? (
          <Chip variant="outline" size={20} title="Content Juno read in this run could hold instructions, so it proposed cards instead of acting.">
            Read untrusted content
          </Chip>
        ) : null}
      </div>
      {rows.length === 0 ? (
        // A run with no actions has no card: its read line, if any, sits under the head.
        run.reads === undefined ? null : (
          <Text variant="meta" tone="muted" truncate>
            {run.reads}
          </Text>
        )
      ) : (
        <Surface kind="group" role="list" aria-label="Actions">
          {rows.map((action, index) => (
            <ListRow
              key={action.id}
              role="listitem"
              data-activity-action={action.outcome}
              divider={index < rows.length - 1 || run.reads !== undefined}
              trailing={
                <span {...stylex.props(cell.controls)}>
                  <Chip variant="filled" size={20}>
                    {decisionLabel[action.decision]}
                  </Chip>
                  {outcomeLabel[action.outcome] !== undefined ? (
                    <Chip variant={action.outcome === 'done' ? 'filled' : 'outline'} size={20}>
                      {outcomeLabel[action.outcome]}
                    </Chip>
                  ) : null}
                </span>
              }
            >
              <span {...stylex.props(cell.lines)}>
                <span {...stylex.props(cell.line)}>
                  <Text variant="tagSmall" tone="muted" numeric>
                    Tier {action.tier}
                  </Text>
                  <Text variant="body" truncate dir="auto">
                    {action.label}
                  </Text>
                </span>
                {/* A connection call's auto-review: why Juno asked, or why it ran without asking. */}
                {action.review !== undefined ? (
                  <Text variant="meta" tone="muted" sx={cell.wrap} data-activity-review={action.review.intent ?? (action.review.failed ? 'failed' : 'none')}>
                    {action.review.line}
                  </Text>
                ) : null}
                {action.failure !== undefined ? (
                  <span {...stylex.props(cell.line)}>
                    <Text variant="meta" tone="muted" sx={cell.wrap}>
                      {action.failure.text}
                    </Text>
                    <Button variant="ghost" size="xs" tone="subtle" onClick={() => onCopyDetails(action.failure?.details ?? '')}>
                      {copy.copyDetails}
                    </Button>
                  </span>
                ) : null}
              </span>
            </ListRow>
          ))}
          {run.reads !== undefined ? (
            <ListRow role="listitem" minHeight={44} divider={false}>
              <Text variant="meta" tone="muted" truncate>
                {run.reads}
              </Text>
            </ListRow>
          ) : null}
        </Surface>
      )}
    </section>
  )
}

const styles = stylex.create({
  run: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
  },
  runHead: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing['--space-2'],
    minWidth: 0,
    color: colors['--foreground-default'],
    userSelect: 'none',
  },
  more: {
    display: 'flex',
    justifyContent: 'center',
  },
})
