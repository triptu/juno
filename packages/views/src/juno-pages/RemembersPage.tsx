import * as stylex from '@stylexjs/stylex'
import { chatCopy, type PinId, type PinRow, type RemembersPage as RemembersPageModel } from '@juno/agent-contract'
import { Button, EmptyState, ListRow, Page, PageHeader, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'
import { fullTime, messageTime } from '../time'

export interface RemembersPageProps {
  readonly page: RemembersPageModel
  readonly now: number
  /** The pin under edit and its draft. The draft is the renderer's. */
  readonly editing?: { readonly id: PinId; readonly draft: string }
  readonly onEditStart: (id: PinId) => void
  readonly onDraftChange: (draft: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
  readonly onRemove: (id: PinId) => void
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`

/**
 * The pins (SPEC 13.8): the owner's exact words, editable; an edit
 * replaces the pin with the owner's words. The page says when the active
 * budget is full, and when a pin changed under an open edit.
 */
export function RemembersPage({ page, now, editing, onEditStart, onDraftChange, onSave, onCancel, onRemove }: RemembersPageProps) {
  const full = page.usedBytes >= page.budgetBytes
  const copy = chatCopy.pages.remembers
  return (
    <Page>
      <PageHeader title="What Juno remembers" subtitle={`Lines you asked Juno to keep, in your words. ${kb(page.usedBytes)} of ${kb(page.budgetBytes)} used.`} />
      {full ? (
        <Text variant="preview" tone="muted" as="p" data-remembers-full="">
          {copy.full}
        </Text>
      ) : null}
      {page.pins.length === 0 ? (
        <EmptyState illustration="nothing-here" title="Nothing pinned yet" body='Say "remember that …" in the chat, or choose Remember this on one of your messages.' enter={false} />
      ) : (
        <Surface kind="group" role="list" aria-label="Pins">
          {page.pins.map((pin, index) => (
            <Row key={pin.id} pin={pin} now={now} last={index === page.pins.length - 1} editing={editing?.id === pin.id ? editing.draft : undefined} onEditStart={onEditStart} onDraftChange={onDraftChange} onSave={onSave} onCancel={onCancel} onRemove={onRemove} />
          ))}
        </Surface>
      )}
    </Page>
  )
}

function Row({
  pin,
  now,
  last,
  editing,
  onEditStart,
  onDraftChange,
  onSave,
  onCancel,
  onRemove,
}: { readonly pin: PinRow; readonly now: number; readonly last: boolean; readonly editing: string | undefined } & Pick<RemembersPageProps, 'onEditStart' | 'onDraftChange' | 'onSave' | 'onCancel' | 'onRemove'>) {
  if (editing !== undefined) {
    return (
      <ListRow role="listitem" data-pin="editing" divider={!last}>
        <span {...stylex.props(cell.field)}>
          <TextField size={32} label="Pin" value={editing} onChange={(event) => onDraftChange(event.currentTarget.value)} dir="auto" />
          {pin.changed ? (
            <Text variant="meta" tone="muted" data-pin-changed="">
              {chatCopy.pages.remembers.changed}
            </Text>
          ) : null}
          <span {...stylex.props(cell.controls)}>
            <Button variant="secondary" size="sm" onClick={onSave} dimmed={editing.trim().length === 0}>
              Save
            </Button>
            <Button variant="ghost" size="sm" tone="subtle" onClick={onCancel}>
              Cancel
            </Button>
          </span>
        </span>
      </ListRow>
    )
  }
  return (
    <ListRow
      role="listitem"
      data-pin="pinned"
      divider={!last}
      trailing={
        <span {...stylex.props(cell.controls)}>
          <Button variant="ghost" size="xs" tone="subtle" onClick={() => onEditStart(pin.id)}>
            Edit
          </Button>
          <Button variant="ghost" size="xs" tone="subtle" onClick={() => onRemove(pin.id)}>
            Remove
          </Button>
        </span>
      }
    >
      <span {...stylex.props(cell.lines)}>
        <Text variant="body" selectable dir="auto" sx={cell.wrap}>
          {pin.text}
        </Text>
        <Text variant="meta" tone="muted" truncate>
          {pin.source !== undefined ? 'From your message · ' : 'Edited · '}
          <time title={fullTime(pin.at)}>{messageTime(pin.at, now)}</time>
        </Text>
      </span>
    </ListRow>
  )
}
