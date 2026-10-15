/** Probes and helpers the scenarios share: the visible topic pane, and tagging an element so a probe can find it. */
import type { Locator } from '@playwright/test'
import { noLayoutShift } from './checks'
import type { Probe, ProbeFrame } from './recorder'

const VIEW = '[data-topic-view]'
export const SCROLLER = `${VIEW} [data-scroll]`

/** The active topic: header text, scroll position, rows, the divider, the rows at the top and bottom edges, reactions and loaded images. */
export const topicProbes: ReadonlyArray<Probe> = [
  { kind: 'text', name: 'header', selector: `${VIEW} [data-topic-header]` },
  { kind: 'scroll', name: 'scroll', selector: SCROLLER },
  { kind: 'count', name: 'rows', within: VIEW, selector: '[data-message-row]' },
  { kind: 'rect', name: 'divider', selector: `${VIEW} [data-new-divider]` },
  { kind: 'edge', name: 'top', scroller: SCROLLER, rowKey: 'data-message-row', side: 'top' },
  { kind: 'edge', name: 'bottom', scroller: SCROLLER, rowKey: 'data-message-row', side: 'bottom' },
  { kind: 'count', name: 'reactions', within: VIEW, selector: '[role="list"][aria-label="Reactions"]' },
  { kind: 'images', name: 'images', within: VIEW },
]

/** The message list and the sidebar, for the pixel checks and for telling where a shift happened. */
export const paneRegions = { pane: SCROLLER, sidebar: 'aside[aria-label="Sidebar"]' } as const

/**
 * A live message moves its topic to the top of Recent (SPEC section 5, "sorted by
 * latest activity"), so sidebar rows shift by design. Report it, do not fail.
 */
export const sidebarReorder = (from: string) => noLayoutShift({ from, includeInput: true, region: 'sidebar', label: 'the sidebar holds still', warn: true })

export const header = (values: ProbeFrame['values']): string => (typeof values['header'] === 'string' ? values['header'] : 'no header')

export const edgeKey = (values: ProbeFrame['values'], edge: 'top' | 'bottom'): string => {
  const value = values[edge]
  return typeof value === 'object' && value !== null && 'key' in value ? value.key : 'no rows'
}

/** A `rect` probe's box, or undefined when the element was not there. */
export const rect = (values: ProbeFrame['values'], name: string): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined => {
  const value = values[name]
  return typeof value === 'object' && value !== null && 'y' in value && 'height' in value && 'x' in value && 'width' in value
    ? { x: Number(value.x), y: Number(value.y), width: Number(value.width), height: Number(value.height) }
    : undefined
}

export const count = (values: ProbeFrame['values'], name: string): number => (typeof values[name] === 'number' ? values[name] : 0)

/** Marks an element with `data-feel="<name>"` so a probe can select it. React leaves attributes it does not own alone. */
export async function tag(locator: Locator, name: string): Promise<string> {
  await locator.evaluate((el, value) => el.setAttribute('data-feel', value), name)
  return `[data-feel="${name}"]`
}

/** The first row in view in the active topic and its top's offset from the scroller's top, as the `top` edge probe reads it. */
export function topEdgeNow(scroller: Locator): Promise<{ readonly key: string; readonly at: number }> {
  return scroller.evaluate((el) => {
    const box = el.getBoundingClientRect()
    for (const row of el.querySelectorAll<HTMLElement>('[data-message-row]')) {
      const r = row.getBoundingClientRect()
      if (r.height === 0 || r.bottom <= box.top || r.top >= box.bottom) continue
      return { key: row.getAttribute('data-message-row') ?? '', at: Math.round((r.top - box.top) * 10) / 10 }
    }
    throw new Error('No row in view')
  })
}
