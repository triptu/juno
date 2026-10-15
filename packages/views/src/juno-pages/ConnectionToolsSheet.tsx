import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { chatCopy, type ConnectionId, type ConnectionRow, type DiscoveredTool, type ReviewRule, type T3Address } from '@juno/agent-contract'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, Select, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'
import { T3AddressRow } from './ConnectionsPage'

export interface ConnectionToolsSheetProps {
  readonly row: ConnectionRow
  /** A command the agent refused, in plain words. */
  readonly error?: string
  /** One tool's Enabled switch, or its auto-review rule. */
  readonly onTool: (tool: string, change: { readonly enabled?: boolean; readonly review?: ReviewRule }) => void
  /** The connection's own rule, for tools that have none. */
  readonly onRule: (review: ReviewRule) => void
  /** The T3 Code row's address settings. */
  readonly onT3Address: (id: ConnectionId, address: T3Address) => void
  readonly onClose: () => void
  /** The search box's first text; the gallery shows a search with it. */
  readonly initialQuery?: string
}

const RULES: ReadonlyArray<ReviewRule> = ['auto', 'always', 'never']

/**
 * Configure on a connection (SPEC 13.10, 13.9): the connection's auto-review
 * rule, then every tool it offers with a search box, an Enabled switch (all
 * on by default) and its own rule. A read runs with no review, so its rule
 * column says Read. T3 Code's other tools always ask, because they can start
 * or steer a session. A panel for `SheetLayer`; the Settings page can host it
 * the same way.
 */
export function ConnectionToolsSheet({ row, error, onTool, onRule, onT3Address, onClose, initialQuery = '' }: ConnectionToolsSheetProps) {
  const copy = chatCopy.pages.connections
  const [query, setQuery] = useState(initialQuery)
  const t3 = row.t3 !== undefined
  const needle = query.trim().toLowerCase()
  const tools = needle === '' ? row.tools : row.tools.filter((tool) => `${tool.name}\n${tool.hint ?? ''}`.toLowerCase().includes(needle))
  const options = RULES.map((rule) => ({ value: rule, label: copy.rules[rule] }))
  return (
    <Surface kind="popover" as="section" role="dialog" aria-label={copy.tools(row.label)} aria-modal padding="none" sx={styles.sheet} data-sheet="tools" data-connection-id={row.id}>
      <div {...stylex.props(styles.inner)}>
        <span {...stylex.props(cell.line, styles.head)}>
          <Text variant="heading" tone="default" as="h2" truncate>
            {copy.tools(row.label)}
          </Text>
          <Button variant="secondary" size="sm" onClick={onClose} autoFocus>
            {copy.done}
          </Button>
        </span>
        {row.t3 !== undefined ? (
          <Surface kind="group">
            <T3AddressRow key={`${row.t3.url} ${row.t3.allowNetwork}`} id={row.id} address={row.t3} onT3Address={onT3Address} />
          </Surface>
        ) : (
          <span {...stylex.props(cell.line, styles.rule)} data-connection-rule="">
            <span {...stylex.props(cell.lines, styles.grow)}>
              <Text variant="body" weight="medium">
                {copy.connectionRule}
              </Text>
              <Text variant="meta" tone="muted" sx={cell.wrap}>
                {copy.connectionRuleNote}
              </Text>
            </span>
            <Select size={30} label={copy.connectionRule} options={options} value={row.review} onChange={(event) => onRule(event.currentTarget.value as ReviewRule)} />
          </span>
        )}
        {error !== undefined ? (
          <Text variant="meta" tone="danger" data-connection-error="">
            {error}
          </Text>
        ) : null}
        <TextField size={32} leadingIcon={MagnifyingGlass} label={copy.search} placeholder={copy.search} type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <div {...stylex.props(styles.table)} role="table" aria-label={copy.tools(row.label)}>
          <div {...stylex.props(styles.row, styles.header)} role="row">
            <Text variant="meta" tone="muted" role="columnheader">
              {copy.tool}
            </Text>
            <Text variant="meta" tone="muted" role="columnheader">
              {copy.enabled}
            </Text>
            <Text variant="meta" tone="muted" role="columnheader">
              {copy.autoReview}
            </Text>
          </div>
          <div {...stylex.props(styles.body)}>
            {tools.map((tool) => (
              <Tool key={tool.name} tool={tool} t3={t3} options={options} onTool={(change) => onTool(tool.name, change)} />
            ))}
            {tools.length === 0 ? (
              <Text variant="bodySmall" tone="muted" as="p" sx={styles.empty}>
                {row.tools.length === 0 ? copy.noTools : copy.noMatch}
              </Text>
            ) : null}
          </div>
        </div>
      </div>
    </Surface>
  )
}

function Tool({ tool, t3, options, onTool }: {
  readonly tool: DiscoveredTool
  readonly t3: boolean
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>
  readonly onTool: ConnectionToolsSheetProps['onTool'] extends (tool: string, change: infer C) => void ? (change: C) => void : never
}) {
  const copy = chatCopy.pages.connections
  // A read runs with no review; T3 Code's other tools always ask.
  const fixed = tool.read ? copy.read : t3 ? copy.rules.always : undefined
  return (
    <div {...stylex.props(styles.row, styles.tool)} role="row" data-tool={tool.name} data-tool-enabled={tool.enabled} data-tool-review={fixed === undefined ? tool.review : tool.read ? 'read' : 'always'}>
      <span {...stylex.props(cell.lines)} role="cell">
        <Text variant="bodySmall" weight="medium" truncate>
          {tool.name}
        </Text>
        {tool.hint !== undefined ? (
          <Text variant="meta" tone="muted" truncate dir="auto">
            {tool.hint}
          </Text>
        ) : null}
        {tool.changed ? (
          <Text variant="meta" tone="muted">
            {copy.changed}
          </Text>
        ) : null}
      </span>
      <span role="cell" {...stylex.props(styles.center)}>
        <Checkbox labelHidden label={`${copy.enabled}: ${tool.name}`} checked={tool.enabled} onChange={(event) => onTool({ enabled: event.currentTarget.checked })} />
      </span>
      <span role="cell">
        {fixed !== undefined ? (
          <Text variant="bodySmall" tone="muted">
            {fixed}
          </Text>
        ) : (
          <Select size={30} label={`${copy.autoReview}: ${tool.name}`} options={options} value={tool.review} disabled={!tool.enabled} onChange={(event) => onTool({ review: event.currentTarget.value as ReviewRule })} />
        )}
      </span>
    </div>
  )
}

const styles = stylex.create({
  sheet: {
    width: '100%',
    maxWidth: layout['--palette-width'],
    boxSizing: 'border-box',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-4'],
    padding: spacing['--space-5'],
    minWidth: 0,
  },
  head: {
    justifyContent: 'space-between',
  },
  rule: {
    alignItems: 'flex-start',
    gap: spacing['--space-4'],
  },
  grow: {
    flexGrow: 1,
  },
  // One grid for the header and every row, so the columns line up: the tool takes what is left.
  table: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    columnGap: spacing['--space-4'],
    minWidth: 0,
  },
  row: {
    display: 'grid',
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    alignItems: 'center',
    minWidth: 0,
  },
  header: {
    paddingBlockEnd: spacing['--space-1-5'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
    userSelect: 'none',
  },
  body: {
    display: 'grid',
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    maxHeight: layout['--palette-list-max-height'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  tool: {
    paddingBlock: spacing['--space-2'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: {
      default: colors['--border-subtle'],
      ':last-child': 'transparent',
    },
  },
  center: {
    display: 'flex',
    justifyContent: 'center',
  },
  empty: {
    gridColumn: '1 / -1',
    paddingBlock: spacing['--space-4'],
    textAlign: 'center',
  },
})
