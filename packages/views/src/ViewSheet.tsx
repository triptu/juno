import * as stylex from '@stylexjs/stylex'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { Prohibit } from '@phosphor-icons/react/dist/icons/Prohibit'
import { useState, type FormEvent } from 'react'
import type { ConversationKind } from '@juno/contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import {
  accentLabels,
  accentNames,
  Button,
  Checkbox,
  Icon,
  IconButton,
  OptionList,
  OptionRow,
  Swatch,
  Text,
  TextField,
  useOptionListKeys,
  viewIconNames,
  viewIcons,
  type AccentName,
  type ViewIconName,
} from '@juno/ui'
import { kindIcon } from './look'

/** A conversation the sheet lists: chosen, or a match for the search. */
export interface ViewSheetConversation {
  readonly id: string
  /** "eng", "Maya Chen": without "#". */
  readonly name: string
  readonly kind: ConversationKind
  /** Automated: Juno put it there. The row says so; unchecking it takes it out, and Juno leaves it out. */
  readonly addedByJuno?: boolean
}

export interface ViewSheetProps {
  /** New view or Edit view: the sheet's accessible name. */
  readonly mode: 'new' | 'edit'
  readonly name: string
  readonly icon?: ViewIconName | undefined
  /** The icon's colour, an accent; undefined is neutral. */
  readonly color?: AccentName | undefined
  readonly keepOutOfAll: boolean
  /** The view's conversations, in the order they were added. */
  readonly chosen: ReadonlyArray<ViewSheetConversation>
  readonly query: string
  /** Conversations to add: matches for the query, or recent ones when it is empty. Chosen ones may be among them. */
  readonly results: ReadonlyArray<ViewSheetConversation>
  readonly onNameChange: (name: string) => void
  readonly onIconChange: (icon: ViewIconName | undefined) => void
  readonly onColorChange: (color: AccentName | undefined) => void
  readonly onKeepOutOfAllChange: (keep: boolean) => void
  readonly onQueryChange: (query: string) => void
  /** Adds the conversation, or removes it when chosen. */
  readonly onToggle: (conversation: ViewSheetConversation) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}

const iconLabels: Record<ViewIconName, string> = {
  robot: 'Robot',
  bell: 'Bell',
  lightning: 'Lightning',
  bug: 'Bug',
  rocket: 'Rocket',
  code: 'Code',
  megaphone: 'Megaphone',
  users: 'People',
  briefcase: 'Briefcase',
  star: 'Star',
  flag: 'Flag',
  heart: 'Heart',
  eye: 'Eye',
  coffee: 'Coffee',
  calendar: 'Calendar',
  book: 'Book',
  globe: 'Globe',
  shield: 'Shield',
  wrench: 'Wrench',
  flask: 'Flask',
  leaf: 'Leaf',
  trophy: 'Trophy',
  gift: 'Gift',
}

/** A conversation's row id in the list, for aria-activedescendant. */
const rowId = (id: string) => `view-sheet-${id}`

/**
 * The view sheet (spec section 5 "Views", inventory 2.3): the name, an
 * optional icon and its colour, the conversations through a search, and Keep these out of
 * All. Nothing else. The owner holds the draft and saves it; the sheet
 * changes nothing until Save. Enter in the name saves, Escape cancels (the
 * popover that holds it closes on Escape).
 */
export function ViewSheet({
  mode,
  name,
  icon,
  color,
  keepOutOfAll,
  chosen,
  query,
  results,
  onNameChange,
  onIconChange,
  onColorChange,
  onKeepOutOfAllChange,
  onQueryChange,
  onToggle,
  onSave,
  onCancel,
}: ViewSheetProps) {
  const chosenIds = new Set(chosen.map((c) => c.id))
  // Chosen first, then the matches that are not chosen yet.
  const rows = [...chosen, ...results.filter((c) => !chosenIds.has(c.id))]
  const [active, setActive] = useState<string | undefined>(undefined)
  const keys = useOptionListKeys({
    ids: rows.map((row) => rowId(row.id)),
    activeId: active,
    onActiveChange: setActive,
    onSelect: (id) => {
      const row = rows.find((c) => rowId(c.id) === id)
      if (row !== undefined) onToggle(row)
    },
  })
  const canSave = name.trim() !== ''
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canSave) onSave()
  }
  const count = chosen.length
  return (
    <form aria-label={mode === 'new' ? 'New view' : 'Edit view'} onSubmit={submit} data-view-sheet="" {...stylex.props(styles.sheet)}>
      <TextField size={30} label="Name" placeholder="Name" value={name} maxLength={32} autoFocus onChange={(event) => onNameChange(event.currentTarget.value)} />

      <div role="radiogroup" aria-label="Icon" {...stylex.props(styles.field)}>
        <Text variant="meta" tone="muted" weight="medium" as="span">
          Icon
        </Text>
        <div {...stylex.props(styles.icons)}>
          <IconButton
            type="button"
            role="radio"
            aria-checked={icon === undefined}
            icon={Prohibit}
            label="No icon"
            size={26}
            iconSize={14}
            variant={icon === undefined ? 'secondary' : 'ghost'}
            tone={icon === undefined ? 'default' : 'subtle'}
            onClick={() => onIconChange(undefined)}
          />
          {viewIconNames.map((each) => (
            <IconButton
              key={each}
              type="button"
              role="radio"
              aria-checked={icon === each}
              icon={viewIcons[each]}
              label={iconLabels[each]}
              size={26}
              iconSize={14}
              variant={icon === each ? 'secondary' : 'ghost'}
              tone={icon === each ? 'default' : 'subtle'}
              {...(icon === each && color !== undefined ? { iconTint: color } : {})}
              onClick={() => onIconChange(each)}
            />
          ))}
        </div>
      </div>

      {/* The colour is the icon's; the chosen icon above shows it. */}
      <div {...stylex.props(styles.field)}>
        <Text variant="meta" tone="muted" weight="medium" as="span">
          Colour
        </Text>
        <div role="radiogroup" aria-label="Colour" data-view-colors="" {...stylex.props(styles.colors)}>
          <Swatch tint="neutral" label="Neutral" selected={color === undefined} onClick={() => onColorChange(undefined)} />
          {accentNames.map((each) => (
            <Swatch key={each} tint={each} label={accentLabels[each]} selected={color === each} onClick={() => onColorChange(each)} />
          ))}
        </div>
      </div>

      <div {...stylex.props(styles.field)}>
        <TextField
          size={30}
          label="Add channels and people"
          placeholder="Add channels and people"
          leadingIcon={MagnifyingGlass}
          value={query}
          role="combobox"
          aria-expanded
          aria-controls="view-sheet-conversations"
          aria-activedescendant={active}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Enter in the search toggles the highlighted row; it never saves.
            if (event.key === 'Enter') event.preventDefault()
            keys(event)
          }}
        />
        <div {...stylex.props(styles.list)}>
          <OptionList id="view-sheet-conversations" label="Conversations" aria-multiselectable {...(active === undefined ? {} : { activeId: active })}>
            {rows.map((row) => {
              const on = chosenIds.has(row.id)
              return (
                <OptionRow
                  key={row.id}
                  id={rowId(row.id)}
                  size={30}
                  selected={on}
                  active={active === rowId(row.id)}
                  leading={<Icon icon={kindIcon(row.kind)} size={13} />}
                  label={row.name}
                  {...(on && row.addedByJuno === true ? { sub: 'Added by Juno', subPlacement: 'end' as const } : {})}
                  trailing={on ? <Icon icon={Check} size={13} /> : undefined}
                  onActivate={() => setActive(rowId(row.id))}
                  onSelect={() => onToggle(row)}
                />
              )
            })}
          </OptionList>
        </div>
        <Text variant="meta" tone="muted" as="span">
          {count === 0 ? 'No conversations yet' : count === 1 ? '1 conversation' : `${count} conversations`}
        </Text>
      </div>

      <Checkbox
        label="Keep these out of All"
        description="They show only in this view."
        checked={keepOutOfAll}
        onChange={(event) => onKeepOutOfAllChange(event.currentTarget.checked)}
      />

      <div {...stylex.props(styles.buttons)}>
        <Button type="button" variant="ghost" tone="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!canSave}>
          Save
        </Button>
      </div>
    </form>
  )
}

const styles = stylex.create({
  sheet: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
    padding: spacing['--space-1'],
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
  },
  icons: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-0-5'],
  },
  // The swatches' selected ring reaches 4px past the disc; the inset keeps it inside the sheet.
  colors: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-2'],
    paddingInline: spacing['--space-1'],
    paddingBlock: spacing['--space-1'],
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
  },
})
