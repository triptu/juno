import { Suspense, type ComponentProps } from 'react'
import { chunk, usePreloaded } from './chunks'

/**
 * The @, # and : suggestion list (`MentionSuggestions`), loaded on its own:
 * it only shows once a trigger is typed. A composer fetches it when idle
 * after it mounts, before the first trigger can need it.
 */
const suggestions = chunk(() => import('./SuggestionListPanel'))
const Panel = suggestions.component((module) => module.MentionSuggestions)

/** True once the list has loaded; until then the composer shows none. `wanted`: a trigger typed before the idle preload. */
export function useSuggestionList(wanted: boolean): boolean {
  return usePreloaded(suggestions, wanted)
}

export function SuggestionList(props: ComponentProps<typeof Panel>) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  )
}
