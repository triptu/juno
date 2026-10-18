import * as stylex from '@stylexjs/stylex'
import { chatCopy, type MemoryDoc, type MemoryEntryId, type MemoryEntryRow, type MemoryPersonId, type MemorySection, type MemorySource } from '@juno/agent-contract'
import { Button, ListRow, Text, tooltip } from '@juno/ui'
import { cell } from './cell'
import { NoteField } from './NoteField'
import { fullTime, messageTime } from '../time'

/**
 * The note under edit, or the new one being added to a doc or to a section
 * of a person's file, with its draft. The draft is the renderer's.
 */
export type DocEditing =
  | { readonly _tag: 'edit'; readonly id: MemoryEntryId; readonly draft: string; readonly error?: string }
  | { readonly _tag: 'add'; readonly doc: MemoryDoc; readonly person?: MemoryPersonId; readonly section?: MemorySection; readonly draft: string; readonly error?: string }

export interface NoteActions {
  readonly onEditStart: (id: MemoryEntryId) => void
  readonly onDelete: (id: MemoryEntryId) => void
  readonly onDraftChange: (draft: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}

const copy = chatCopy.docs

/** "Your words", "Slack", "Littlebird". */
export const sourceLabel = (source: MemorySource): string => (source._tag === 'connection' ? source.name : copy.source[source._tag])

/**
 * Where a note came from. One written after reading outside content says so
 * in a tooltip on the source and to a screen reader, not in a line of its own.
 */
export function Source({ source, outside }: { readonly source: MemorySource; readonly outside: boolean }) {
  return outside ? (
    <span data-memory-outside="" aria-description={copy.outside} {...tooltip(copy.outside)}>
      {sourceLabel(source)}
    </span>
  ) : (
    sourceLabel(source)
  )
}

/**
 * One note with its source and time, and Edit and Delete on hover and
 * focus. `sensitive`: a note in a person's file, which privacy mode blurs.
 */
export function EntryRow({ entry, now, last, sensitive = false, onEditStart, onDelete }: { readonly entry: MemoryEntryRow; readonly now: number; readonly last: boolean; readonly sensitive?: boolean } & Pick<NoteActions, 'onEditStart' | 'onDelete'>) {
  return (
    <ListRow
      role="listitem"
      revealTrailing
      divider={!last}
      data-memory-entry={entry.id}
      data-memory-source={entry.source._tag}
      trailing={
        <span {...stylex.props(cell.controls)}>
          <Button variant="ghost" size="xs" tone="subtle" aria-label={`${copy.edit} ${entry.text}`} onClick={() => onEditStart(entry.id)}>
            {copy.edit}
          </Button>
          <Button variant="ghost" size="xs" tone="subtle" aria-label={`${copy.delete} ${entry.text}`} onClick={() => onDelete(entry.id)}>
            {copy.delete}
          </Button>
        </span>
      }
    >
      <span {...stylex.props(cell.lines)}>
        <Text variant="body" selectable dir="auto" sx={cell.note} data-sensitive={sensitive ? '' : undefined}>
          {entry.text}
        </Text>
        <Text variant="meta" tone="muted" truncate>
          <Source source={entry.source} outside={entry.outside} />
          {' · '}
          <time title={fullTime(entry.at)}>{messageTime(entry.at, now)}</time>
        </Text>
      </span>
    </ListRow>
  )
}

/** The multi-line field for a note under edit or being added, with Save and Cancel and a refusal's line. */
export function EditRow({ label, editing, onDraftChange, onSave, onCancel, last = false }: { readonly label: string; readonly editing: DocEditing; readonly last?: boolean } & Pick<NoteActions, 'onDraftChange' | 'onSave' | 'onCancel'>) {
  return (
    <ListRow role="listitem" data-memory-entry-editing="" divider={!last}>
      <span {...stylex.props(cell.field)}>
        <NoteField label={label} draft={editing.draft} onDraftChange={onDraftChange} onSave={onSave} onCancel={onCancel} />
        {editing.error === undefined ? null : (
          <Text variant="meta" tone="muted" data-memory-error="">
            {editing.error}
          </Text>
        )}
        <span {...stylex.props(cell.controls)}>
          <Button variant="secondary" size="sm" onClick={onSave} dimmed={editing.draft.trim().length === 0}>
            {copy.save}
          </Button>
          <Button variant="ghost" size="sm" tone="subtle" onClick={onCancel}>
            {copy.cancel}
          </Button>
        </span>
      </span>
    </ListRow>
  )
}

/** A list's notes, the one under edit in place, the new one at the end, or "Nothing yet." */
export function NoteList({
  entries,
  now,
  editing,
  adding,
  addLabel,
  sensitive = false,
  ...actions
}: {
  readonly entries: ReadonlyArray<MemoryEntryRow>
  readonly now: number
  readonly editing: DocEditing | undefined
  /** The new note being added to this list, if any. */
  readonly adding: DocEditing | undefined
  readonly addLabel: string
  readonly sensitive?: boolean
} & NoteActions) {
  return (
    <>
      {entries.map((entry, index) =>
        editing?._tag === 'edit' && editing.id === entry.id ? (
          <EditRow key={entry.id} label={copy.entryLabel} editing={editing} last={adding === undefined && index === entries.length - 1} {...actions} />
        ) : (
          <EntryRow key={entry.id} entry={entry} now={now} sensitive={sensitive} last={adding === undefined && index === entries.length - 1} {...actions} />
        ),
      )}
      {adding !== undefined ? (
        <EditRow label={addLabel} editing={adding} {...actions} last />
      ) : entries.length === 0 ? (
        <ListRow role="listitem" divider={false} data-memory-empty="">
          <Text variant="body" tone="muted">
            {copy.docEmpty}
          </Text>
        </ListRow>
      ) : null}
    </>
  )
}
