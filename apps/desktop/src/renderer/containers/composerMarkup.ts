import type { KeyboardEvent } from 'react'
import type { MarkupLayout } from '@juno/contract'
import { chunk, usePreloaded } from './chunks'

type Rules = typeof import('./markupRules')

// Slack composers start loading at mount; Home also warms the rules when idle.
let rules: Rules | undefined
const markupRules = chunk(() => import('./markupRules').then(async (module) => { await module.prepareTextareaFormatting(); return (rules = module) }))

/** Nothing styled: the field is drawn by its layer from the first render, so it is not mounted again when the rules arrive. */
const pendingSends = new WeakSet<HTMLTextAreaElement>()
const PLAIN: MarkupLayout = { spans: [], markers: [], codeBlocks: [], quotes: [] }

/**
 * Slack's markup in a composer (spec section 8), while `on`: the field's
 * `format` prop, to spread on it, and the formatting keys, which `onKey`
 * takes (true when it took the key). Until the rules have loaded the field
 * draws plain text, and a formatting key acts once they have: no such key
 * does anything else in a text field.
 */
export function useComposerMarkup(on: boolean) {
  'use no memo' // These small callbacks already change with the input; avoid eager compiler cache scaffolding.
  const ready = usePreloaded(markupRules, on)
  return {
    send: (action: () => void, field: HTMLTextAreaElement | null): void => {
      if (!on || ready) return action()
      if (field === null || pendingSends.has(field)) return
      pendingSends.add(field)
      const value = field.value
      void markupRules.load().then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        pendingSends.delete(field)
        if (field.isConnected && field.value === value) action()
      })))
    },
    format: (text: string, opaque: ReadonlyArray<{ readonly start: number; readonly end: number }> = []): { readonly format?: MarkupLayout } =>
      !on ? {} : { format: ready && rules !== undefined ? rules.markupLayout(text, opaque) : PLAIN },
    onKey: (event: KeyboardEvent<HTMLTextAreaElement>, atomic: ReadonlyArray<{ readonly start: number; readonly end: number }> = []): boolean => {
      if (!on || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return false
      const { key, code, metaKey, shiftKey, ctrlKey, altKey, currentTarget: field } = event
      const press = { key, code, metaKey, shiftKey, ctrlKey, altKey, field, value: field.value, start: field.selectionStart, end: field.selectionEnd, atomic }
      if (rules === undefined) {
        if (altKey || !(shiftKey ? /^[xc]$/i.test(key) || code === 'Digit9' : /^[bi]$/i.test(key))) return false
        event.preventDefault()
        let cancelled = false
        const cancel = () => { cancelled = true }
        field.addEventListener('blur', cancel)
        field.addEventListener('compositionstart', cancel)
        void markupRules.load().then((loaded) => {
          field.removeEventListener('blur', cancel)
          field.removeEventListener('compositionstart', cancel)
          if (!cancelled) loaded.formatKey(press)
        })
        return true
      }
      if (!rules.formatKey(press)) return false
      event.preventDefault()
      return true
    },
  }
}
