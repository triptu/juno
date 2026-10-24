/**
 * The Search field's wiring (SPEC 10a, "The query"): words typed, finished
 * operators turned into chips, the from: and in: picker searched as ⌘K's
 * Conversations tab, chips edited and removed, and the caret kept where the
 * user left it.
 */
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { registry, searchPicksAtom, updateSearchSession, type SearchChip, type SearchSession } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import type { SearchChipView, SearchPickerRow } from '@juno/views'
import { useHeld } from '../pickerRows'
import { chipText, operatorAt, takeChips } from './chips'

const PICKER_ROWS = 8

export const chipViewsOf = (chips: ReadonlyArray<SearchChip>): ReadonlyArray<SearchChipView> =>
  chips.map((chip, index) => ({
    key: `${index}:${chip.token}`,
    op: chip.op,
    label: chip.label,
    ...(chip.token.startsWith('-') ? { negated: true } : {}),
    ...(chip.person === undefined ? {} : { person: chip.person }),
    ...(chip.place === undefined ? {} : { place: chip.place }),
  }))

/** The field's chips: ⌘F's topic first, then the filters in the order they were added. */
function chipViews(session: SearchSession): ReadonlyArray<SearchChipView> {
  const topic = session.topic
  const scope = topic === undefined ? [] : [{ key: 'topic', op: 'topic' as const, label: topic.title, topic: { id: topic.topicId, ...(topic.art === undefined ? {} : { art: topic.art }) } }]
  return [...scope, ...chipViewsOf(session.chips)]
}

const chipIndex = (key: string) => Number(key.slice(0, key.indexOf(':')))
const joined = (text: string, word: string) => `${text.trimEnd()}${text.trim() === '' ? '' : ' '}${word}`

/** The picker's rows: people for from:, conversations with a Main for in:. */
function usePickerRows(op: 'from' | 'in' | undefined, query: string | undefined): ReadonlyArray<SearchPickerRow> {
  const open = op !== undefined
  const picks = useHeld(useAtomValue(searchPicksAtom(open ? query : undefined)), open).value
  return useMemo(() => {
    const rows: SearchPickerRow[] = []
    for (const pick of picks ?? []) {
      const highlight = pick.highlight === undefined ? {} : { highlight: pick.highlight }
      if (op === 'from' && pick.person !== undefined && pick.kind === 'im') rows.push({ id: pick.person.id, name: pick.person.name, kind: 'im', person: pick.person, ...highlight })
      if (op === 'in' && pick.channelId !== undefined) rows.push({ id: pick.channelId, name: pick.name, kind: pick.kind, ...(pick.person === undefined ? {} : { person: pick.person }), ...highlight })
    }
    return rows.slice(0, PICKER_ROWS)
  }, [picks, op])
}

export function useSearchField(sessionId: string, session: SearchSession, inputRef: RefObject<HTMLInputElement | null>, onEdit: () => void) {
  const update = (change: (current: SearchSession) => SearchSession, source: 'action' | 'typing' = 'action') => {
    onEdit()
    updateSearchSession(registry, sessionId, change, source)
  }
  const [caret, setCaret] = useState(session.text.length)
  const [dismissed, setDismissed] = useState<string | undefined>(undefined)
  const pendingCaret = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === undefined) return
    pendingCaret.current = undefined
    inputRef.current?.setSelectionRange(at, at)
  })
  /** New text and where the caret goes in it, once the field shows it. */
  const place = (text: string, at: number, change: (current: SearchSession) => SearchSession) => {
    setCaret(at)
    pendingCaret.current = at
    update((current) => ({ ...change(current), text }))
  }

  const operator = operatorAt(session.text, caret)
  const pickerKey = operator === undefined ? undefined : `${operator.at}:${session.text}`
  const pickerOpen = operator !== undefined && dismissed !== pickerKey
  const rows = usePickerRows(pickerOpen ? operator.op : undefined, operator?.query)

  const pick = (id: string) => {
    const row = rows.find((candidate) => candidate.id === id)
    if (row === undefined || operator === undefined) return
    const negated = operator.negated ? '-' : ''
    const chip: SearchChip =
      operator.op === 'from'
        ? { op: 'from', token: `${negated}from:${row.id}`, label: row.name, ...(row.person === undefined ? {} : { person: row.person }) }
        : { op: 'in', token: `${negated}in:${row.id}`, label: row.name, place: { kind: row.kind } }
    const before = session.text.slice(0, operator.at).replace(/\s+$/, '')
    const after = session.text.slice(operator.end).replace(/^\s+/, '')
    place(before === '' || after === '' ? before + after : `${before} ${after}`, before.length, (current) => ({ ...current, chips: [...current.chips, chip] }))
  }

  const field = {
    chips: chipViews(session),
    text: session.text,
    inputRef,
    onText: (text: string, at: number) => {
      const taken = takeChips(text, at)
      setCaret(taken.caret)
      if (taken.chips.length > 0) pendingCaret.current = taken.caret
      update((current) => ({ ...current, text: taken.text, chips: [...current.chips, ...taken.chips] }), 'typing')
    },
    onChip: (key: string) => {
      const chip = key === 'topic' ? undefined : session.chips[chipIndex(key)]
      if (chip === undefined) return
      const text = joined(session.text, chipText(chip))
      place(text, text.length, (current) => ({ ...current, chips: current.chips.toSpliced(chipIndex(key), 1) }))
      inputRef.current?.focus()
    },
    onRemoveChip: (key: string) => (key === 'topic' ? update(({ topic: _topic, ...current }) => current) : update((current) => ({ ...current, chips: current.chips.toSpliced(chipIndex(key), 1) }))),
    onClear: () => {
      place('', 0, ({ topic: _topic, selected: _selected, scrollTop: _top, offset: _offset, ...current }) => ({ ...current, chips: [] }))
      inputRef.current?.focus()
    },
    onFocus: () => setCaret(inputRef.current?.selectionStart ?? session.text.length),
    picker: pickerOpen && rows.length > 0 ? { at: operator.at, heading: operator.op === 'from' ? 'People' : 'Conversations', kinds: operator.op === 'in', rows, onPick: pick, onClose: () => setDismissed(pickerKey) } : undefined,
  }
  return {
    field,
    pickerOpen: operator !== undefined,
    closePicker: () => setDismissed(pickerKey),
    /** A word from a filter menu ("from:", "on:"), typed at the field's end, with the caret after it. */
    typeOperator: (word: string) => {
      const text = joined(session.text, word)
      place(text, text.length, (current) => current)
      inputRef.current?.focus()
    },
    /** A recent search, or a character typed on a row, into the field. */
    setText: (text: string, change: (current: SearchSession) => SearchSession = (current) => current) => place(text, text.length, change),
  }
}
