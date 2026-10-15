import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import { composerEmojiAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { MentionSuggestions, mentionRowId, type ComposerMention, type EmojiSuggestion } from '@juno/views'
import { noteRecentEmoji, recentEmoji } from './recentEmoji'
import { editField, listKey } from './suggestionKeys'

interface Options {
  readonly text: string
  readonly onChange: (value: string) => void
  readonly field: RefObject<HTMLTextAreaElement | null>
}

const queryAt = (text: string, caret: number) => {
  const match = /(?:^|[^\p{L}\p{N}_:])(:([a-zA-Z0-9_+-]{2,}))$/u.exec(text.slice(0, caret))
  return match?.[1] === undefined ? undefined : { start: caret - match[1].length, end: caret, text: match[2]!.toLowerCase() }
}

function useEmojiRows() {
  const custom = useAtomValue(composerEmojiAtom)
  const [standard, setStandard] = useState<ReadonlyArray<EmojiSuggestion>>([])
  useEffect(() => {
    let live = true
    const idle = requestIdleCallback(() => { void import('./emojiMatches').then((data) => { if (live) setStandard(data.standardEmoji) }) })
    return () => { live = false; cancelIdleCallback(idle) }
  }, [])
  return useMemo(() => {
    if (custom._tag !== 'Success') return standard
    const byName = new Map(custom.value.map((emoji) => [emoji.name, emoji]))
    const rows = custom.value.flatMap((emoji) => {
      let target: typeof emoji | undefined = emoji
      const seen = new Set<string>()
      while (target?.url == null && target?.alias_for != null && !seen.has(target.name)) {
        seen.add(target.name)
        target = byName.get(target.alias_for)
      }
      return target?.url == null ? [] : [{ id: emoji.name, name: emoji.name, insert: `:${emoji.name}:`, url: target.url }]
    })
    const names = new Set(rows.map((row) => row.name))
    return [...rows, ...standard.filter((row) => !names.has(row.name))].toSorted((a, b) => a.name.localeCompare(b.name))
  }, [custom, standard])
}

function matching(rows: ReadonlyArray<EmojiSuggestion>, query: string) {
  const recent = recentEmoji()
  const matches = rows.filter((row) => row.name.includes(query))
  const frequent = recent.flatMap((name) => matches.find((row) => row.name === name) ?? [])
  const rest = matches.filter((row) => !recent.includes(row.name))
  return [...frequent, ...rest.filter((row) => row.name.startsWith(query)), ...rest.filter((row) => !row.name.startsWith(query))].slice(0, 8)
}

/** Local colon suggestions share the mention list's anchor, rows, and keyboard handling. */
export function useEmojiSuggestions({ text, onChange, field }: Options) {
  const catalog = useEmojiRows()
  const listId = useId()
  const [caret, setCaret] = useState(text.length)
  const [dismissed, setDismissed] = useState<number | undefined>(undefined)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const typed = queryAt(text, Math.min(caret, text.length))
  const query = typed?.start === dismissed ? undefined : typed
  const rows = query === undefined ? [] : matching(catalog, query.text)
  const ids = rows.map((row) => mentionRowId(listId, row.id))
  const activeId = chosen !== undefined && ids.includes(chosen) ? chosen : ids[0]
  const pick = (id: string) => {
    const row = rows[ids.indexOf(id)]
    if (query === undefined || row === undefined) return
    noteRecentEmoji(row.name)
    editField(field.current, query.start, query.end, `${row.insert} `)
    setChosen(undefined)
  }
  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false
    if (event.key === ':' && typed !== undefined && event.currentTarget.selectionStart === event.currentTarget.selectionEnd) {
      const exact = catalog.find((row) => row.name === typed.text)
      if (exact !== undefined) {
        event.preventDefault()
        noteRecentEmoji(exact.name)
        editField(field.current, typed.start, typed.end, exact.insert)
        setDismissed(typed.start)
        return true
      }
    }
    return activeId !== undefined && listKey(event, ids, activeId, { move: setChosen, pick, close: () => setDismissed(query?.start) })
  }
  return {
    onChange: (value: string, at: number) => {
      setCaret(at)
      if (queryAt(value, at)?.start !== dismissed) setDismissed(undefined)
      onChange(value)
    },
    onCaret: setCaret,
    onFieldKey,
    marks: [],
    mention: query === undefined ? undefined : {
      anchorAt: query.start, listId, activeId,
      list: rows.length === 0 ? null : <MentionSuggestions kind="emoji" rows={rows} id={listId} activeId={activeId} onActivate={setChosen} onPick={pick} />,
      onDismiss: () => setDismissed(query.start),
    } satisfies ComposerMention,
  }
}
