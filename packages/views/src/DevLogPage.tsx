import * as stylex from '@stylexjs/stylex'
import { memo } from 'react'
import type { DevLogDetail, DevLogRow } from '@juno/contract'
import { colors, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, focusRing, ScrollArea, Segmented, Text, TextField } from '@juno/ui'

/** The kind filter: one kind, every kind, or only what failed. */
export type DevLogKindFilter = 'all' | 'slack' | 'socket' | 'sync' | 'errors'

const kindOptions: ReadonlyArray<{ readonly value: DevLogKindFilter; readonly label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'slack', label: 'Slack calls' },
  { value: 'socket', label: 'Socket' },
  { value: 'sync', label: 'Sync' },
  { value: 'errors', label: 'Errors' },
]

export interface DevLogPageProps {
  /** Newest first. */
  readonly rows: ReadonlyArray<DevLogRow>
  /** Entries that match the filters, shown or not. Undefined until the first answer. */
  readonly total: number | undefined
  readonly kind: DevLogKindFilter
  readonly onKind: (kind: DevLogKindFilter) => void
  readonly text: string
  readonly onText: (text: string) => void
  /** The list holds still; new entries are counted, not shown. */
  readonly paused: boolean
  readonly onPause: (paused: boolean) => void
  readonly expanded: string | undefined
  readonly onToggle: (id: string) => void
  /** The expanded entry; undefined while it loads, null once it has left the buffer. */
  readonly detail: DevLogDetail | null | undefined
  readonly onCopy: (text: string) => void
  /** "Copied" after a copy. */
  readonly copied?: string | undefined
  /** More entries match than are shown: the button at the end asks for them. */
  readonly onShowMore?: (() => void) | undefined
}

const two = (value: number) => String(value).padStart(2, '0')

/** "14:03:07.412": local time to the millisecond. */
export function clockMillis(at: number): string {
  const date = new Date(at)
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

const duration = (ms: number | null): string => (ms === null ? '' : ms < 10 ? `${ms.toFixed(1)} ms` : ms < 10_000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

/** The entry as plain text, for Copy. */
export function devLogText(detail: DevLogDetail): string {
  const { row } = detail
  const head = [`${new Date(row.at).toISOString()} ${row.kind} ${row.name}`, row.context, duration(row.durationMs), row.outcome].filter((part) => part !== '').join('  ')
  const sections = detail.sections.map((section) => [section.title, ...section.lines.map((line) => `  ${line.label}: ${line.value}`)].join('\n'))
  return [head, ...sections].join('\n')
}

/**
 * The developer log: what the engine is doing now, newest first. Each row
 * is one Slack call, socket event or sync step; a click opens its params,
 * timing and response summary. Shown only to whoever opens it from ⌘K; the
 * entries live in the engine's memory and are never saved or sent.
 */
export function DevLogPage(props: DevLogPageProps) {
  const { rows, total, kind, onKind, text, onText, paused, onPause, expanded, onToggle, detail, onCopy, copied, onShowMore } = props
  return (
    <div {...stylex.props(styles.page)} data-dev-log="">
      <div {...stylex.props(styles.toolbar)}>
        <Text variant="heading" as="h1">
          Developer log
        </Text>
        <Segmented label="Kind" options={kindOptions} value={kind} onChange={onKind} />
        <TextField size={30} width="search" label="Filter" placeholder="Filter" value={text} onChange={(event) => onText(event.currentTarget.value)} />
        <Button variant="secondary" size="sm" pressed={paused} onClick={() => onPause(!paused)}>
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Text variant="meta" tone="muted" numeric sx={styles.count}>
          {total === undefined ? '' : `${rows.length === total ? total : `${rows.length} of ${total}`} ${total === 1 ? 'entry' : 'entries'} · in memory only`}
        </Text>
      </div>
      <ScrollArea sx={styles.list} role="list" aria-label="Developer log entries">
        {total === 0 ? (
          <Text variant="meta" tone="muted" sx={styles.empty}>
            {kind === 'all' && text === '' ? 'Nothing yet. Slack calls, socket events and sync steps show here as they happen.' : 'Nothing matches.'}
          </Text>
        ) : null}
        {rows.map((row) => (
          <div key={row.id} role="listitem" {...stylex.props(styles.item, expanded !== row.id && styles.closed)}>
            <Entry row={row} open={expanded === row.id} onToggle={onToggle} />
            {expanded === row.id ? <Detail detail={detail} onCopy={onCopy} copied={copied} /> : null}
          </div>
        ))}
        {onShowMore === undefined ? null : (
          <div {...stylex.props(styles.more)}>
            <Button variant="ghost" size="sm" onClick={onShowMore}>
              Show older entries
            </Button>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

const kindLabels: Record<DevLogRow['kind'], string> = { slack: 'slack', socket: 'socket', sync: 'sync' }

const Entry = memo(function Entry({ row, open, onToggle }: { readonly row: DevLogRow; readonly open: boolean; readonly onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      data-dev-log-row={row.kind}
      data-dev-log-name={row.name}
      onClick={() => onToggle(row.id)}
      {...stylex.props(styles.row, focusRing.inset, open && styles.rowOpen)}
    >
      <Text variant="code" tone="muted" numeric truncate>
        {clockMillis(row.at)}
      </Text>
      <Text variant="meta" tone="muted" truncate>
        {kindLabels[row.kind]}
      </Text>
      <Text variant="code" truncate>
        {row.name}
      </Text>
      <Text variant="meta" tone="muted" truncate>
        {row.context}
      </Text>
      <Text variant="code" tone="muted" numeric truncate sx={styles.end}>
        {duration(row.durationMs)}
      </Text>
      <Text variant="meta" tone={row.failed ? 'danger' : row.outcome === 'ok' ? 'muted' : 'secondary'} truncate>
        {row.outcome}
      </Text>
    </button>
  )
})

function Detail({ detail, onCopy, copied }: { readonly detail: DevLogDetail | null | undefined; readonly onCopy: (text: string) => void; readonly copied: string | undefined }) {
  if (detail === undefined) return <div {...stylex.props(styles.detail)} />
  if (detail === null) {
    return (
      <div {...stylex.props(styles.detail)}>
        <Text variant="meta" tone="muted">
          This entry has left the log.
        </Text>
      </div>
    )
  }
  return (
    <div {...stylex.props(styles.detail)} data-dev-log-detail="">
      {detail.sections.map((section) => (
        <div key={section.title} {...stylex.props(styles.section)}>
          <Text variant="sectionLabel" tone="muted">
            {section.title}
          </Text>
          <div {...stylex.props(styles.lines)}>
            {section.lines.map((line, index) => (
              <div key={index} {...stylex.props(styles.line)}>
                <Text variant="code" tone="muted" truncate>
                  {line.label}
                </Text>
                <Text variant="code" sx={styles.value}>
                  {line.value}
                </Text>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div {...stylex.props(styles.actions)}>
        <Button variant="ghost" size="xs" tone="subtle" onClick={() => onCopy(devLogText(detail))}>
          Copy entry
        </Button>
        {copied === undefined ? null : (
          <Text variant="meta" tone="muted" role="status">
            {copied}
          </Text>
        )}
      </div>
    </div>
  )
}

/** A closed row's height, exact: its line and its padding. */
const ROW_ESTIMATE = `auto calc(${sizes['--control-20']} + 2 * ${spacing['--space-0-5']})`

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 0,
    minWidth: 0,
    backgroundColor: colors['--background'],
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing['--space-2'],
    paddingBlock: spacing['--space-3'],
    paddingInline: spacing['--space-4'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  count: {
    marginInlineStart: 'auto',
  },
  list: {
    flexGrow: 1,
    paddingBlock: spacing['--space-1'],
  },
  empty: {
    display: 'block',
    padding: spacing['--space-4'],
  },
  item: {
    contain: 'content',
  },
  // Closed rows off screen are skipped until they scroll near, so 2,000 entries draw as fast as 50.
  closed: {
    contentVisibility: 'auto',
    containIntrinsicSize: ROW_ESTIMATE,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: `max-content ${sizes['--control-44']} minmax(0, 2fr) minmax(0, 1.4fr) ${sizes['--topic-time-width']} minmax(0, 1.4fr)`,
    alignItems: 'center',
    columnGap: spacing['--space-3'],
    width: '100%',
    height: `calc(${sizes['--control-20']} + 2 * ${spacing['--space-0-5']})`,
    margin: 0,
    paddingBlock: spacing['--space-0-5'],
    paddingInline: spacing['--space-4'],
    borderWidth: 0,
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
  rowOpen: {
    backgroundColor: colors['--surface-active'],
  },
  end: {
    textAlign: 'end',
  },
  detail: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-4'],
    backgroundColor: colors['--background-subtle'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
    userSelect: 'text',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
  },
  line: {
    display: 'grid',
    gridTemplateColumns: `minmax(0, 12rem) minmax(0, 1fr)`, // tokens-allow: label column of a dense key-value list
    columnGap: spacing['--space-3'],
  },
  value: {
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
  },
  more: {
    display: 'flex',
    justifyContent: 'center',
    paddingBlock: spacing['--space-2'],
  },
})
