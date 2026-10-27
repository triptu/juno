import * as stylex from '@stylexjs/stylex'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Person } from '@juno/contract'
import { colors, layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Button, Checkbox, OptionList, OptionRow, Surface, Text, TextField, useOptionListKeys } from '@juno/ui'
import { hueFor, initials } from './look'

export interface ChannelSheetProps {
  /** New channel or Edit channel. Edit has no Private switch. */
  readonly mode: 'new' | 'edit'
  /** The name as Slack will take it, without "#". The owner normalises what is typed. */
  readonly name: string
  /** Slack's rules changed what was typed: the quiet line under the field says so. */
  readonly adjusted: boolean
  /** Why the last try failed, in plain words, under the name. */
  readonly error?: string | undefined
  readonly isPrivate: boolean
  /** The members: the channel's (edit) and the people added, in order. */
  readonly members: ReadonlyArray<Person>
  /** The channel's members are still being asked for (edit). */
  readonly membersLoading?: boolean
  readonly query: string
  /** People to add: matches for the query, or recent ones when it is empty. Members may be among them. */
  readonly results: ReadonlyArray<Person>
  /** Create or Save is waiting for Slack. */
  readonly busy?: boolean
  /** The value typed, and where the caret was in it: the owner returns the normalised name. */
  readonly onNameChange: (typed: string, caret: number) => void
  readonly onPrivateChange: (isPrivate: boolean) => void
  readonly onQueryChange: (query: string) => void
  /** Adds a person, or takes them out when they are a member. */
  readonly onToggle: (person: Person) => void
  readonly onRemove: (person: Person) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
  /** Where the caret goes after the owner normalised the name; a new object for each edit. */
  readonly caret?: { readonly at: number } | undefined
  /** Edit: Slack would refuse a rename (the general channel), so there is no Name field. */
  readonly canRename?: boolean
  /** Edit: Slack would refuse member changes, so there are no Members. */
  readonly canChangeMembers?: boolean
}

const rowId = (id: string) => `channel-sheet-${id}`

/**
 * The channel sheet (SPEC 5, "Channel sheet"; inventory 2.3a): Name, then
 * Private (new channels only), then Members, nothing else. The name shows
 * after a "#" as Slack will take it, with a quiet line when Slack's rules
 * changed what was typed and Slack's refusal under it. Members are listed
 * with Remove; the search under them adds people. Enter in the name
 * submits, Enter in the search picks the highlighted person, and Escape
 * closes (the container's `SheetLayer`).
 */
export function ChannelSheet(props: ChannelSheetProps) {
  const { mode, name, error, isPrivate, busy = false, onPrivateChange, onSubmit, onCancel, canRename = true, canChangeMembers = true } = props
  const canSubmit = name !== '' && !busy
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit) onSubmit()
  }
  const title = mode === 'new' ? 'New channel' : canRename ? 'Edit channel' : `Edit #${name}`
  return (
    <Surface kind="popover" as="section" role="dialog" aria-label={title} aria-modal data-channel-sheet="" padding="none" sx={styles.sheet}>
      <form onSubmit={submit} {...stylex.props(styles.inner)}>
        <Text variant="heading" tone="default" as="h2">
          {title}
        </Text>
        {canRename ? (
          <NameField {...props} />
        ) : error === undefined ? null : (
          <Text variant="meta" tone="danger" as="span" role="alert">
            {error}
          </Text>
        )}
        {mode === 'new' ? (
          <Checkbox role="switch" label="Private" description="Only people who are added can see it." checked={isPrivate} onChange={(event) => onPrivateChange(event.currentTarget.checked)} />
        ) : null}
        {canChangeMembers ? <MembersField {...props} autoFocus={!canRename} /> : null}
        <div {...stylex.props(styles.buttons)}>
          <Button type="button" variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={!canSubmit}>
            {mode === 'new' ? 'Create' : 'Save'}
          </Button>
        </div>
      </form>
    </Surface>
  )
}

/** The name after a "#", with the quiet line or Slack's refusal under it. A normalised name keeps the caret where the typing was. */
function NameField({ name, adjusted, error, caret, onNameChange }: ChannelSheetProps) {
  const field = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const input = field.current
    if (caret === undefined || input === null || document.activeElement !== input) return
    input.setSelectionRange(caret.at, caret.at)
  }, [caret])
  const onName = (event: ChangeEvent<HTMLInputElement>) => onNameChange(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)
  return (
    <div {...stylex.props(styles.field)}>
      <TextField
        ref={field}
        size={30}
        label="Name"
        placeholder="name"
        leading={
          <Text variant="ui" tone="muted" as="span" aria-hidden>
            #
          </Text>
        }
        value={name}
        maxLength={80}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        invalid={error !== undefined}
        aria-describedby="channel-sheet-name-note"
        onChange={onName}
      />
      <Text id="channel-sheet-name-note" variant="meta" tone={error === undefined ? 'muted' : 'danger'} as="span" role={error === undefined ? undefined : 'alert'}>
        {error ?? (adjusted ? 'Names are lowercase, with hyphens for spaces and no punctuation.' : null)}
      </Text>
    </div>
  )
}

/** The members with Remove, then the people search that adds them. */
function MembersField({ mode, members, membersLoading = false, query, results, onQueryChange, onToggle, onRemove, autoFocus }: ChannelSheetProps & { readonly autoFocus: boolean }) {
  const memberIds = new Set(members.map((person) => person.id))
  const [active, setActive] = useState<string | undefined>(undefined)
  const keys = useOptionListKeys({
    ids: results.map((person) => rowId(person.id)),
    activeId: active,
    onActiveChange: setActive,
    onSelect: (id) => {
      const person = results.find((each) => rowId(each.id) === id)
      if (person !== undefined) onToggle(person)
    },
  })
  return (
    <div {...stylex.props(styles.field)}>
      <Text variant="meta" tone="muted" weight="medium" as="span" id="channel-sheet-members">
        Members
      </Text>
      {members.length > 0 ? (
        <ul aria-labelledby="channel-sheet-members" {...stylex.props(styles.members)}>
          {members.map((person) => (
            <li key={person.id} data-member={person.id} {...stylex.props(styles.member)}>
              <PersonAvatar person={person} />
              <Text variant="ui" tone="default" as="span" truncate sx={styles.memberName}>
                {person.name}
              </Text>
              <Button type="button" variant="ghost" tone="subtle" size="xs" aria-label={`Remove ${person.name}`} onClick={() => onRemove(person)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Text variant="meta" tone="muted" as="span">
          {membersLoading ? 'Getting members…' : mode === 'new' ? 'Just you for now' : 'No one else yet'}
        </Text>
      )}
      <TextField
        size={30}
        label="Add people"
        placeholder="Add people"
        leadingIcon={MagnifyingGlass}
        value={query}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded
        aria-controls="channel-sheet-people"
        aria-activedescendant={active}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Enter in the search adds the highlighted person; it never submits.
          if (event.key === 'Enter') event.preventDefault()
          keys(event)
        }}
      />
      <div {...stylex.props(styles.list)}>
        <OptionList id="channel-sheet-people" label="People" aria-multiselectable {...(active === undefined ? {} : { activeId: active })}>
          {results.map((person) => (
            <OptionRow
              key={person.id}
              id={rowId(person.id)}
              size={30}
              selected={memberIds.has(person.id)}
              active={active === rowId(person.id)}
              leading={<PersonAvatar person={person} />}
              label={person.name}
              onActivate={() => setActive(rowId(person.id))}
              onSelect={() => onToggle(person)}
            />
          ))}
        </OptionList>
      </div>
    </div>
  )
}

function PersonAvatar({ person }: { readonly person: Person }) {
  const src = person.avatarSmallUrl ?? person.avatarUrl
  return <Avatar size={18} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(src === undefined ? {} : { src })} />
}

const styles = stylex.create({
  sheet: {
    width: '100%',
    maxWidth: layout['--channel-sheet-width'],
    boxSizing: 'border-box',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    paddingBlock: spacing['--space-4'],
    paddingInline: spacing['--space-5'],
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
  },
  members: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    maxHeight: layout['--view-sheet-list-max-height'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    paddingBottom: spacing['--space-1-5'],
  },
  member: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    minHeight: sizes['--control-30'],
  },
  memberName: {
    flex: 1,
    minWidth: 0,
  },
  list: {
    maxHeight: layout['--view-sheet-list-max-height'],
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing['--space-1-5'],
    paddingTop: spacing['--space-1'],
  },
})
