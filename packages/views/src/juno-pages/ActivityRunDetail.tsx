import * as stylex from '@stylexjs/stylex'
import { chatCopy, type ActivityAction, type ActivityRun, type ActivityScriptCall, type ActivityStep } from '@juno/agent-contract'
import { sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Chip, Text } from '@juno/ui'
import { cell } from './cell'
import { fullTime } from '../time'

const copy = chatCopy.pages.activity

/** The owner's decision on an action, in the owner's words. */
export const decisionLabel: Record<ActivityAction['decision'], string> = copy.decision

const ended = copy.ended

const outcomeLabel: Record<ActivityAction['outcome'], string | undefined> = { done: ended.done, failed: ended.failed, unknown: ended.unknown, pending: ended.pending, none: undefined }

const scriptOutcomeLabel: Record<ActivityScriptCall['outcome'], string> = { done: ended.done, failed: ended.failed, cancelled: ended.cancelled, refused: ended.refused, unfinished: ended.unfinished }

const stepOutcomeLabel: Record<ActivityStep['outcome'], string | undefined> = { done: undefined, failed: ended.failed, unfinished: ended.unfinished }

/** "$0.004", "$0.12", "<$0.001": what a run cost, quietly. */
export function costLabel(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.001) return '<$0.001'
  return `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`
}

/** The opened row: the safety line, the steps in order, the script's reads, then the actions with their decisions. */
export function RunDetail({ id, run, onCopyDetails }: { readonly id: string; readonly run: ActivityRun; readonly onCopyDetails: (details: string) => void }) {
  return (
    <div id={id} {...stylex.props(styles.detail)}>
      {run.tainted ? (
        <Text variant="meta" tone="muted" as="p" sx={cell.wrap} data-activity-tainted="">
          {copy.askedFirst}
        </Text>
      ) : null}
      {run.steps.length > 0 ? (
        <ol aria-label={copy.steps} {...stylex.props(styles.steps)}>
          {run.steps.map((step, index) => (
            <li key={index} data-activity-step={step.outcome} {...stylex.props(styles.step)}>
              <Text variant="meta" tone="muted" numeric sx={styles.stepNumber}>
                {index + 1}
              </Text>
              <span {...stylex.props(cell.lines)}>
                <span {...stylex.props(styles.stepLine)}>
                  <Text variant="ui" tone="default" truncate dir="auto" sx={styles.stepLabel}>
                    {step.label}
                  </Text>
                  {step.result === undefined && stepOutcomeLabel[step.outcome] === undefined ? null : (
                    <Text variant="meta" tone="muted" truncate dir="auto" sx={styles.result}>
                      {[step.result, stepOutcomeLabel[step.outcome]].filter((part) => part !== undefined).join(' · ')}
                    </Text>
                  )}
                </span>
                {step.input === undefined ? null : (
                  <Text variant="meta" tone="subtle" truncate dir="auto" title={step.input}>
                    {step.input}
                  </Text>
                )}
              </span>
            </li>
          ))}
          {run.moreSteps === undefined ? null : (
            <li {...stylex.props(styles.step)}>
              <Text variant="meta" tone="muted">
                {copy.moreSteps(run.moreSteps)}
              </Text>
            </li>
          )}
        </ol>
      ) : null}
      {run.reads === undefined ? null : <Reads run={run} />}
      {run.actions.length === 0 ? null : (
        <ul aria-label="Actions" {...stylex.props(styles.actions)}>
          {run.actions.map((action) => (
            <Action key={action.id} action={action} onCopyDetails={onCopyDetails} />
          ))}
        </ul>
      )}
      {run.model === undefined ? null : (
        <Text variant="meta" tone="subtle" numeric>
          {[run.model, run.costUsd === undefined ? undefined : costLabel(run.costUsd), fullTime(run.at)].filter((part) => part !== undefined).join(' · ')}
        </Text>
      )}
    </div>
  )
}

function Action({ action, onCopyDetails }: { readonly action: ActivityAction; readonly onCopyDetails: (details: string) => void }) {
  return (
    <li data-activity-action={action.outcome} {...stylex.props(styles.action)}>
      <span {...stylex.props(cell.lines, styles.grow)}>
        <Text variant="ui" tone="default" truncate dir="auto">
          {action.label}
        </Text>
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
    </li>
  )
}

/** The script's folded read line, and under it each call it made, with its arguments and outcome. */
function Reads({ run }: { readonly run: ActivityRun }) {
  return (
    <span {...stylex.props(cell.lines)}>
      <Text variant="meta" tone="muted" truncate>
        {run.reads}
      </Text>
      {run.scriptCalls?.map((call, index) => (
        <span key={index} data-activity-script-call={call.outcome} {...stylex.props(cell.line)}>
          <Text variant="meta" tone="subtle" truncate dir="auto">
            {`${call.tool} ${call.args}`}
          </Text>
          <Text variant="meta" tone="muted">
            {scriptOutcomeLabel[call.outcome]}
          </Text>
        </span>
      ))}
    </span>
  )
}

const styles = stylex.create({
  detail: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    paddingBlock: `0 ${spacing['--space-3']}`,
    // In line with the trigger, past the caret.
    paddingInlineStart: `calc(${spacing['--space-3']} + ${sizes['--control-20']})`, // tokens-allow: The caret's slot and the row's inset.
    paddingInlineEnd: spacing['--space-3'],
    minWidth: 0,
    userSelect: 'text',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  step: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
  stepNumber: {
    flexShrink: 0,
    minWidth: spacing['--space-3'],
    textAlign: 'end',
  },
  // The label keeps its words; the result sits after it, or under it when it would get too short to read.
  stepLine: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: spacing['--space-2'],
    minWidth: 0,
  },
  stepLabel: {
    flexShrink: 0,
    maxWidth: '100%',
  },
  result: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: '12ch',
    maxWidth: '100%',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  action: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: spacing['--space-3'],
    minWidth: 0,
  },
  grow: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
})
