import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { chatCopy, type MemoryChange, type MemoryDoc, type MemoryDocsPage as MemoryDocsPageModel, type MemoryPersonId, type MemorySection, type PersonRelationship } from '@juno/agent-contract'
import { Button, ListRow, Page, PageHeader, Section, Surface, Text } from '@juno/ui'
import { spacing } from '@juno/tokens/tokens.stylex'
import { cell } from './cell'
import { NoteList, Source, type DocEditing, type NoteActions } from './NoteRows'
import { PeopleList, PersonFilePage, type PersonFaces } from './PersonFile'
import { fullTime, messageTime } from '../time'

export { sourceLabel, type DocEditing } from './NoteRows'

export interface MemoryDocsPageProps extends NoteActions {
  readonly page: MemoryDocsPageModel
  readonly now: number
  readonly editing?: DocEditing
  readonly onAddStart: (doc: MemoryDoc, file?: { readonly person: MemoryPersonId; readonly section: MemorySection }) => void
  /** The pins, under their own heading after the docs (`PinList`). */
  readonly pinned?: ReactNode
  /** The person file open in place of the page. One that is gone shows the page. */
  readonly person?: MemoryPersonId
  readonly faces?: PersonFaces
  readonly onOpenPerson: (id: MemoryPersonId) => void
  readonly onClosePerson: () => void
  readonly onRelationship: (id: MemoryPersonId, relationship: PersonRelationship | null) => void
  /** Delete file is asking to confirm, for the open file. */
  readonly confirmingDelete?: boolean
  readonly onDeleteStart: () => void
  readonly onDeleteCancel: () => void
  readonly onDeleteFile: (id: MemoryPersonId) => void
}

/** Recent changes shown at most. */
const CHANGES = 12

const copy = chatCopy.docs

/**
 * What Juno remembers (SPEC 13.8): Juno's notes about the owner, one
 * section per doc, each note with where it came from, then the pins, then
 * the recent changes. People is a list of person files, then the general
 * People notes as Other notes; a person's row opens their file in place of
 * the page. Every note can be edited or deleted; an edit makes it the
 * owner's words. Edit and Delete show on hover and focus; Add sits on each
 * doc's heading. Notes Juno wrote after reading Slack or a connection say
 * so in a tooltip on their source.
 */
export function MemoryDocsPage({
  page,
  now,
  editing,
  onAddStart,
  pinned,
  person,
  faces,
  onOpenPerson,
  onClosePerson,
  onRelationship,
  confirmingDelete,
  onDeleteStart,
  onDeleteCancel,
  onDeleteFile,
  ...actions
}: MemoryDocsPageProps) {
  const open = person === undefined ? undefined : page.people.find((file) => file.id === person)
  if (open !== undefined) {
    return (
      <PersonFilePage
        person={open}
        now={now}
        {...(editing === undefined ? {} : { editing })}
        onAddStart={(section) => onAddStart('people', { person: open.id, section })}
        onClose={onClosePerson}
        onRelationship={(relationship) => onRelationship(open.id, relationship)}
        {...(confirmingDelete === undefined ? {} : { confirmingDelete })}
        onDeleteStart={onDeleteStart}
        onDeleteCancel={onDeleteCancel}
        onDeleteFile={() => onDeleteFile(open.id)}
        {...actions}
      />
    )
  }
  return (
    <Page>
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      {page.docs.map((section) => {
        const adding = editing?._tag === 'add' && editing.doc === section.doc && editing.person === undefined ? editing : undefined
        const title = copy.titles[section.doc]
        const add = (
          <Button variant="ghost" size="xs" tone="subtle" aria-label={copy.addLabel(title)} data-memory-add={section.doc} onClick={() => onAddStart(section.doc)}>
            {copy.add}
          </Button>
        )
        const notes = (label: string) => (
          <Surface kind="group" role="list" aria-label={label} data-memory-doc={section.doc}>
            <NoteList entries={section.entries} now={now} editing={editing} adding={adding} addLabel={copy.addLabel(title)} {...actions} />
          </Surface>
        )
        if (section.doc !== 'people') {
          return (
            <Section key={section.doc} heading={title} sub={copy.hints[section.doc]} action={add}>
              {notes(title)}
            </Section>
          )
        }
        // People: the files, then the general notes, which show only when there are some or one is being added.
        return (
          <div key={section.doc} {...stylex.props(styles.people)}>
            <Section heading={title} sub={copy.hints.people} action={add}>
              <PeopleList people={page.people} faces={faces} onOpenPerson={onOpenPerson} />
            </Section>
            {section.entries.length === 0 && adding === undefined ? null : <Section heading={copy.people.general}>{notes(copy.people.general)}</Section>}
          </div>
        )
      })}
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

/** One recent change. A change in a person's file names them ("Added to Maya Chen"), and its text blurs in privacy mode. */
function ChangeRow({ change, now, last }: { readonly change: MemoryChange; readonly now: number; readonly last: boolean }) {
  const where = change.person ?? copy.titles[change.doc]
  return (
    <ListRow role="listitem" divider={!last} data-memory-change={change.kind} data-memory-undone={change.undone || undefined}>
      <span {...stylex.props(cell.lines)}>
        <Text variant="body" truncate>
          {copy.change[change.kind](where)}
        </Text>
        {change.text === undefined ? null : (
          <Text variant="preview" tone="muted" dir="auto" truncate data-sensitive={change.person === undefined ? undefined : ''}>
            {change.text}
          </Text>
        )}
        <Text variant="meta" tone="muted" truncate>
          {change.by === 'owner' ? copy.byOwner : <Source source={change.source} outside={change.outside} />}
          {' · '}
          <time title={fullTime(change.at)}>{messageTime(change.at, now)}</time>
          {change.undone ? ` · ${copy.undone}` : change.text === undefined ? ` · ${copy.deleted}` : null}
        </Text>
      </span>
    </ListRow>
  )
}

const styles = stylex.create({
  // People and its Other notes read as one doc: a section's gap apart, not a page's.
  people: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-6'],
  },
})
