import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { chatCopy, type ConnectionId, type ConnectionRow, type ConnectionState, type ConnectionsPage as ConnectionsPageModel, type DiscoveredTool, type T3Address } from '@juno/agent-contract'
import { Button, Checkbox, Chip, EmptyState, ListRow, Page, PageHeader, Section, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'

export type ConnectionAction = 'connect' | 'disconnect' | 'remove'

export interface ConnectionsPageProps {
  readonly page: ConnectionsPageModel
  /** A command the agent refused, shown under that row, or under Add a server for `new`. */
  readonly error?: { readonly id: ConnectionId | 'new'; readonly message: string }
  readonly onEnabled: (id: ConnectionId, enabled: boolean) => void
  /** Connect (or Sign in) opens the server's sign-in in the browser when it asks for one. Disconnect forgets the sign-in. */
  readonly onAction: (id: ConnectionId, action: ConnectionAction) => void
  /** The T3 Code row's address settings, on Enter, on leaving the field, or on the switch. */
  readonly onT3Address: (id: ConnectionId, address: T3Address) => void
  /** Only the owner moves a tool between Read and Outward. */
  readonly onTier: (id: ConnectionId, tool: string, tier: 0 | 3) => void
  /** Another server by address. */
  readonly onAdd: (label: string, url: string) => void
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
 * Below the servers, the owner adds another one by its address.
 */
export function ConnectionsPage({ page, error, onEnabled, onAction, onT3Address, onTier, onAdd }: ConnectionsPageProps) {
  return (
    <Page width="settings">
      <PageHeader title="Connections" subtitle="Where Juno can read and act. Tools that run without asking need no click; everything else asks with a card." />
      {page.connections.length === 0 ? <EmptyState illustration="nothing-here" title="No connections" body="Juno's connections show up here once they are set up." enter={false} /> : null}
      {page.connections.map((row) => (
        <Connection key={row.id} row={row} error={error?.id === row.id ? error.message : undefined} onEnabled={onEnabled} onAction={onAction} onT3Address={onT3Address} onTier={onTier} />
      ))}
      <AddServer error={error?.id === 'new' ? error.message : undefined} onAdd={onAdd} />
    </Page>
  )
}

function primaryAction(row: ConnectionRow): { readonly action: ConnectionAction; readonly label: string } {
  const copy = chatCopy.pages.connections
  switch (row.state) {
    case 'needsSignIn':
      return { action: 'connect', label: copy.signIn }
    case 'connecting':
      return { action: 'disconnect', label: copy.cancel }
    case 'off':
      return { action: 'connect', label: copy.connect }
    default:
      return { action: 'disconnect', label: copy.disconnect }
  }
}

function Connection({ row, error, onEnabled, onAction, onT3Address, onTier }: { readonly row: ConnectionRow; readonly error: string | undefined } & Pick<ConnectionsPageProps, 'onEnabled' | 'onAction' | 'onT3Address' | 'onTier'>) {
  const copy = chatCopy.pages.connections
  const primary = primaryAction(row)
  const signingIn = row.state === 'connecting' && !row.enabled
  return (
    <Section heading={row.label} sub={row.detail}>
      <Surface kind="group" data-connection={row.state} data-connection-id={row.id}>
        {/* A divider only when a row follows: a server with no tools yet is one row, with no line over the card's edge. */}
        <ListRow
          divider={row.t3 !== undefined || row.tools.length > 0}
          trailing={
            <span {...stylex.props(cell.controls)}>
              <Chip variant={row.state === 'ready' ? 'filled' : 'outline'} size={20}>
                {stateLabel[row.state]}
              </Chip>
              {row.removable ? (
                <Button variant="ghost" size="xs" tone="subtle" onClick={() => onAction(row.id, 'remove')}>
                  {copy.remove}
                </Button>
              ) : null}
              <Button variant="secondary" size="xs" onClick={() => onAction(row.id, primary.action)}>
                {primary.label}
              </Button>
            </span>
          }
        >
          <span {...stylex.props(cell.lines)}>
            <Checkbox size="lg" label="Enabled" checked={row.enabled} onChange={(event) => onEnabled(row.id, event.currentTarget.checked)} />
            {row.address !== undefined ? (
              <Text variant="meta" tone="muted" truncate>
                {row.address}
              </Text>
            ) : null}
            {signingIn ? (
              <Text variant="meta" tone="muted">
                {copy.signingIn}
              </Text>
            ) : null}
            {error !== undefined ? (
              <Text variant="meta" tone="danger" data-connection-error="">
                {error}
              </Text>
            ) : null}
          </span>
        </ListRow>
        {row.t3 !== undefined ? <T3AddressRow key={`${row.t3.url} ${row.t3.allowNetwork}`} id={row.id} address={row.t3} onT3Address={onT3Address} /> : null}
        {row.tools.map((tool, index) => (
          <Tool key={tool.name} tool={tool} last={index === row.tools.length - 1} onTier={(tier) => onTier(row.id, tool.name, tier)} />
        ))}
      </Surface>
    </Section>
  )
}

/** Keyed by the saved address, so a saved change resets the draft. */
function T3AddressRow({ id, address, onT3Address }: { readonly id: ConnectionId; readonly address: T3Address } & Pick<ConnectionsPageProps, 'onT3Address'>) {
  const copy = chatCopy.pages
  const [url, setUrl] = useState(address.url)
  const commit = () => {
    if (url.trim() !== address.url) onT3Address(id, { ...address, url: url.trim() })
  }
  return (
    <ListRow data-t3-address="">
      <span {...stylex.props(cell.field)}>
        <TextField
          size={32}
          label={copy.connections.t3Address}
          type="url"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
          onBlur={commit}
        />
        <Checkbox
          size="lg"
          label={copy.settings.allowNetwork}
          description={copy.settings.allowNetworkNote}
          checked={address.allowNetwork}
          onChange={(event) => onT3Address(id, { url: url.trim(), allowNetwork: event.currentTarget.checked })}
        />
      </span>
    </ListRow>
  )
}

function AddServer({ error, onAdd }: { readonly error: string | undefined } & Pick<ConnectionsPageProps, 'onAdd'>) {
  const copy = chatCopy.pages.connections
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const canAdd = url.trim() !== ''
  const add = () => {
    if (!canAdd) return
    onAdd(label.trim(), url.trim())
    setLabel('')
    setUrl('')
  }
  const keyDown = (event: { readonly key: string }) => {
    if (event.key === 'Enter') add()
  }
  return (
    <Section heading={copy.add} sub={copy.addSub}>
      <Surface kind="group" data-add-server="">
        <ListRow divider={false}>
          <span {...stylex.props(cell.field)}>
            <TextField size={32} label={copy.name} placeholder={copy.name} value={label} onChange={(event) => setLabel(event.currentTarget.value)} onKeyDown={keyDown} />
            <TextField
              size={32}
              label={copy.address}
              type="url"
              placeholder="https://mcp.example.com/mcp"
              value={url}
              invalid={error !== undefined}
              onChange={(event) => setUrl(event.currentTarget.value)}
              onKeyDown={keyDown}
            />
            {/* The action ends the form, at the card's trailing inset with every other button on the page; a refusal reads before it. */}
            <span {...stylex.props(cell.line, styles.addLine)}>
              {error !== undefined ? (
                <Text variant="meta" tone="danger" data-connection-error="" sx={styles.addError}>
                  {error}
                </Text>
              ) : null}
              <Button variant="secondary" size="xs" onClick={add} disabled={!canAdd}>
                {copy.addButton}
              </Button>
            </span>
          </span>
        </ListRow>
      </Surface>
    </Section>
  )
}

function Tool({ tool, last, onTier }: { readonly tool: DiscoveredTool; readonly last: boolean; readonly onTier: (tier: 0 | 3) => void }) {
  const read = tool.tier === 0
  return (
    <ListRow
      data-tool={tool.name}
      data-tool-tier={tool.tier}
      divider={!last}
      trailing={
        <span {...stylex.props(cell.controls)}>
          <Checkbox label="Runs without asking" checked={read} onChange={(event) => onTier(event.currentTarget.checked ? 0 : 3)} />
        </span>
      }
    >
      <span {...stylex.props(cell.lines)}>
        <span {...stylex.props(cell.line)}>
          <Text variant="body" truncate>
            {tool.name}
          </Text>
          {tool.allowlisted && !read ? (
            <Text variant="meta" tone="muted">
              Default
            </Text>
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

const styles = stylex.create({
  addLine: {
    justifyContent: 'flex-end',
  },
  addError: {
    flexGrow: 1,
    minWidth: 0,
  },
})
