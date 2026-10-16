import { useEffect, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { dismissSentSuggestion, registry, sentSuggestionAtom, type MessageWindow } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import type { Editing } from './messageCommands'

/** A suggestion belongs to the original message text, never a later edit. */
export function useSentSuggestion(topicId: string, list: MessageWindow, setEditing: Dispatch<SetStateAction<Editing | undefined>>, editing: Editing | undefined) {
  const suggestion = useAtomValue(sentSuggestionAtom)
  const message = suggestion?.topicId === topicId ? [...list.rows.values()].find((row) => row.clientMsgId === suggestion.clientMsgId) : undefined
  const ready = message !== undefined
  const [offered, setOffered] = useState<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (suggestion === undefined || suggestion.topicId !== topicId || !ready) return
    if (performance.now() - suggestion.sentAt >= 1000 || document.visibilityState !== 'visible') {
      dismissSentSuggestion(registry)
      return
    }
    // Gate the first paint against the deadline after the row is in the DOM.
    // oxlint-disable-next-line react/set-state-in-effect
    setOffered(suggestion.clientMsgId)
  }, [suggestion, topicId, ready])
  const valid = editing === undefined && offered === suggestion?.clientMsgId && message !== undefined && message.editText === suggestion?.original
  useEffect(() => {
    if (suggestion === undefined || suggestion.topicId !== topicId) return
    const dismiss = () => dismissSentSuggestion(registry)
    if (editing !== undefined || document.visibilityState !== 'visible' || (message !== undefined && message.editText !== suggestion.original)) dismiss()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', dismiss)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('visibilitychange', dismiss)
    }
  }, [suggestion, message, topicId, editing])
  if (!valid || suggestion === undefined || message === undefined) return undefined
  return {
    ts: message.ts,
    value: {
      label: suggestion.finding.fixes.join(', ') || suggestion.finding.note || '',
      onEdit: () => {
        setEditing({ ts: message.ts, text: suggestion.finding.fixed })
        dismissSentSuggestion(registry)
      },
    },
  }
}
