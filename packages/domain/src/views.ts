/**
 * Sidebar views (spec section 5, "Views"): a set of channels and DMs the
 * user picked, shown as a pill in the filter row. Views are Juno's own;
 * nothing goes to Slack.
 *
 * The icon names are the keys `@juno/ui` draws (`viewIcons`), repeated here
 * because domain cannot import ui, as with the channel icons.
 */
import { Schema } from 'effect'

/** The icons a view's pill can show: Phosphor icons the app already draws, by the key `@juno/ui` uses. */
export const VIEW_ICONS = [
  'robot',
  'bell',
  'lightning',
  'bug',
  'rocket',
  'code',
  'megaphone',
  'users',
  'user',
  'hash',
  'briefcase',
  'star',
  'flag',
  'heart',
  'smiley',
  'eye',
  'coffee',
  'calendar',
  'book',
  'globe',
  'shield',
  'wrench',
  'flask',
  'leaf',
  'trophy',
  'gift',
] as const
export const ViewIcon = Schema.Literals(VIEW_ICONS)
export type ViewIcon = typeof ViewIcon.Type

/**
 * The colours a view's icon can take: the accent names, which `@juno/ui`
 * draws readable in both themes (`iconTints`). No colour is the neutral
 * default.
 */
export const VIEW_COLORS = ['coral', 'ink', 'marigold', 'teal', 'midnight', 'emerald', 'claret', 'cyan'] as const
export const ViewColor = Schema.Literals(VIEW_COLORS)
export type ViewColor = typeof ViewColor.Type

/** The longest view name the sheet takes. */
export const VIEW_NAME_MAX = 32

/** The name as stored: trimmed and cut to `VIEW_NAME_MAX`. Empty means the view cannot be saved. */
export function viewName(name: string): string {
  return name.trim().slice(0, VIEW_NAME_MAX).trim()
}

/** The order after moving `id` one place left (-1) or right (1). Unchanged at an end or for an unknown id. */
export function moveViewOrder(order: ReadonlyArray<string>, id: string, by: -1 | 1): ReadonlyArray<string> {
  const from = order.indexOf(id)
  const to = from + by
  if (from < 0 || to < 0 || to >= order.length) return order
  const next = [...order]
  next[from] = order[to]!
  next[to] = id
  return next
}

/** The order after dropping `id` before the view `before` (at the end when undefined). Unchanged for an unknown id. */
export function dropViewOrder(order: ReadonlyArray<string>, id: string, before: string | undefined): ReadonlyArray<string> {
  if (!order.includes(id) || id === before) return order
  const rest = order.filter((other) => other !== id)
  const at = before === undefined ? rest.length : rest.indexOf(before)
  return at < 0 ? order : [...rest.slice(0, at), id, ...rest.slice(at)]
}

/**
 * The pills after All that are not views (SPEC 5, "Quick filters"): Channels,
 * DMs and Reactions. They move and take a colour as a view's pill does, but
 * cannot be edited or deleted. No view has these ids: views have random ids,
 * and Automated's is `automated`.
 */
export const BUILTIN_PILLS = ['channels', 'dms', 'reactions'] as const
export type BuiltinPill = typeof BUILTIN_PILLS[number]
export const isBuiltinPill = (id: string): id is BuiltinPill => (BUILTIN_PILLS as ReadonlyArray<string>).includes(id)

/** The workspace preference holding the order of every pill after All, built-in and view. */
export const PILL_ORDER_PREF = 'pillOrder'

/** The workspace preference holding the built-in pills' looks: per pill, an icon or `none`, and a colour or `neutral`. */
export const PILL_LOOKS_PREF = 'pillLooks'

/** How a built-in pill is drawn: its icon (none shows its name) and the icon's colour (none is neutral). */
export interface PillLook {
  readonly icon?: ViewIcon
  readonly color?: ViewColor
}

/** As Juno first draws them: Channels a hash, DMs a person, Reactions a coral heart. */
const BUILTIN_PILL_LOOKS: Readonly<Record<BuiltinPill, PillLook>> = {
  channels: { icon: 'hash' },
  dms: { icon: 'user' },
  reactions: { icon: 'heart', color: 'coral' },
}

/** The built-in pills' names: the tooltip, the accessible name, and the label when a pill has no icon. */
export const BUILTIN_PILL_NAMES: Readonly<Record<BuiltinPill, string>> = { channels: 'Channels', dms: 'DMs', reactions: 'Reactions' }

/**
 * The pill order after All: the saved order with what changed since put
 * right. Views take the order the views table gives them, in the places
 * views held. A view the saved order lacks goes after the last view, or
 * after Channels and DMs when no view had a place. A built-in pill it lacks
 * goes where it first stood: Channels and DMs first, Reactions last.
 */
export function pillOrder(views: ReadonlyArray<string>, saved: unknown): ReadonlyArray<string> {
  const known = new Set(views)
  const listed = Array.isArray(saved) ? (saved as ReadonlyArray<unknown>).filter((id): id is string => typeof id === 'string' && (isBuiltinPill(id) || known.has(id))) : []
  const order = [...new Set(listed)]
  for (const id of ['dms', 'channels'] as const) if (!order.includes(id)) order.unshift(id)
  if (!order.includes('reactions')) order.push('reactions')
  const placed = new Set(order)
  const inOrder = views.filter((id) => placed.has(id))
  let next = 0
  for (const [at, id] of order.entries()) if (known.has(id)) order[at] = inOrder[next++]!
  const after = order.findLastIndex((id) => known.has(id))
  const at = after >= 0 ? after + 1 : Math.max(order.indexOf('channels'), order.indexOf('dms')) + 1
  order.splice(at, 0, ...views.filter((id) => !placed.has(id)))
  return order
}

/** The built-in pills' looks from the saved preference: what each saved, `none` and `neutral` for nothing, else the default. */
export function builtinPillLooks(saved: unknown): Readonly<Record<BuiltinPill, PillLook>> {
  const looks: Record<BuiltinPill, PillLook> = { ...BUILTIN_PILL_LOOKS }
  if (typeof saved !== 'object' || saved === null) return looks
  for (const id of BUILTIN_PILLS) {
    const entry = (saved as Record<string, unknown>)[id]
    if (typeof entry !== 'object' || entry === null) continue
    const { icon, color } = entry as Record<string, unknown>
    const look: { icon?: ViewIcon; color?: ViewColor } = { ...looks[id] }
    if (icon === 'none') delete look.icon
    else if ((VIEW_ICONS as ReadonlyArray<unknown>).includes(icon)) look.icon = icon as ViewIcon
    if (color === 'neutral') delete look.color
    else if ((VIEW_COLORS as ReadonlyArray<unknown>).includes(color)) look.color = color as ViewColor
    looks[id] = look
  }
  return looks
}

/** A built-in pill's look as the preference stores it. */
export const savedPillLook = (look: PillLook) => ({ icon: look.icon ?? 'none', color: look.color ?? 'neutral' })
