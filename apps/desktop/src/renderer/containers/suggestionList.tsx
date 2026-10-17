import { Suspense, useEffect, type ComponentProps } from 'react'
import { chunk } from './chunks'

/**
 * The @, # and : suggestion list (`MentionSuggestions`), loaded on its own:
 * it only shows once a trigger is typed. A composer fetches it when idle
 * after it mounts, before the first trigger can need it.
 */
const suggestions = chunk(() => import('./SuggestionListPanel'))
const Panel = suggestions.component((module) => module.MentionSuggestions)

let preloaded = false

/**
 * Preloads the list once a composer has mounted, and loads it at once when
 * `wanted` (a trigger typed before the idle preload). True once it has
 * loaded, so the list never suspends: until then the composer shows none.
 */
export function useSuggestionList(wanted: boolean): boolean {
  const ready = suggestions.useReady()
  useEffect(() => {
    if (preloaded) return
    preloaded = true
    requestIdleCallback(() => void suggestions.load(), { timeout: 5_000 })
  }, [])
  useEffect(() => {
    if (wanted && !ready) void suggestions.load()
  }, [wanted, ready])
  return ready
}

export function SuggestionList(props: ComponentProps<typeof Panel>) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  )
}
