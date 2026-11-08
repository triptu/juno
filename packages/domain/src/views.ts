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

/**
 * The Reactions pill's id in the pill order (SPEC 5, "Reactions"). It is not
 * a view, so no view has this id: views have random ids, and Automated's is
 * `automated`.
 */
export const REACTIONS_PILL = 'reactions'

/** The workspace preference that holds where the Reactions pill sits: the id of the view it comes before, or none after the last view. */
export const REACTIONS_PILL_PREF = 'reactionsPillBefore'

/** The pill order with the Reactions pill in it: before the view `before` while that view is there, else last. */
export function withReactionsPill(views: ReadonlyArray<string>, before: string | undefined): ReadonlyArray<string> {
  const at = before === undefined ? -1 : views.indexOf(before)
  return at < 0 ? [...views, REACTIONS_PILL] : [...views.slice(0, at), REACTIONS_PILL, ...views.slice(at)]
}

/** A pill order split back into the views' order and the view the Reactions pill comes before (undefined when last). */
export function splitReactionsPill(order: ReadonlyArray<string>): { readonly views: ReadonlyArray<string>; readonly before: string | undefined } {
  const at = order.indexOf(REACTIONS_PILL)
  return { views: order.filter((id) => id !== REACTIONS_PILL), before: at < 0 ? undefined : order[at + 1] }
}
