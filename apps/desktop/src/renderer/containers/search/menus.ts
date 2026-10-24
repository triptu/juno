/**
 * The filter row's menus (SPEC 10a, "The query"): From and In list Slack's
 * people and conversations for the query with their match counts first,
 * then a way to pick anyone else in the field; Date its presets; Has its
 * four kinds; and the sort. Native menus, as every menu in Juno is.
 */
import { searchCalendar, type ContextMenuItem, type SearchSnapshot } from '@juno/contract'
import { popupContextMenu, registry, runCommand, updateSearchSession, type SearchChip, type SearchSession } from '@juno/state'
import type { SearchFilterMenu } from '@juno/views'
import { dateChip, datePresets, type DatePreset } from './chips'

type Facets = SearchSnapshot['facets'] | undefined

const hasLabels = { link: 'A link', file: 'A file', reaction: 'A reaction', pin: 'A pin' } as const

function menuItems(menu: SearchFilterMenu, session: SearchSession, facets: Facets): ContextMenuItem[] {
  const has = (token: string) => session.chips.some((chip) => chip.token === token)
  const set = (op: SearchChip['op']) => session.chips.some((chip) => chip.op === op)
  switch (menu) {
    case 'from': {
      const people = (facets?.from ?? []).flatMap((facet) => (facet.person === undefined ? [] : [{ id: `from:${facet.id}`, label: facet.person.name, sublabel: String(facet.count), checked: has(`from:${facet.id}`) }]))
      return [...people, ...(people.length > 0 ? [{ separator: true } as const] : []), { id: 'other:from:', label: 'Someone else…' }, ...(set('from') ? [{ id: 'any:from', label: 'Anyone' }] : [])]
    }
    case 'in': {
      const places = (facets?.in ?? []).flatMap((facet) => (facet.place === undefined ? [] : [{ id: `in:${facet.id}`, label: facet.place.label, sublabel: String(facet.count), checked: has(`in:${facet.id}`) }]))
      return [...places, ...(places.length > 0 ? [{ separator: true } as const] : []), { id: 'other:in:', label: 'Another conversation…' }, ...(set('in') ? [{ id: 'any:in', label: 'Anywhere' }] : [])]
    }
    case 'date':
      return [
        ...datePresets.map((preset) => ({ id: `date:${preset.id}`, label: preset.label, checked: session.chips.some((chip) => chip.op === 'date' && chip.label === preset.label) })),
        { separator: true },
        { id: 'other:on:', label: 'On a day…' },
        ...(set('date') ? [{ id: 'any:date', label: 'Any time' }] : []),
      ]
    case 'has':
      return (['link', 'file', 'reaction', 'pin'] as const).map((value) => ({ id: `has:${value}`, label: hasLabels[value], checked: has(`has:${value}`) }))
    case 'sort':
      return [
        { id: 'sort:newest', label: 'Newest first', checked: session.sort === 'newest' },
        { id: 'sort:oldest', label: 'Oldest first', checked: session.sort === 'oldest' },
      ]
  }
}

/** A facet, a kind or a preset as a chip; one chosen again is taken off. */
function chipFor(chosen: string, facets: Facets, timeZone: string): SearchChip | undefined {
  if (chosen.startsWith('has:')) return { op: 'has', token: chosen, label: chosen.slice(4) }
  if (chosen.startsWith('date:')) return dateChip(chosen.slice(5) as DatePreset, timeZone)
  if (chosen.startsWith('from:')) {
    const person = facets?.from.find((facet) => `from:${facet.id}` === chosen)?.person
    return person === undefined ? undefined : { op: 'from', token: chosen, label: person.name, person }
  }
  if (chosen.startsWith('in:')) {
    const place = facets?.in.find((facet) => `in:${facet.id}` === chosen)?.place
    return place === undefined ? undefined : { op: 'in', token: chosen, label: place.name, place: { kind: place.kind } }
  }
  return undefined
}

function apply(chosen: string, facets: Facets, timeZone: string) {
  return (current: SearchSession): SearchSession => {
    if (chosen.startsWith('sort:')) return { ...current, sort: chosen === 'sort:oldest' ? 'oldest' : 'newest' }
    if (chosen.startsWith('any:')) return { ...current, chips: current.chips.filter((chip) => chip.op !== chosen.slice(4)) }
    const chip = chipFor(chosen, facets, timeZone)
    if (chip === undefined) return current
    if (current.chips.some((other) => other.token === chip.token)) return { ...current, chips: current.chips.filter((other) => other.token !== chip.token) }
    // One date range at a time.
    const kept = chip.op === 'date' ? current.chips.filter((other) => other.op !== 'date') : current.chips
    return { ...current, chips: [...kept, chip] }
  }
}

/** Shows a filter's menu at `at` and applies the choice. "Someone else…" and the like type their operator into the field. */
export async function showFilterMenu(sessionId: string, session: SearchSession, facets: Facets, menu: SearchFilterMenu, at: { readonly x: number; readonly y: number }, typeOperator: (word: string) => void): Promise<boolean> {
  const chosen = await popupContextMenu(menuItems(menu, session, facets), at)
  if (chosen === undefined) return false
  if (chosen.startsWith('other:')) {
    typeOperator(chosen.slice(6))
    return true
  }
  const calendar = chosen.startsWith('date:') ? await runCommand(registry, searchCalendar, undefined) : undefined
  if (calendar !== undefined && calendar._tag !== 'Success') return false
  updateSearchSession(registry, sessionId, apply(chosen, facets, calendar?.value ?? 'UTC'))
  return true
}
