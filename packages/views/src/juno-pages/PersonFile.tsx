import * as stylex from '@stylexjs/stylex'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { chatCopy, type MemoryPerson, type MemoryPersonId, type MemorySection, type PersonRelationship } from '@juno/agent-contract'
import type { Person } from '@juno/contract'
import { Avatar, Button, Chip, Icon, ListRow, Page, PageHeader, Section, Select, Surface, Text, tooltip } from '@juno/ui'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { cell } from './cell'
import { NoteList, type DocEditing, type NoteActions } from './NoteRows'
import { hueFor, initials } from '../look'

const copy = chatCopy.docs.people

/** A file's sections, in the order the page shows them. */
const SECTIONS: ReadonlyArray<MemorySection> = ['role', 'work', 'talk', 'notes']
const RELATIONSHIPS = Object.keys(copy.relationships) as ReadonlyArray<PersonRelationship>

/** The Slack profile of each person with a file, by user id, for the avatar. Absent: initials in the id's hue. */
export type PersonFaces = Readonly<Record<string, Person>>

function PersonAvatar({ person, faces, size }: { readonly person: Pick<MemoryPerson, 'id' | 'name'>; readonly faces: PersonFaces | undefined; readonly size: 28 | 44 }) {
  const face = faces?.[person.id]
  const src = size === 28 ? (face?.avatarSmallUrl ?? face?.avatarUrl) : (face?.avatarUrl ?? face?.avatarLargeUrl)
  return <Avatar label={initials(person.name)} size={size} hue={hueFor(face?.color ?? '', person.id)} {...(src === undefined ? {} : { src })} />
}

/**
 * People on What Juno remembers (SPEC 13.8): a row per person file, most in
 * touch first, with the avatar, the name, the relationship chip and one line
 * of what they work on. The line is message-derived, so privacy mode blurs
 * it; names and chips stay readable. A row opens the file on mouse down.
 */
export function PeopleList({ people, faces, onOpenPerson }: { readonly people: ReadonlyArray<MemoryPerson>; readonly faces: PersonFaces | undefined; readonly onOpenPerson: (id: MemoryPersonId) => void }) {
  if (people.length === 0) {
    return (
      <Surface kind="group">
        <ListRow divider={false} data-memory-people-empty="">
          <Text variant="body" tone="muted">
            {copy.empty}
          </Text>
        </ListRow>
      </Surface>
    )
  }
  return (
    <Surface kind="group" role="list" aria-label={chatCopy.docs.titles.people} data-memory-people="">
      {people.map((person, index) => (
        <div role="listitem" key={person.id}>
          <ListRow
            minHeight={52}
            divider={index < people.length - 1}
            leading={<PersonAvatar person={person} faces={faces} size={28} />}
            trailing={<span {...stylex.props(styles.caret)}><Icon icon={CaretRight} size={13} /></span>}
            onSelect={() => onOpenPerson(person.id)}
            data-memory-person={person.id}
          >
            <span {...stylex.props(cell.lines)}>
              <span {...stylex.props(cell.line)}>
                <Text variant="body" weight="medium" truncate dir="auto" data-memory-person-name="">
                  {person.name}
                </Text>
                {person.relationship === undefined ? null : (
                  <Chip variant="soft" size={20} data-memory-relationship={person.relationship}>
                    {copy.relationships[person.relationship]}
                  </Chip>
                )}
              </span>
              {person.work === undefined ? null : (
                <Text variant="preview" tone="muted" truncate dir="auto" data-sensitive="" data-memory-work="">
                  {person.work}
                </Text>
              )}
            </span>
          </ListRow>
        </div>
      ))}
    </Surface>
  )
}

export interface PersonFilePageProps extends NoteActions {
  readonly person: MemoryPerson
  readonly now: number
  readonly editing?: DocEditing
  readonly onAddStart: (section: MemorySection) => void
  /** Back to People. */
  readonly onClose: () => void
  /** The owner sets or clears who they are to them. */
  readonly onRelationship: (relationship: PersonRelationship | null) => void
  /** Delete file asks first, in place; then `onDeleteFile` deletes it. */
  readonly confirmingDelete?: boolean
  readonly onDeleteStart: () => void
  readonly onDeleteCancel: () => void
  readonly onDeleteFile: () => void
}

/**
 * One person's file (SPEC 13.8), in place of the page: Back to People, the
 * name, the relationship and Delete file, then the four sections, each with
 * Add and the notes' hover Edit and Delete. The relationship is a native
 * menu the owner corrects it with; its tooltip says whether Juno guessed
 * it. Every note is blurred in privacy mode.
 */
export function PersonFilePage({
  person,
  now,
  editing,
  onAddStart,
  onClose,
  onRelationship,
  confirmingDelete = false,
  onDeleteStart,
  onDeleteCancel,
  onDeleteFile,
  ...actions
}: PersonFilePageProps) {
  return (
    <Page>
      <FileHead person={person} onClose={onClose} onRelationship={onRelationship} confirmingDelete={confirmingDelete} onDeleteStart={onDeleteStart} onDeleteCancel={onDeleteCancel} onDeleteFile={onDeleteFile} />
      {SECTIONS.map((section) => {
        const title = copy.sections[section]
        const adding = editing?._tag === 'add' && editing.person === person.id && editing.section === section ? editing : undefined
        return (
          <Section
            key={section}
            heading={title}
            action={
              <Button variant="ghost" size="xs" tone="subtle" aria-label={chatCopy.docs.addLabel(title)} data-memory-add={section} onClick={() => onAddStart(section)}>
                {chatCopy.docs.add}
              </Button>
            }
          >
            <Surface kind="group" role="list" aria-label={title} data-memory-section={section}>
              <NoteList
                entries={person.entries.filter((entry) => entry.section === section)}
                now={now}
                editing={editing}
                adding={adding}
                addLabel={chatCopy.docs.addLabel(title)}
                sensitive
                {...actions}
              />
            </Surface>
          </Section>
        )
      })}
    </Page>
  )
}

/** Back to People, the name, the relationship and Delete file, and Delete file's question once it is asked. */
function FileHead({
  person,
  onClose,
  onRelationship,
  confirmingDelete,
  onDeleteStart,
  onDeleteCancel,
  onDeleteFile,
}: Pick<PersonFilePageProps, 'person' | 'onClose' | 'onRelationship' | 'onDeleteStart' | 'onDeleteCancel' | 'onDeleteFile'> & { readonly confirmingDelete: boolean }) {
  const hint = person.relationshipBy === 'owner' ? copy.setByYou : person.relationship === undefined ? undefined : copy.guessed
  return (
    <>
      <div {...stylex.props(styles.head)} data-memory-file={person.id}>
        <span {...stylex.props(styles.back)}>
          <Button variant="ghost" size="sm" tone="subtle" iconStart={CaretLeft} onClick={onClose} data-memory-back="">
            {copy.back}
          </Button>
        </span>
        <PageHeader title={person.name} />
        <span {...stylex.props(styles.controls)}>
          <Select
            size={28}
            label={copy.relationshipLabel}
            value={person.relationship ?? ''}
            options={[{ value: '', label: person.relationship === undefined ? copy.relationshipUnset : copy.relationshipNone }, ...RELATIONSHIPS.map((value) => ({ value, label: copy.relationships[value] }))]}
            onChange={(event) => onRelationship(event.currentTarget.value === '' ? null : (event.currentTarget.value as PersonRelationship))}
            data-memory-relationship-by={person.relationshipBy}
            {...(hint === undefined ? {} : tooltip(hint))}
          />
          {confirmingDelete ? null : (
            <Button variant="ghost" size="sm" tone="subtle" onClick={onDeleteStart} data-memory-delete-file="">
              {copy.deleteFile}
            </Button>
          )}
        </span>
      </div>
      {confirmingDelete ? (
        <Surface kind="group" role="alertdialog" aria-label={copy.deleteTitle(person.name)} data-memory-delete-confirm="">
          <ListRow divider={false} wrap>
            <span {...stylex.props(cell.field)}>
              <span {...stylex.props(cell.lines)}>
                <Text variant="body" weight="medium" as="p">
                  {copy.deleteTitle(person.name)}
                </Text>
                <Text variant="ui" tone="muted" as="p" sx={cell.wrap}>
                  {copy.deleteBody}
                </Text>
              </span>
              <span {...stylex.props(cell.controls)}>
                <Button variant="primary" size="sm" onClick={onDeleteFile}>
                  {copy.deleteFile}
                </Button>
                <Button variant="ghost" size="sm" tone="subtle" onClick={onDeleteCancel}>
                  {chatCopy.docs.cancel}
                </Button>
              </span>
            </span>
          </ListRow>
        </Surface>
      ) : null}
    </>
  )
}

const styles = stylex.create({
  // Back sits close above the name, not a page gap away.
  head: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing['--space-2'],
  },
  // The ghost button's own padding would push its text in from the column's edge; this lines the caret up with the title.
  back: {
    display: 'flex',
    marginInlineStart: `calc(-1 * ${spacing['--space-2']})`,
  },
  // The relationship at the start, Delete file at the end, on a line under the name.
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    marginBlockStart: spacing['--space-1'],
  },
  // A row that opens something ends in a quiet caret, as a macOS list does.
  caret: {
    display: 'flex',
    color: colors['--foreground-muted'],
  },
})
