import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { dismissSentSuggestion, registry, sentSuggestionsAtom, type MessageWindow, type SentSuggestion } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import type { MessageProps } from '@juno/views'
import type { Editing } from './messageCommands'

/** "its → it's", "2 small fixes", or the long-sentence note. */
function labelOf(suggestion: SentSuggestion): { readonly label: string; readonly detail?: string } {
  const { fixes, note } = suggestion.finding
  if (fixes.length === 0) return { label: note ?? '' }
  if (fixes.length === 1) return { label: fixes[0]!, ...(note === undefined ? {} : { detail: note }) }
  return { label: `${fixes.length} small fixes`, detail: fixes.join(', ') }
}

/**
 * The fix lines of the messages in this list, by `ts` (SPEC section 8). A line belongs to the text as sent:
 * once the message is edited it goes, and while it is being edited it hides.
 */
export function useSentSuggestions(list: MessageWindow, setEditing: Dispatch<SetStateAction<Editing | undefined>>, editing: Editing | undefined) {
  const suggestions = useAtomValue(sentSuggestionsAtom)
  const found = useMemo(() => {
    const out: Array<{ readonly suggestion: SentSuggestion; readonly ts: string; readonly changed: boolean }> = []
    if (suggestions.size === 0) return out
    for (const row of list.rows.values()) {
      const suggestion = row.clientMsgId === undefined ? undefined : suggestions.get(row.clientMsgId)
      if (suggestion !== undefined && suggestion !== null) out.push({ suggestion, ts: row.ts, changed: row.editText !== suggestion.original })
    }
    return out
  }, [suggestions, list])
  useEffect(() => {
    for (const { suggestion, changed } of found) if (changed) dismissSentSuggestion(registry, suggestion.clientMsgId)
  }, [found])
  return useMemo(() => {
    const out = new Map<string, NonNullable<MessageProps['suggestion']>>()
    for (const { suggestion, ts, changed } of found) {
      if (changed || editing?.ts === ts) continue
      out.set(ts, {
        ...labelOf(suggestion),
        onReview: () => {
          setEditing({ ts, text: suggestion.finding.fixed })
          dismissSentSuggestion(registry, suggestion.clientMsgId)
        },
        onDismiss: () => dismissSentSuggestion(registry, suggestion.clientMsgId),
      })
    }
    return out
  }, [found, editing, setEditing])
}
