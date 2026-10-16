import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { chatCopy, type ConnectionId, type ConnectionRow, type DiscoveredTool, type ReviewRule, type T3Address } from '@juno/agent-contract'
import { colors, layout, spacing, text } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, Chip, revealFocus, ringRoom, Select, Surface, Text, TextField } from '@juno/ui'
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
 * column says Read. A delete, and T3 Code's other tools, always ask, and a
 * tool that merges, buys or force-pushes is not offered; each says why. A
 * changed or new tool is marked. A panel for `SheetLayer`; the Settings page
 * can host it the same way.
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
          <Button variant="secondary" size="sm" onClick={onClose}>
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
        {/* Like a macOS sheet with a list, typing goes straight to the search box. */}
        <TextField
          size={32}
          leadingIcon={MagnifyingGlass}
          label={copy.search}
          placeholder={copy.search}
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
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
          <div onFocus={revealFocus} {...stylex.props(styles.body, ringRoom.inline)}>
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
  // A read runs with no review; a delete and T3 Code's other tools always ask; a forbidden tool is never offered.
  const fixed = tool.read ? 'read' : tool.locked === 'forbidden' ? 'forbidden' : tool.locked === 'delete' || t3 ? 'always' : undefined
  const mark = tool.changed ? 'changed' : tool.added ? 'new' : undefined
  return (
    <div
      {...stylex.props(styles.row, styles.tool)}
      role="row"
      data-tool={tool.name}
      data-tool-enabled={tool.enabled}
      data-tool-review={fixed ?? tool.review}
      data-tool-mark={mark}
      data-tool-read-only={tool.readOnly}
    >
      <span {...stylex.props(cell.lines, styles.toolLines)} role="cell">
        {/* A New or Changed mark is a tag after the name, as a server's state is on Connections: outline when it asks for a look. */}
        <span {...stylex.props(cell.line)}>
          <Text variant="bodySmall" weight="medium" truncate sx={styles.toolName}>
            {tool.name}
          </Text>
          {mark !== undefined ? (
            <Chip variant={mark === 'changed' ? 'outline' : 'filled'} size={20} data-tool-tag="">
              {mark === 'changed' ? copy.changed : copy.added}
            </Chip>
          ) : null}
        </span>
        {tool.hint !== undefined ? (
          <Text variant="meta" tone="muted" truncate dir="auto" sx={styles.toolMeta}>
            {tool.hint}
          </Text>
        ) : null}
        {tool.locked !== undefined ? (
          <Text variant="meta" tone="muted" sx={[cell.wrap, styles.toolMeta]}>
            {copy.locked[tool.locked]}
          </Text>
        ) : null}
      </span>
      <span role="cell" {...stylex.props(styles.center)}>
        <Checkbox
          labelHidden
          label={`${copy.enabled}: ${tool.name}`}
          checked={tool.enabled && fixed !== 'forbidden'}
          disabled={fixed === 'forbidden'}
          onChange={(event) => onTool({ enabled: event.currentTarget.checked })}
        />
      </span>
      <span role="cell">
        {fixed !== undefined ? (
          <Text variant="bodySmall" tone="muted">
            {fixed === 'read' ? copy.read : fixed === 'forbidden' ? copy.notOffered : copy.rules.always}
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
    // A fixed height, so the sheet keeps its size while a search narrows the
    // list: seven whole rows, so at rest the list ends on a row's edge.
    height: `calc(7 * ${layout['--tool-row-height']})`,
    alignContent: 'start',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  // 56px rows on the 4px grid. The rule is above each row, after the
  // header's, so none sits on the list's bottom edge over the sheet's padding.
  // The rule is an inset hairline, not a border, so it takes no height:
  // 10 + 20 + 16 + 10, and the two lines sit on whole pixels.
  tool: {
    boxSizing: 'border-box',
    minHeight: layout['--tool-row-height'],
    paddingBlock: spacing['--space-2-5'],
    boxShadow: {
      default: `inset 0 1px 0 ${colors['--border-subtle']}`, // tokens-allow: A 1px hairline rule, drawn as an inset shadow so it takes no height.
      ':first-child': 'none',
    },
  },
  toolLines: {
    gap: 0,
  },
  toolName: {
    lineHeight: text['--text-option-title-leading'],
  },
  toolMeta: {
    lineHeight: text['--text-option-meta-leading'],
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
