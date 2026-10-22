import { useEffect } from 'react'
import { chunk } from '@juno/ui'
import type { SelectionToolbarProps } from './SelectionToolbar'
import type { HoverToolbarProps } from './HoverToolbarContent'

export type { HoverToolbarProps } from './HoverToolbarContent'

const toolbar = chunk(() => import('./HoverToolbarContent'))
export const loadMessageTools = toolbar.load
const Content = toolbar.component((module) => module.HoverToolbar)
const Selection = toolbar.component((module) => module.SelectionToolbar)
let warming = false

/** One idle import for all message rows; their existing toolbar slots keep their geometry. */
function preload(): void {
  if (warming) return
  warming = true
  requestIdleCallback(() => void toolbar.load(), { timeout: 2_000 })
}

export function HoverToolbar(props: HoverToolbarProps) {
  const ready = toolbar.useReady()
  useEffect(preload, [])
  return ready ? <Content {...props} /> : null
}

/** Uses the same idle preload as the message toolbars. */
export function SelectionToolbar(props: SelectionToolbarProps) {
  const ready = toolbar.useReady()
  useEffect(preload, [])
  return ready ? <Selection {...props} /> : null
}
