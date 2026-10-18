import { useEffect } from 'react'
import { registry, showToast, type MessageWindow } from '@juno/state'

// A message can be visible in Main and its thread, or in several tabs.
const announced = new Set<string>()

export function useReactionFailureToast(list: MessageWindow): void {
  useEffect(() => {
    for (const row of list.rows.values()) {
      const issue = row.reactionIssue
      if (issue?.state !== 'failed' || announced.has(issue.key)) continue
      announced.add(issue.key)
      showToast(registry, { text: 'Reaction not sent' })
    }
  }, [list.rows])
}
