/**
 * The from: and in: picker under the Search field (SPEC 10a, inventory
 * 9a): ⌘K's Conversations rows, 36px, the kind's icon or the person's
 * photo, the matched part in semibold, the kind at the end. Its left edge
 * sits under the operator being typed. The field keeps focus; its keys move
 * the active row (`usePickerKeys`).
 */
import * as stylex from '@stylexjs/stylex'
import { useState, type KeyboardEvent } from 'react'
import { colors, layout, spacing, z } from '@juno/tokens/tokens.stylex'
import { Avatar, Icon, OptionGroupLabel, OptionList, OptionRow, Surface } from '@juno/ui'
import { Highlighted } from '../Highlighted'
import { hueFor, initials, kindIcon } from '../look'
import type { SearchPickerRow } from './model'

export interface SearchFieldPicker {
  /** Where the operator being typed starts in the field's text: the picker's left edge sits under it. */
  readonly at: number
  /** "People" for from:, "Conversations" for in:. */
  readonly heading: string
  readonly rows: ReadonlyArray<SearchPickerRow>
  readonly onPick: (id: string) => void
  readonly onClose: () => void
}

const kindLabels = { public: 'Public channel', private: 'Private channel', im: 'Direct message', mpim: 'Group DM' } as const

export const pickRowId = (id: string) => `search-pick-${id}`

/** The active row, which a new set of rows resets to the first; and the keys that move and pick it. Undefined: the keys are not the picker's. */
export function usePickerKeys(picker: SearchFieldPicker | undefined) {
  const [active, setActive] = useState<{ readonly rows: SearchFieldPicker['rows'] | undefined; readonly id: string | undefined }>({ rows: undefined, id: undefined })
  const activeId = picker === undefined ? undefined : active.rows === picker.rows ? active.id : picker.rows[0]?.id
  if (picker !== undefined && active.rows !== picker.rows) setActive({ rows: picker.rows, id: picker.rows[0]?.id })
  const activate = (id: string) => picker !== undefined && setActive({ rows: picker.rows, id })

  /** True when the key was the picker's. */
  const onKey = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    if (picker === undefined || picker.rows.length === 0) return false
    const ids = picker.rows.map((row) => row.id)
    const index = activeId === undefined ? -1 : ids.indexOf(activeId)
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        const to = event.key === 'ArrowDown' ? index + 1 : index <= 0 ? ids.length - 1 : index - 1
        activate(ids[(to + ids.length) % ids.length]!)
        return true
      }
      case 'Enter':
      case 'Tab':
        if (activeId === undefined) return false
        event.preventDefault()
        picker.onPick(activeId)
        return true
      case 'Escape':
        event.preventDefault()
        picker.onClose()
        return true
      default:
        return false
    }
  }
  return { activeId, activate, onKey }
}

export function SearchPicker({ picker, left, activeId, onActivate }: { readonly picker: SearchFieldPicker; readonly left: number; readonly activeId: string | undefined; readonly onActivate: (id: string) => void }) {
  return (
    <div {...stylex.props(styles.anchor, leftOf(left))}>
      <Surface kind="popover" radius="xl" padding="sm">
        <OptionList label={picker.heading} id="search-picker">
          <OptionGroupLabel>{picker.heading}</OptionGroupLabel>
          {picker.rows.map((row) => (
            <OptionRow
              key={row.id}
              id={pickRowId(row.id)}
              size={36}
              active={row.id === activeId}
              leading={<PickerMark row={row} />}
              label={<Highlighted text={row.name} ranges={row.highlight} />}
              sub={kindLabels[row.kind]}
              subPlacement="end"
              onActivate={() => onActivate(row.id)}
              onSelect={() => picker.onPick(row.id)}
            />
          ))}
        </OptionList>
      </Surface>
    </div>
  )
}

function PickerMark({ row }: { readonly row: SearchPickerRow }) {
  const person = row.person
  if (person !== undefined) return <Avatar size={20} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
  return (
    <span {...stylex.props(styles.icon)}>
      <Icon icon={kindIcon(row.kind)} size={16} />
    </span>
  )
}

const leftOf = stylex.create({
  at: (left: number) => ({ insetInlineStart: left }),
}).at

const styles = stylex.create({
  anchor: {
    position: 'absolute',
    top: `calc(100% + ${spacing['--space-1-5']})`,
    width: layout['--send-to-width'],
    zIndex: z['--z-picker'],
  },
  icon: {
    display: 'flex',
    color: colors['--foreground-muted'],
    marginInline: spacing['--space-0-5'],
  },
})
