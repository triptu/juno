import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { chatCopy, type ConnectionId, type ConnectionRow, type ConnectionState, type ConnectionsPage as ConnectionsPageModel, type T3Address } from '@juno/agent-contract'
import { Button, Checkbox, Chip, EmptyState, ListRow, Page, PageHeader, Section, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'

export type ConnectionAction = 'connect' | 'disconnect' | 'remove'

export interface ConnectionsPageProps {
  readonly page: ConnectionsPageModel
  /** A command the agent refused, shown under that row, or under Add a server for `new`. */
  readonly error?: { readonly id: ConnectionId | 'new'; readonly message: string }
  /** Connect (or Sign in) opens the server's sign-in in the browser when it asks for one. Disconnect forgets the sign-in. */
  readonly onAction: (id: ConnectionId, action: ConnectionAction) => void
  /** Opens the connection's tools and auto-review rules (`ConnectionToolsSheet`). */
  readonly onConfigure: (id: ConnectionId) => void
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
 * Each server as one compact row (SPEC 13.10): its name and state, the
 * address in use, Connect, Sign in or Disconnect, and Configure, which opens
 * its tools with their Enabled switches and auto-review rules. Below the
 * servers, the owner adds another one by its address.
 */
export function ConnectionsPage({ page, error, onAction, onConfigure, onAdd }: ConnectionsPageProps) {
  const copy = chatCopy.pages.connections
  return (
    <Page>
      <PageHeader title="Connections" subtitle={copy.intro} />
      {page.connections.length === 0 ? (
        <EmptyState illustration="nothing-here" title="No connections" body="Juno's connections show up here once they are set up." enter={false} />
      ) : (
        <Surface kind="group" data-connections="">
          {page.connections.map((row, index) => (
            <Connection
              key={row.id}
              row={row}
              last={index === page.connections.length - 1}
              error={error?.id === row.id ? error.message : undefined}
              onAction={onAction}
              onConfigure={onConfigure}
            />
          ))}
        </Surface>
      )}
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

function Connection({ row, last, error, onAction, onConfigure }: { readonly row: ConnectionRow; readonly last: boolean; readonly error: string | undefined } & Pick<ConnectionsPageProps, 'onAction' | 'onConfigure'>) {
  const copy = chatCopy.pages.connections
  const primary = primaryAction(row)
  const signingIn = row.state === 'connecting' && !row.enabled
  return (
    <ListRow
      data-connection={row.state}
      data-connection-id={row.id}
      divider={!last}
      trailing={
        <span {...stylex.props(cell.controls)}>
          {row.removable ? (
            <Button variant="ghost" size="xs" tone="subtle" onClick={() => onAction(row.id, 'remove')}>
              {copy.remove}
            </Button>
          ) : null}
          <Button variant="secondary" size="xs" onClick={() => onAction(row.id, primary.action)}>
            {primary.label}
          </Button>
          <Button variant="secondary" size="xs" onClick={() => onConfigure(row.id)}>
            {copy.configure}
          </Button>
        </span>
      }
    >
      <span {...stylex.props(cell.lines)}>
        <span {...stylex.props(cell.line)}>
          <Text variant="body" weight="medium" truncate data-connection-name="">
            {row.label}
          </Text>
          <Chip variant={row.state === 'ready' ? 'filled' : 'outline'} size={20}>
            {stateLabel[row.state]}
          </Chip>
        </span>
        {row.address !== undefined ? (
          <Text variant="meta" tone="muted" truncate>
            {row.address}
          </Text>
        ) : null}
        {row.detail !== undefined ? (
          <Text variant="meta" tone="muted" sx={cell.wrap}>
            {row.detail}
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
  )
}

/** Keyed by the saved address, so a saved change resets the draft. */
export function T3AddressRow({ id, address, onT3Address }: { readonly id: ConnectionId; readonly address: T3Address; readonly onT3Address: (id: ConnectionId, address: T3Address) => void }) {
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

const styles = stylex.create({
  addLine: {
    justifyContent: 'flex-end',
  },
  addError: {
    flexGrow: 1,
    minWidth: 0,
  },
})
