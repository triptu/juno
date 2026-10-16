import { lazy, useSyncExternalStore, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * A chunk of code loaded once, and lazy components from it that render in
 * the same commit once it has loaded (performance 2.1, 8.5).
 *
 * A plain `lazy` suspends on its first render even when its chunk was
 * loaded on idle long before: the promise its factory returns settles a
 * microtask later. React then commits the fallback and holds the content
 * back for its 300 ms fallback throttle, so the first open of a preloaded
 * panel or page took about 320 ms. Once the chunk is here, the factory
 * answers with a thenable that calls back at once, which `lazy` reads as
 * loaded in the same render.
 */
export function chunk<M>(importer: () => Promise<M>) {
  let loading: Promise<M> | undefined
  let loaded: M | undefined
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const ready = () => loaded !== undefined
  const load = (): Promise<M> =>
    (loading ??= importer().then((module) => {
      loaded = module
      for (const listener of listeners) listener()
      return module
    }))
  function component<P>(pick: (module: M) => ComponentType<P>): LazyExoticComponent<ComponentType<P>> {
    return lazy(() => {
      if (loaded === undefined) return load().then((module) => ({ default: pick(module) }))
      const settled = { default: pick(loaded) }
      // A real promise would call back a microtask late, which is the wait this avoids.
      // oxlint-disable-next-line unicorn/no-thenable
      return { then: (resolve: (value: typeof settled) => void) => resolve(settled) } as unknown as Promise<typeof settled>
    })
  }
  /** A reserved placeholder can fill as soon as idle loading ends, without suspending first. */
  function useReady(): boolean {
    return useSyncExternalStore(subscribe, ready, ready)
  }
  return { load, component, useReady }
}
