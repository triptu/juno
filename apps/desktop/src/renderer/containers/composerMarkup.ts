import type { KeyboardEvent } from 'react'
import type { MarkupLayout } from '@juno/contract'
import { chunk, usePreloaded } from './chunks'

type Rules = typeof import('./markupRules')

// The rules load when idle after a composer mounts, as the suggestion list does (performance 2.1).
let rules: Rules | undefined
const markupRules = chunk(() => import('./markupRules').then((module) => (rules = module)))

/** Nothing styled: the field is drawn by its layer from the first render, so it is not mounted again when the rules arrive. */
const PLAIN: MarkupLayout = { spans: [], markers: [], codeBlocks: [], quotes: [] }

/**
 * Slack's markup in a composer (spec section 8), while `on`: the field's
 * `format` prop, to spread on it, and the formatting keys, which `onKey`
 * takes (true when it took the key). Until the rules have loaded the field
 * draws plain text, and a formatting key acts once they have: no such key
 * does anything else in a text field.
 */
export function useComposerMarkup(on: boolean) {
  const ready = usePreloaded(markupRules, false)
  return {
    format: (text: string, opaque: ReadonlyArray<{ readonly start: number; readonly end: number }> = []): { readonly format?: MarkupLayout } =>
      !on ? {} : { format: ready && rules !== undefined ? rules.markupLayout(text, opaque) : PLAIN },
    onKey: (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!on || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return false
      const { key, code, metaKey, shiftKey, ctrlKey, altKey, currentTarget: field } = event
      const press = { key, code, metaKey, shiftKey, ctrlKey, altKey, field }
      if (rules === undefined) {
        void markupRules.load().then((loaded) => loaded.formatKey(press))
        return false
      }
      if (!rules.formatKey(press)) return false
      event.preventDefault()
      return true
    },
  }
}
