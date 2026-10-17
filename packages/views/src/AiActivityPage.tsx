import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { NO_LIMIT_USD } from '@juno/agent-contract'
import type { AiActivity, AiCallOutcome, AiCallRow } from '@juno/contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, Chip, EmptyState, ListRow, Page, PageHeader, Section, Select, Surface, Text, TextField } from '@juno/ui'
import { featureLabel, kindLabel, OUTCOMES } from './aiActivityLabels'
import { cell } from './juno-pages/cell'
import { fullTime, messageTime } from './time'

const ALL = 'all'

/** Today's spend from the agent's ledger, counted as the daily limit counts it. */
interface AiSpendToday {
  readonly spentUsd: number
  /** Today's limit: the daily limit plus any "Allow $1 more". */
  readonly limitUsd: number
  /** The daily limit the owner set. `NO_LIMIT_USD` or more is no limit. */
  readonly capUsd: number
  /** Topic art, titles, Home and the send checks. */
  readonly backgroundUsd: number
  readonly backgroundLimitUsd: number
}

/** The limit "No limit" turned off goes back to. */
const DEFAULT_LIMIT_USD = 5

export interface AiActivityPageProps {
  /** The log; undefined until it arrives. */
  readonly activity: AiActivity | undefined
  /** Today's spend and limit; undefined while Juno's agent is not running. */
  readonly spend?: AiSpendToday | undefined
  /** A new daily limit in dollars; `NO_LIMIT_USD` for no limit. */
  readonly onLimit?: (usd: number) => void
  readonly now: number
  /** "Copy details" on a row: the row's details as text go to the clipboard. */
  readonly onCopyDetails: (details: string) => void
}

/** Rows shown at first, and added by each "Show older calls". */
const AI_ACTIVITY_PAGE = 100

/** "$0.42": spend and limits. */
const dollars = (value: number): string => `$${value.toFixed(2)}`

/** A limit typed in the field, committed on blur or Enter, so a field cleared while typing never sets $0. */
function commitLimit(text: string, current: number, onLimit: (usd: number) => void): void {
  const value = Number(text)
  if (text.trim() !== '' && Number.isFinite(value) && value >= 0 && value !== current) onLimit(value)
}

/** "$0.0031", or "$1.20" from a dollar up. Unknown is "Unknown". */
const usd = (value: number | null): string => {
  if (value === null) return 'Unknown'
  if (value >= 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(4)}`
}

const seconds = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

/** The row as text, for a bug report: no prompt or answer is in it, since none is stored. */
function aiCallDetails(call: AiCallRow): string {
  const lines = [
    `Time: ${new Date(call.at).toISOString()}${call.repeats > 1 ? ` (${call.repeats} times, last ${new Date(call.lastAt).toISOString()})` : ''}`,
    `Feature: ${featureLabel(call.feature)} (${call.feature})`,
    `From: ${call.source}`,
    ...(call.subject.kind === '' ? [] : [`For: ${call.subject.kind} ${call.subject.id}`]),
    `Provider: ${call.provider || 'none'}`,
    `Model: ${call.model || 'none'}`,
    `Outcome: ${call.outcome}${call.kind === '' ? '' : ` (${call.kind})`}`,
    ...(call.message === '' ? [] : [`Message: ${call.message}`]),
    `Duration: ${Math.round(call.durationMs)} ms`,
    `Tokens: ${call.inputTokens ?? 'unknown'} in, ${call.outputTokens ?? 'unknown'} out`,
    `Estimated cost: ${call.costUsd === null ? 'unknown' : `$${call.costUsd.toFixed(6)}`}`,
    ...(call.summary === '' ? [] : [`Result: ${call.summary}`]),
  ]
  return lines.join('\n')
}

/**
 * Settings › AI activity: every model call Juno made, newest first, with
 * what it was for, the model, the outcome and the estimated cost. A row
 * opens to show its details and "Copy details". Filters by feature,
 * outcome and model. No prompt or answer text is kept, so none is shown.
 */
export function AiActivityPage({ activity, spend, onLimit, now, onCopyDetails }: AiActivityPageProps) {
  const [feature, setFeature] = useState(ALL)
  const [outcome, setOutcome] = useState(ALL)
  const [model, setModel] = useState(ALL)
  const [open, setOpen] = useState<string | undefined>(undefined)
  const [shown, setShown] = useState(AI_ACTIVITY_PAGE)
  const calls = activity?.calls ?? []
  const features = [...new Set(calls.map((call) => call.feature))].toSorted((a, b) => featureLabel(a).localeCompare(featureLabel(b)))
  const models = [...new Set(calls.map((call) => call.model).filter((value) => value !== ''))].toSorted()
  const outcomes = (Object.keys(OUTCOMES) as Array<AiCallOutcome>).filter((value) => calls.some((call) => call.outcome === value))
  const matching = calls.filter((call) => (feature === ALL || call.feature === feature) && (outcome === ALL || call.outcome === outcome) && (model === ALL || call.model === model))
  const rows = matching.slice(0, shown)
  return (
    <Page width="settings">
      <PageHeader title="AI activity" subtitle="Every call Juno made to a model, what it was for, and what it cost. Juno keeps the last 500 here, without what was sent or answered." />
      <SpendSections activity={activity} spend={spend} onLimit={onLimit} />
      <Section heading="Calls">
        <div {...stylex.props(styles.filters)}>
          <Select size={30} label="Feature" value={feature} onChange={(event) => setFeature(event.currentTarget.value)}
            options={[{ value: ALL, label: 'All features' }, ...features.map((value) => ({ value, label: featureLabel(value) }))]} />
          <Select size={30} label="Outcome" value={outcome} onChange={(event) => setOutcome(event.currentTarget.value)}
            options={[{ value: ALL, label: 'All outcomes' }, ...outcomes.map((value) => ({ value, label: OUTCOMES[value] }))]} />
          <Select size={30} label="Model" value={model} onChange={(event) => setModel(event.currentTarget.value)}
            options={[{ value: ALL, label: 'All models' }, ...models.map((value) => ({ value, label: value }))]} />
        </div>
        {activity === undefined ? null : rows.length === 0 ? (
          <EmptyState
            illustration="nothing-here"
            title={calls.length === 0 ? 'No calls yet' : 'No calls match'}
            body={calls.length === 0 ? 'Calls show up here as Juno titles topics, draws their art and answers you.' : 'Try another feature, outcome or model.'}
            enter={false}
          />
        ) : (
          <Surface kind="group" role="list" aria-label="AI calls">
            {rows.map((call, index) => (
              <Call key={call.id} call={call} now={now} open={open === call.id} divider={index < rows.length - 1}
                onToggle={() => setOpen(open === call.id ? undefined : call.id)} onCopyDetails={onCopyDetails} />
            ))}
          </Surface>
        )}
        {matching.length > shown ? (
          <div {...stylex.props(styles.more)}>
            <Button variant="secondary" size="md" onClick={() => setShown(shown + AI_ACTIVITY_PAGE)}>
              Show older calls
            </Button>
          </div>
        ) : null}
      </Section>
    </Page>
  )
}

/** Today's spend against the daily limit, and the field that sets the limit. */
function SpendSections({ activity, spend, onLimit }: Pick<AiActivityPageProps, 'activity' | 'spend' | 'onLimit'>) {
  return (
    <>
      <Section heading="Today">
        <Surface kind="group" padding="md" sx={styles.card}>
          <div {...stylex.props(styles.lines)}>
            <div {...stylex.props(styles.today)} data-ai-activity-today="">
              <Text variant="heading" numeric data-ai-activity-today-cost="">
                {spend === undefined ? usd(activity?.todayUsd ?? 0) : unlimited(spend) ? `${dollars(spend.spentUsd)} today` : `${dollars(spend.spentUsd)} of ${dollars(spend.limitUsd)} today`}
              </Text>
              <Text variant="meta" tone="muted" numeric>
                {spend === undefined
                  ? `Estimated, across ${activity?.todayCalls ?? 0} ${activity?.todayCalls === 1 ? 'call' : 'calls'} since midnight`
                  : `Resets at midnight. ${activity?.todayCalls ?? 0} ${activity?.todayCalls === 1 ? 'call' : 'calls'} since then.`}
              </Text>
            </div>
            {spend === undefined || unlimited(spend) ? null : spend.spentUsd >= spend.limitUsd ? (
              <Text variant="meta" tone="muted" data-ai-limit-reached="all">
                Today’s limit is reached. AI features wait until midnight or until you raise the limit.
              </Text>
            ) : spend.backgroundUsd >= spend.backgroundLimitUsd ? (
              <Text variant="meta" tone="muted" data-ai-limit-reached="background">
                {`Topic art, titles and Home have used their ${dollars(spend.backgroundLimitUsd)} for today. They wait until midnight or until you raise the limit.`}
              </Text>
            ) : null}
          </div>
        </Surface>
      </Section>
      {spend === undefined || onLimit === undefined ? null : (
        <Section heading="Daily limit" sub="Topic art, titles and Home can use up to half of it, so Juno chats always have room. Work already under way can finish.">
          <Surface kind="group">
            <ListRow
              trailing={
                <TextField
                  size={30}
                  label="Daily limit in dollars"
                  leading={
                    <Text variant="ui" tone="muted" aria-hidden>
                      $
                    </Text>
                  }
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  disabled={unlimited(spend)}
                  key={spend.capUsd}
                  defaultValue={unlimited(spend) ? '' : spend.capUsd}
                  onBlur={(event) => commitLimit(event.currentTarget.value, spend.capUsd, onLimit)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitLimit(event.currentTarget.value, spend.capUsd, onLimit)
                  }}
                  width="keyword"
                />
              }
            >
              <Text variant="body">Daily limit</Text>
            </ListRow>
            <ListRow divider={false}>
              <Checkbox size="lg" label="No limit" checked={unlimited(spend)} onChange={(event) => onLimit(event.currentTarget.checked ? NO_LIMIT_USD : DEFAULT_LIMIT_USD)} />
            </ListRow>
          </Surface>
        </Section>
      )}
    </>
  )
}

interface CallProps {
  readonly call: AiCallRow
  readonly now: number
  readonly open: boolean
  readonly divider: boolean
  readonly onToggle: () => void
  readonly onCopyDetails: (details: string) => void
}

function Call({ call, now, open, divider, onToggle, onCopyDetails }: CallProps) {
  const subject = call.subject.name || (call.subject.kind === 'chat' ? 'Juno chat' : '')
  return (
    // The row opens its details under it when clicked: growth the owner asked for.
    <div role="listitem" data-ai-call={call.outcome} data-ai-call-feature={call.feature} data-expands-in-place="">
      <ListRow
        divider={divider && !open}
        onSelect={onToggle}
        aria-expanded={open}
        trailing={
          <span {...stylex.props(cell.controls)}>
            <Text variant="meta" tone="muted" numeric>
              {call.outcome === 'ok' ? usd(call.costUsd) : ''}
            </Text>
            <Chip variant={call.outcome === 'ok' ? 'filled' : 'outline'} size={20}>
              {call.repeats > 1 ? `${OUTCOMES[call.outcome]} ×${call.repeats}` : OUTCOMES[call.outcome]}
            </Chip>
          </span>
        }
      >
        <span {...stylex.props(cell.lines)}>
          <span {...stylex.props(cell.line)}>
            <Text variant="body" truncate>
              {featureLabel(call.feature)}
            </Text>
            {subject === '' ? null : (
              <Text variant="meta" tone="muted" truncate dir="auto">
                {subject}
              </Text>
            )}
          </span>
          <span {...stylex.props(cell.line)}>
            <Text variant="meta" tone="muted" numeric as="time" title={fullTime(call.lastAt)}>
              {messageTime(call.lastAt, now)}
            </Text>
            <Text variant="meta" tone="muted" truncate>
              {call.outcome === 'ok' && call.kind === '' ? call.model : `${call.model === '' ? '' : `${call.model} · `}${kindLabel(call.kind)}`}
            </Text>
          </span>
        </span>
      </ListRow>
      {open ? (
        <ListRow divider={divider} padding="settings">
          <span {...stylex.props(cell.lines)} data-ai-call-details="">
            <span {...stylex.props(styles.details)}>
            <Detail label="Started" value={fullTime(call.at)} />
            {call.repeats > 1 ? <Detail label="Repeated" value={`${call.repeats} times, last ${fullTime(call.lastAt)}`} /> : null}
            <Detail label="Provider" value={call.provider || 'None'} />
            <Detail label="Model" value={call.model || 'None'} />
            <Detail label="Outcome" value={call.kind === '' ? OUTCOMES[call.outcome] : `${OUTCOMES[call.outcome]}: ${kindLabel(call.kind)}`} />
            {call.message === '' ? null : <Detail label="Message" value={call.message} />}
            <Detail label="Duration" value={seconds(call.durationMs)} />
            <Detail label="Tokens" value={call.inputTokens === null ? 'Unknown' : `${call.inputTokens} in, ${call.outputTokens ?? 0} out`} />
            <Detail label="Estimated cost" value={usd(call.costUsd)} />
            {call.summary === '' ? null : <Detail label="Result" value={call.summary} />}
            </span>
            <span {...stylex.props(cell.line)}>
              <Button variant="ghost" size="xs" tone="subtle" onClick={() => onCopyDetails(aiCallDetails(call))}>
                Copy details
              </Button>
            </span>
          </span>
        </ListRow>
      ) : null}
    </div>
  )
}

/** One line of the details: two cells of the details grid. */
function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <>
      <Text variant="meta" tone="muted">
        {label}
      </Text>
      <Text variant="meta" numeric sx={cell.wrap}>
        {value}
      </Text>
    </>
  )
}

const unlimited = (spend: AiSpendToday): boolean => spend.capUsd >= NO_LIMIT_USD

const styles = stylex.create({
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
  },
  // 14px in, as the other settings cards.
  card: {
    paddingInline: spacing['--space-3-5'],
  },
  today: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-2'],
    color: colors['--foreground-default'],
  },
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-2'],
  },
  details: {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    columnGap: spacing['--space-4'],
    rowGap: spacing['--space-0-5'],
    paddingBlock: spacing['--space-1'],
  },
  more: {
    display: 'flex',
    justifyContent: 'center',
  },
})
