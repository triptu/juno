import * as stylex from '@stylexjs/stylex'
import { chatCopy, type PinId, type PinRow, type RemembersPage as RemembersPageModel } from '@juno/agent-contract'
import { Button, ListRow, Surface, Text } from '@juno/ui'
import { cell } from './cell'
import { NoteField } from './NoteField'
import { fullTime, messageTime } from '../time'

export interface PinListProps {
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

const docs = chatCopy.docs
const copy = chatCopy.pages.remembers

/**
 * The pins (SPEC 13.8), for What Juno remembers' Pinned section: the full
 * line when the budget is used, then the pins, or how to pin one. An edit
 * replaces the pin with the owner's words.
 */
export function PinList({ page, now, editing, onEditStart, onDraftChange, onSave, onCancel, onRemove }: PinListProps) {
  const full = page.usedBytes >= page.budgetBytes
  return (
    <>
      {full ? (
        <Text variant="preview" tone="muted" as="p" data-remembers-full="">
          {copy.full}
        </Text>
      ) : null}
      {page.pins.length === 0 ? (
        <Surface kind="group">
          <ListRow divider={false}>
            <Text variant="body" tone="muted" sx={cell.wrap}>
              {copy.empty}
            </Text>
          </ListRow>
        </Surface>
      ) : (
        <Surface kind="group" role="list" aria-label={docs.pinned}>
          {page.pins.map((pin, index) => (
            <Row key={pin.id} pin={pin} now={now} last={index === page.pins.length - 1} editing={editing?.id === pin.id ? editing.draft : undefined} onEditStart={onEditStart} onDraftChange={onDraftChange} onSave={onSave} onCancel={onCancel} onRemove={onRemove} />
          ))}
        </Surface>
      )}
    </>
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
}: { readonly pin: PinRow; readonly now: number; readonly last: boolean; readonly editing: string | undefined } & Pick<PinListProps, 'onEditStart' | 'onDraftChange' | 'onSave' | 'onCancel' | 'onRemove'>) {
  if (editing !== undefined) {
    return (
      <ListRow role="listitem" data-pin="editing" divider={!last}>
        <span {...stylex.props(cell.field)}>
          <NoteField label={copy.label} draft={editing} onDraftChange={onDraftChange} onSave={onSave} onCancel={onCancel} />
          {pin.changed ? (
            <Text variant="meta" tone="muted" data-pin-changed="">
              {copy.changed}
            </Text>
          ) : null}
          <span {...stylex.props(cell.controls)}>
            <Button variant="secondary" size="sm" onClick={onSave} dimmed={editing.trim().length === 0}>
              {docs.save}
            </Button>
            <Button variant="ghost" size="sm" tone="subtle" onClick={onCancel}>
              {docs.cancel}
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
      revealTrailing
      divider={!last}
      trailing={
        <span {...stylex.props(cell.controls)}>
          <Button variant="ghost" size="xs" tone="subtle" aria-label={`${docs.edit} ${pin.text}`} onClick={() => onEditStart(pin.id)}>
            {docs.edit}
          </Button>
          <Button variant="ghost" size="xs" tone="subtle" aria-label={`${docs.delete} ${pin.text}`} onClick={() => onRemove(pin.id)}>
            {docs.delete}
          </Button>
        </span>
      }
    >
      <span {...stylex.props(cell.lines)}>
        <Text variant="body" selectable dir="auto" sx={cell.note}>
          {pin.text}
        </Text>
        <Text variant="meta" tone="muted" truncate>
          {pin.source !== undefined ? copy.fromMessage : copy.edited}
          {' · '}
          <time title={fullTime(pin.at)}>{messageTime(pin.at, now)}</time>
        </Text>
      </span>
    </ListRow>
  )
}
