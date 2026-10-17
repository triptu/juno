import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { chatCopy, type MemoryChange, type MemoryDoc, type MemoryDocsPage as MemoryDocsPageModel, type MemoryEntryId, type MemoryEntryRow, type MemorySource } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, ListRow, Page, PageHeader, Section, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'
import { fullTime, messageTime } from '../time'

/** The note under edit, or the new one being added to a doc, with its draft. The draft is the renderer's. */
export type DocEditing =
  | { readonly _tag: 'edit'; readonly id: MemoryEntryId; readonly draft: string; readonly error?: string }
  | { readonly _tag: 'add'; readonly doc: MemoryDoc; readonly draft: string; readonly error?: string }

export interface MemoryDocsPageProps {
  readonly page: MemoryDocsPageModel
  readonly now: number
  readonly editing?: DocEditing
  readonly onEditStart: (id: MemoryEntryId) => void
  readonly onAddStart: (doc: MemoryDoc) => void
  readonly onDraftChange: (draft: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
  readonly onDelete: (id: MemoryEntryId) => void
  /** The pins, under their own heading after the docs (`PinList`). */
  readonly pinned?: ReactNode
}

/** Recent changes shown at most. */
const CHANGES = 12

const copy = chatCopy.docs

/** "Your words", "Slack", "Littlebird". */
export const sourceLabel = (source: MemorySource): string => (source._tag === 'connection' ? source.name : copy.source[source._tag])

/**
 * What Juno remembers (SPEC 13.8): Juno's notes about the owner, one
 * section per doc, each note with where it came from, then the pins, then
 * the recent changes. Every note can be edited or deleted; an edit makes it
 * the owner's words. Notes Juno wrote after reading Slack or a connection
 * say so.
 */
export function MemoryDocsPage({ page, now, editing, onEditStart, onAddStart, onDraftChange, onSave, onCancel, onDelete, pinned }: MemoryDocsPageProps) {
  const field = { onDraftChange, onSave, onCancel }
  return (
    <Page>
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      {page.docs.map((section) => (
        <Section key={section.doc} heading={copy.titles[section.doc]} sub={copy.hints[section.doc]}>
          <Surface kind="group" role="list" aria-label={copy.titles[section.doc]} data-memory-doc={section.doc}>
            {section.entries.map((entry) =>
              editing?._tag === 'edit' && editing.id === entry.id ? (
                <EditRow key={entry.id} label={copy.entryLabel} editing={editing} {...field} />
              ) : (
                <EntryRow key={entry.id} entry={entry} now={now} onEditStart={onEditStart} onDelete={onDelete} />
              ),
            )}
            {editing?._tag === 'add' && editing.doc === section.doc ? (
              <EditRow label={copy.addLabel(copy.titles[section.doc])} editing={editing} {...field} last />
            ) : (
              <ListRow role="listitem" divider={false} data-memory-add={section.doc}>
                <span {...stylex.props(styles.addRow)}>
                  {section.entries.length === 0 ? (
                    <Text variant="body" tone="muted">
                      {copy.docEmpty}
                    </Text>
                  ) : (
                    <span />
                  )}
                  <Button variant="ghost" size="xs" tone="subtle" aria-label={copy.addLabel(copy.titles[section.doc])} onClick={() => onAddStart(section.doc)}>
                    {copy.add}
                  </Button>
                </span>
              </ListRow>
            )}
          </Surface>
        </Section>
      ))}
      {pinned === undefined ? null : (
        <Section heading={copy.pinned} sub={copy.pinnedSub}>
          {pinned}
        </Section>
      )}
      {page.changes.length === 0 ? null : (
        <Section heading={copy.changes}>
          <Surface kind="group" role="list" aria-label={copy.changes}>
            {page.changes.slice(0, CHANGES).map((change, index, shown) => (
              <ChangeRow key={change.id} change={change} now={now} last={index === shown.length - 1} />
            ))}
          </Surface>
        </Section>
      )}
    </Page>
  )
}

function EntryRow({ entry, now, onEditStart, onDelete }: { readonly entry: MemoryEntryRow; readonly now: number } & Pick<MemoryDocsPageProps, 'onEditStart' | 'onDelete'>) {
  return (
    <ListRow
      role="listitem"
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
        <Text variant="body" selectable dir="auto" sx={cell.wrap}>
          {entry.text}
        </Text>
        <Text variant="meta" tone="muted" truncate>
          {sourceLabel(entry.source)}
          {' · '}
          <time title={fullTime(entry.at)}>{messageTime(entry.at, now)}</time>
          {entry.outside ? ` · ${copy.outside}` : null}
        </Text>
      </span>
    </ListRow>
  )
}

function EditRow({ label, editing, onDraftChange, onSave, onCancel, last = false }: { readonly label: string; readonly editing: DocEditing; readonly last?: boolean } & Pick<MemoryDocsPageProps, 'onDraftChange' | 'onSave' | 'onCancel'>) {
  return (
    <ListRow role="listitem" data-memory-entry-editing="" divider={!last}>
      <span {...stylex.props(cell.field)}>
        <TextField size={32} label={label} value={editing.draft} onChange={(event) => onDraftChange(event.currentTarget.value)} dir="auto" />
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

function ChangeRow({ change, now, last }: { readonly change: MemoryChange; readonly now: number; readonly last: boolean }) {
  const doc = copy.titles[change.doc]
  return (
    <ListRow role="listitem" divider={!last} data-memory-change={change.kind} data-memory-undone={change.undone || undefined}>
      <span {...stylex.props(cell.lines)}>
        <Text variant="body" truncate>
          {copy.change[change.kind](doc)}
        </Text>
        {change.text === undefined ? null : (
          <Text variant="preview" tone="muted" dir="auto" truncate>
            {change.text}
          </Text>
        )}
        <Text variant="meta" tone="muted" truncate>
          {change.by === 'owner' ? copy.byOwner : sourceLabel(change.source)}
          {change.outside ? ` · ${copy.outside}` : null}
          {' · '}
          <time title={fullTime(change.at)}>{messageTime(change.at, now)}</time>
          {change.undone ? ` · ${copy.undone}` : change.text === undefined ? ` · ${copy.deleted}` : null}
        </Text>
      </span>
    </ListRow>
  )
}

const styles = stylex.create({
  addRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-2'],
    width: '100%',
    minWidth: 0,
  },
})
