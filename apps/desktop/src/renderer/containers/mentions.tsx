import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import {
  defaultPersonColor,
  insertMention,
  mentionQueryAt,
  mentionTokens,
  rankSuggestions,
  removeTokenBefore,
  type MentionChannel,
  type MentionPerson,
  type MentionPick,
  type MentionQuery,
} from '@juno/contract'
import { mentionChannelsAtom, mentionPeopleAtom, onFirstMentionAnswer, type MentionPlace } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { hueFor, MentionSuggestions, mentionRowId, type ComposerMention } from '@juno/views'

type Rows = { readonly kind: 'person'; readonly rows: ReadonlyArray<MentionPerson> } | { readonly kind: 'channel'; readonly rows: ReadonlyArray<MentionChannel> }

export interface MentionsOptions {
  readonly text: string
  /** The people and channels picked so far; the owner keeps them with the draft. */
  readonly picks: ReadonlyArray<MentionPick>
  readonly onPicks: (picks: ReadonlyArray<MentionPick>) => void
  /** The owner's change handler, which the returned `onChange` calls. */
  readonly onChange: (value: string) => void
  readonly field: RefObject<HTMLTextAreaElement | null>
  /** The conversation the composer writes to, which ranks the people. */
  readonly place: MentionPlace
}

/**
 * @ and # suggestions for a composer (spec section 8, inventory 7.1). The
 * owner keeps the text and the picks; this follows the caret, asks the
 * engine for matches (`mentions.people`, `mentions.channels`), and answers
 * the `Composer` props that draw the picked names as chips and the list
 * above the field.
 *
 * Each keystroke narrows the last answer at once (`rankSuggestions` on the
 * rows already here), and the engine's answer for the new query replaces
 * it when it lands, so the list never empties or waits while typing.
 * Picks and Backspace edit the field through `insertText` and `delete`, so
 * ⌘Z undoes them like typing.
 */
export function useMentions({ text, picks, onPicks, onChange, field, place }: MentionsOptions) {
  const listId = useId()
  const [caret, setCaret] = useState(text.length)
  // Esc closed the list for the query starting here; typing a new "@" opens it again.
  const [dismissed, setDismissed] = useState<number | undefined>(undefined)
  const [chosen, setChosen] = useState<string | undefined>(undefined)

  const tokens = mentionTokens(text, picks)
  const typed = mentionQueryAt(text, Math.min(caret, text.length), tokens)
  const query = typed !== undefined && typed.start !== dismissed ? typed : undefined

  const people = useAtomValue(mentionPeopleAtom(query?.trigger === '@' ? query.text : undefined, place))
  const channels = useAtomValue(mentionChannelsAtom(query?.trigger === '#' ? query.text : undefined))
  // The last answer, narrowed while the next one is on its way. Kept as state: a new answer replaces it during render.
  const [last, setLast] = useState<Rows | undefined>(undefined)
  const kind = query?.trigger === '@' ? 'person' : 'channel'
  const answer = query === undefined ? undefined : kind === 'person' ? people : channels
  const fresh: Rows | undefined =
    answer?._tag !== 'Success'
      ? undefined
      : kind === 'person'
        ? { kind, rows: answer.value as ReadonlyArray<MentionPerson> }
        : { kind, rows: answer.value as ReadonlyArray<MentionChannel> }
  if (fresh !== undefined && fresh.rows !== last?.rows) setLast(fresh)
  let rows: Rows | undefined = fresh
  if (query !== undefined && rows === undefined) {
    if (last?.kind === 'person' && kind === 'person') rows = { kind, rows: rankSuggestions(last.rows, query.text) }
    else if (last?.kind === 'channel' && kind === 'channel') rows = { kind, rows: rankSuggestions(last.rows, query.text) }
  }
  const ids = rows === undefined ? [] : rows.rows.map((row) => mentionRowId(listId, row.id))
  const activeId = chosen !== undefined && ids.includes(chosen) ? chosen : ids[0]
  const open = query !== undefined && rows !== undefined && rows.rows.length > 0

  /** Replaces `from`..`to` in the field the way typing would, so it can be undone. */
  const edit = (from: number, to: number, insert: string) => {
    const element = field.current
    if (element === null) return
    element.setSelectionRange(from, to)
    if (insert === '') document.execCommand('delete')
    else document.execCommand('insertText', false, insert)
  }

  /** Puts `row` in place of the query `at`, and keeps it with the picks. */
  const insertPick = (at: MentionQuery, row: MentionPerson | MentionChannel) => {
    const picked: MentionPick = { kind: at.trigger === '@' ? 'person' : 'channel', id: row.id, name: row.name }
    if (!picks.some((p) => p.kind === picked.kind && p.id === picked.id && p.name === picked.name)) onPicks([...picks, picked])
    const after = insertMention(text, at, picked)
    // Only what changes is typed: the name, and the space when there is none yet.
    edit(at.start, at.end, after.text.slice(at.start, after.caret))
  }

  const pick = (rowId: string) => {
    const row = rows?.rows[ids.indexOf(rowId)]
    if (query === undefined || row === undefined) return
    insertPick(query, row)
    setChosen(undefined)
  }

  // Enter or Tab before the engine answered a query the narrowed list had nothing for: the first
  // row of the answer goes in when it lands, so "#pla" and a quick Enter never sends "#pla".
  const held = useRef<(() => void) | undefined>(undefined)
  const hold = (at: MentionQuery) => {
    held.current?.()
    held.current = onFirstMentionAnswer(at.trigger, at.text, place, (answer) => {
      held.current = undefined
      const first = answer[0]
      // Typing went on meanwhile: that text decides, not this answer.
      if (first !== undefined && field.current?.value === text) insertPick(at, first)
    })
  }

  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false
    if (open && activeId !== undefined) {
      const index = ids.indexOf(activeId)
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          setChosen(ids[(index + step + ids.length) % ids.length])
          return true
        }
        case 'Enter':
        case 'Tab':
          if (event.shiftKey) return false
          event.preventDefault()
          pick(activeId)
          return true
        case 'Escape':
          event.preventDefault()
          setDismissed(query?.start)
          return true
      }
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && query !== undefined && fresh === undefined) {
      event.preventDefault()
      hold(query)
      return true
    }
    if (event.key === 'Backspace' && !event.shiftKey) {
      const element = event.currentTarget
      if (element.selectionStart !== element.selectionEnd) return false
      const removed = removeTokenBefore(text, element.selectionStart, tokens)
      if (removed === undefined) return false
      event.preventDefault()
      const token = tokens.find((t) => t.start === removed.caret)
      if (token !== undefined) edit(token.start, token.end, '')
      return true
    }
    return false
  }

  const mention: ComposerMention | undefined =
    typed === undefined
      ? undefined
      : {
          anchorAt: typed.start,
          listId,
          activeId: open ? activeId : undefined,
          list: open && rows !== undefined ? <MentionSuggestions {...rows} id={listId} activeId={activeId} onActivate={setChosen} onPick={pick} /> : null,
          onDismiss: () => setDismissed(typed.start),
        }

  return {
    onChange: (value: string, at: number) => {
      setCaret(at)
      // Typing goes on: a held Enter is dropped.
      held.current?.()
      held.current = undefined
      // A new query, or none: Esc's choice was for the one before.
      if (dismissed !== undefined && mentionQueryAt(value, at, mentionTokens(value, picks))?.start !== dismissed) setDismissed(undefined)
      onChange(value)
    },
    onCaret: setCaret,
    onFieldKey,
    marks: tokens.map((token) => ({
      start: token.start,
      end: token.end,
      look: token.pick.kind,
      ...(token.pick.kind === 'person' ? { hue: hueFor(defaultPersonColor(token.pick.id), token.pick.id) } : {}),
    })),
    ...(mention === undefined ? {} : { mention }),
  }
}
