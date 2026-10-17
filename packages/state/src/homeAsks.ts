/** Juno's proactive asks on Home (SPEC 12, 13.6): the engine never lists one, the renderer adds it. */
import { HOME_ITEM_LIMIT, HomeItemKind, type HomeItem, type HomeView } from '@juno/contract'

/**
 * `view` with Juno's proactive asks (`asks`, at most one) in their place by
 * rank, still at most `HOME_ITEM_LIMIT` items. Returns `view` itself with none.
 */
export function withAsks(view: HomeView, asks: ReadonlyArray<HomeItem>): HomeView {
  const ask = asks[0]
  if (ask === undefined || view.items.some((item) => item.id === ask.id)) return view
  const rank = (item: HomeItem) => HomeItemKind.literals.indexOf(item.kind)
  const at = view.items.findIndex((item) => rank(item) > rank(ask))
  const items = at < 0 ? [...view.items, ask] : [...view.items.slice(0, at), ask, ...view.items.slice(at)]
  return { ...view, items: items.slice(0, HOME_ITEM_LIMIT) }
}
