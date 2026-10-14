import * as stylex from '@stylexjs/stylex'
import { chatCopy, type ConnectionId, type ConnectionRow, type ConnectionState, type ConnectionsPage as ConnectionsPageModel, type DiscoveredTool, type T3Address } from '@juno/agent-contract'
import { Checkbox, Chip, EmptyState, ListRow, Page, PageHeader, Section, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'

export interface ConnectionsPageProps {
  readonly page: ConnectionsPageModel
  readonly onEnabled: (id: ConnectionId, enabled: boolean) => void
  /** The T3 Code row's address settings changed. */
  readonly onT3Address: (id: ConnectionId, address: T3Address) => void
  /** Only the owner moves a tool between Read and Outward. */
  readonly onTier: (id: ConnectionId, tool: string, tier: 0 | 3) => void
}

const stateLabel: Record<ConnectionState, string> = {
  off: 'Off',
  connecting: 'Connecting',
  ready: 'Ready',
  degraded: 'Degraded',
  needsSignIn: 'Needs sign-in',
  error: 'Error',
}

/**
 * Each server's state, the address in use, and the tools it offers with
 * their tier (SPEC 13.10). The T3 Code row also holds its address and the
 * local-network switch; over the network only an https address works.
 */
export function ConnectionsPage({ page, onEnabled, onT3Address, onTier }: ConnectionsPageProps) {
  return (
    <Page>
      <PageHeader title="Connections" subtitle="Where Juno can read and act. A tool on a server's read list needs no click; everything else is a card, every time." />
      {page.connections.length === 0 ? <EmptyState illustration="nothing-here" title="No connections" body="Juno's connections show up here once they are set up." enter={false} /> : null}
      {page.connections.map((row) => (
        <Connection key={row.id} row={row} onEnabled={onEnabled} onT3Address={onT3Address} onTier={onTier} />
      ))}
    </Page>
  )
}

function Connection({ row, onEnabled, onT3Address, onTier }: { readonly row: ConnectionRow } & Pick<ConnectionsPageProps, 'onEnabled' | 'onT3Address' | 'onTier'>) {
  const copy = chatCopy.pages.settings
  const t3 = row.t3
  return (
    <Section heading={row.label} sub={row.detail}>
      <Surface kind="group" data-connection={row.state}>
        <ListRow
          trailing={
            <Chip variant={row.state === 'ready' ? 'filled' : 'outline'} size={20}>
              {stateLabel[row.state]}
            </Chip>
          }
        >
          <span {...stylex.props(cell.lines)}>
            <Checkbox size="lg" label="Enabled" checked={row.enabled} onChange={(event) => onEnabled(row.id, event.currentTarget.checked)} />
            {row.address !== undefined ? (
              <Text variant="meta" tone="muted" truncate>
                {row.address}
              </Text>
            ) : null}
          </span>
        </ListRow>
        {t3 !== undefined ? (
          <ListRow data-t3-address="">
            <span {...stylex.props(cell.field)}>
              <TextField size={32} label="T3 Code address" value={t3.url} onChange={(event) => onT3Address(row.id, { ...t3, url: event.currentTarget.value })} />
              <Checkbox size="lg" label={copy.allowNetwork} description={copy.allowNetworkNote} checked={t3.allowNetwork} onChange={(event) => onT3Address(row.id, { ...t3, allowNetwork: event.currentTarget.checked })} />
            </span>
          </ListRow>
        ) : null}
        {row.tools.map((tool, index) => (
          <Tool key={tool.name} tool={tool} last={index === row.tools.length - 1} onTier={(tier) => onTier(row.id, tool.name, tier)} />
        ))}
      </Surface>
    </Section>
  )
}

function Tool({ tool, last, onTier }: { readonly tool: DiscoveredTool; readonly last: boolean; readonly onTier: (tier: 0 | 3) => void }) {
  const read = tool.tier === 0
  return (
    <ListRow
      data-tool-tier={tool.tier}
      divider={!last}
      trailing={
        <span {...stylex.props(cell.controls)}>
          <Checkbox label="Needs no click" checked={read} onChange={(event) => onTier(event.currentTarget.checked ? 0 : 3)} />
        </span>
      }
    >
      <span {...stylex.props(cell.lines)}>
        <span {...stylex.props(cell.line)}>
          <Text variant="body" truncate>
            {tool.name}
          </Text>
          <Chip variant={read ? 'filled' : 'outline'} size={18}>
            {read ? 'Read' : 'Asks every time'}
          </Chip>
          {tool.allowlisted ? (
            <Chip variant="quiet" size={18}>
              Default
            </Chip>
          ) : null}
        </span>
        {tool.hint !== undefined ? (
          <Text variant="meta" tone="muted" truncate dir="auto">
            {tool.hint}
          </Text>
        ) : null}
        {tool.changed ? (
          <Text variant="meta" tone="muted" sx={cell.wrap}>
            This tool changed since you reviewed it, so it asks every time until you check it again.
          </Text>
        ) : null}
      </span>
    </ListRow>
  )
}
