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
  'briefcase',
  'star',
  'flag',
  'heart',
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
