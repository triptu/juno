import { useEffect, useEffectEvent, useRef } from 'react'

/**
 * An emoji search's Enter that matched nothing while the workspace's emoji were still coming, held until they come,
 * so a custom name typed right after the picker opens is not lost. `hold(typed)` keeps it, `hold(undefined)` drops it
 * (a new search); once `customReady`, `pick(typed)` runs once with it.
 */
export function useHeldEnter(customReady: boolean, pick: (typed: string) => void): (typed: string | undefined) => void {
  const held = useRef<string | undefined>(undefined)
  const pickHeld = useEffectEvent(pick)
  useEffect(() => {
    const typed = held.current
    if (typed === undefined || !customReady) return
    held.current = undefined
    pickHeld(typed)
  }, [customReady])
  return (typed) => { held.current = typed }
}
